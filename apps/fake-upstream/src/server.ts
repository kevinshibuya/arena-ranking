import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_FIXTURES_DIR,
  loadFixtures,
  matchIdOfPath,
  routeKey,
  type Fixture,
  type MatchLike,
} from './fixtures';
import { LISTING_PATH, listMatchIds } from './listing';

// Stands in for every upstream host (Riot regional and platform, Data Dragon,
// Community Dragon) in tests and smoke runs: every base URL points at the one
// fake, and request paths do not overlap between hosts. It serves the committed
// fixtures. A request nothing was recorded for fails loudly with its path, so a
// test never passes against a silent upstream.
//
// Controls, under /__admin (also callable as methods on FakeUpstream):
//   POST /__admin/matches     body: a match-v5 match; served by id and in listings
//   POST /__admin/responses   body: CannedRule; the next `times` requests to `path` (carrying `riotToken`, if set) get `response`
//   POST /__admin/reset       drops added matches, pending canned responses and the request log
//   GET  /__admin/requests    every upstream request seen since the last reset, oldest first

export interface CannedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface CannedRule {
  /** A request path without its query; a trailing `*` matches any path with that prefix. */
  path: string;
  /** How many requests get the canned response. Defaults to 1. */
  times?: number;
  /** Only requests carrying this X-Riot-Token match, e.g. to stand for an expired key. */
  riotToken?: string;
  response: CannedResponse;
}

export interface SeenRequest {
  method: string;
  /** Path and query, as received. */
  path: string;
  /** The X-Riot-Token header, or null when absent. */
  riotToken: string | null;
  /** Epoch milliseconds. */
  at: number;
}

export interface FakeUpstream {
  /** Base URL to put in RIOT_API_BASE_*, DDRAGON_BASE and CDRAGON_BASE. */
  url: string;
  addMatch(match: MatchLike): Promise<void>;
  respondNext(rule: CannedRule): Promise<void>;
  reset(): Promise<void>;
  requests(): Promise<SeenRequest[]>;
  close(): Promise<void>;
}

export interface FakeUpstreamOptions {
  /** 0 picks a free port. */
  port: number;
  /** Interface to listen on; 0.0.0.0 inside a container. The URL always names 127.0.0.1. */
  host?: string;
  /** Defaults to the committed fixture set. */
  fixturesDir?: string;
}

const DROPPED_HEADERS = new Set(['content-length', 'transfer-encoding', 'content-encoding', 'connection']);

function send(res: ServerResponse, fixture: CannedResponse): void {
  const headers: Record<string, string> = { 'content-type': 'application/json;charset=utf-8' };
  for (const [name, value] of Object.entries(fixture.headers ?? {})) {
    if (!DROPPED_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  }
  res.writeHead(fixture.status, headers);
  if (fixture.body === undefined) res.end();
  else res.end(typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? undefined : JSON.parse(text));
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asMatch(value: unknown): MatchLike | undefined {
  if (!isObject(value) || !isObject(value.metadata) || !isObject(value.info)) return undefined;
  return typeof value.metadata.matchId === 'string' && Array.isArray(value.metadata.participants)
    ? (value as unknown as MatchLike)
    : undefined;
}

type PendingRule = CannedRule & { times: number };

function asRule(value: unknown): PendingRule | undefined {
  if (!isObject(value) || typeof value.path !== 'string' || !isObject(value.response)) return undefined;
  if (typeof value.response.status !== 'number') return undefined;
  const times = value.times ?? 1;
  if (typeof times !== 'number' || !Number.isInteger(times) || times < 1) return undefined;
  if (value.riotToken !== undefined && typeof value.riotToken !== 'string') return undefined;
  return { path: value.path, times, riotToken: value.riotToken, response: value.response as unknown as CannedResponse };
}

function ruleMatches(rule: CannedRule, pathname: string, riotToken: string | null): boolean {
  if (rule.riotToken !== undefined && rule.riotToken !== riotToken) return false;
  return rule.path.endsWith('*')
    ? routeKey(pathname).startsWith(routeKey(rule.path.slice(0, -1)))
    : routeKey(pathname) === routeKey(rule.path);
}

export function startFakeUpstream(options: FakeUpstreamOptions): Promise<FakeUpstream> {
  const byPath = new Map<string, Fixture>();
  const recordedMatches = new Map<string, MatchLike>();
  for (const fixture of loadFixtures(options.fixturesDir ?? DEFAULT_FIXTURES_DIR)) {
    byPath.set(routeKey(fixture.path), fixture);
    const matchId = matchIdOfPath(fixture.path);
    if (matchId && fixture.status === 200) recordedMatches.set(matchId, fixture.body as MatchLike);
  }

  // Runtime state, cleared by reset.
  let addedMatches = new Map<string, MatchLike>();
  let rules: PendingRule[] = [];
  let seen: SeenRequest[] = [];

  function* allMatches(): Generator<MatchLike> {
    for (const [id, match] of recordedMatches) if (!addedMatches.has(id)) yield match;
    yield* addedMatches.values();
  }

  function serveUpstream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const riotToken = (req.headers['x-riot-token'] as string | undefined) ?? null;
    seen.push({ method: req.method ?? 'GET', path: req.url ?? '/', riotToken, at: Date.now() });

    const rule = rules.find((candidate) => ruleMatches(candidate, url.pathname, riotToken));
    if (rule) {
      rule.times -= 1;
      if (rule.times === 0) rules = rules.filter((candidate) => candidate !== rule);
      return send(res, rule.response);
    }

    const listing = LISTING_PATH.exec(url.pathname);
    if (listing) return send(res, listMatchIds(allMatches(), decodeURIComponent(listing[1]!), url.searchParams));

    const matchId = matchIdOfPath(url.pathname);
    const added = matchId === undefined ? undefined : addedMatches.get(matchId);
    if (added) return send(res, { status: 200, body: added });

    const fixture = byPath.get(routeKey(url.pathname));
    if (fixture) return send(res, fixture);

    send(res, { status: 404, body: { error: 'unrecorded request', path: req.url } });
  }

  async function serveAdmin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /__admin/requests') return send(res, { status: 200, body: seen });
    if (route === 'POST /__admin/reset') {
      addedMatches = new Map();
      rules = [];
      seen = [];
      return send(res, { status: 204 });
    }

    const body = await readBody(req).catch(() => undefined);
    if (route === 'POST /__admin/matches') {
      const match = asMatch(body);
      if (!match) return send(res, { status: 400, body: { error: 'expected a match-v5 match' } });
      addedMatches.set(match.metadata.matchId, match);
      return send(res, { status: 201, body: { matchId: match.metadata.matchId } });
    }
    if (route === 'POST /__admin/responses') {
      const rule = asRule(body);
      if (!rule) return send(res, { status: 400, body: { error: 'expected { path, times?, riotToken?, response: { status, headers?, body? } }' } });
      rules.push(rule);
      return send(res, { status: 201, body: rule });
    }
    send(res, { status: 404, body: { error: 'unknown admin route', route } });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname.startsWith('/__admin/')) {
      serveAdmin(req, res, url).catch((error: unknown) => send(res, { status: 500, body: { error: String(error) } }));
    } else {
      serveUpstream(req, res, url);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}`;

      async function admin(method: string, path: string, body?: unknown): Promise<Response> {
        const response = await fetch(`${url}/__admin/${path}`, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`fake upstream admin ${method} ${path}: ${response.status} ${await response.text()}`);
        return response;
      }

      resolve({
        url,
        addMatch: async (match) => void (await admin('POST', 'matches', match)),
        respondNext: async (rule) => void (await admin('POST', 'responses', rule)),
        reset: async () => void (await admin('POST', 'reset')),
        requests: async () => (await (await admin('GET', 'requests')).json()) as SeenRequest[],
        close: () =>
          new Promise((done, fail) => {
            server.closeAllConnections();
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
