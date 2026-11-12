import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMatch,
  loadCanned,
  matchPath,
  startFakeUpstream,
  writeFixture,
  type FakeUpstream,
} from '../apps/fake-upstream/src';

// `pnpm riot:queues <Name#TAG>` run as the operator runs it, against a fake
// standing in for live Riot.

const hour = 3_600_000;
const t0 = Date.UTC(2026, 9, 8, 12);
// 22 matches an hour apart, BR1_401 the oldest, across Arena queues and one
// Summoner's Rift game; only the newest 20 are fetched.
const queues = [1740, 1750, 1700, 420];
const matches = Array.from({ length: 22 }, (_, i) => {
  const queue = queues[i % queues.length]!;
  const teams = queue === 1700 ? Array.from({ length: 8 }, (_, t) => [`${i}-${t}a`, `${i}-${t}b`]) : Array.from({ length: 6 }, (_, t) => [`${i}-${t}a`, `${i}-${t}b`, `${i}-${t}c`]);
  teams[0]![0] = 'kevin';
  return buildMatch({ id: `BR1_${401 + i}`, created: t0 + i * hour, queue, version: '16.20.824.8524', teams });
});

const tsx = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
const cli = join(__dirname, 'riot-queues.ts');

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe('riot:queues', () => {
  let fake: FakeUpstream;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'riot-queues-'));
    writeFixture(dir, 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Player0001/ANON', {
      status: 200,
      headers: {},
      body: { puuid: 'kevin', gameName: 'Player0001', tagLine: 'ANON' },
    });
    for (const match of matches) {
      writeFixture(dir, 'riot-regional', matchPath(match.metadata.matchId), { status: 200, headers: {}, body: match });
    }
    fake = await startFakeUpstream({ port: 0, fixturesDir: dir });
  });

  afterEach(async () => {
    await fake.reset();
  });

  afterAll(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Asynchronous, so the fake in this process keeps answering while it runs.
  function run(...args: string[]): Promise<Run> {
    return new Promise((done) => {
      const child = spawn(tsx, [cli, ...args], {
        env: { PATH: process.env.PATH, RIOT_API_KEY: 'RGAPI-probe', RIOT_API_BASE_AMERICAS: fake.url, ARENA_QUEUE_IDS: '1700,1740' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
  }

  it("prints the newest 20 matches with date, queue id, game mode, lobby shape and game version", async () => {
    const result = await run('Player0001#ANON');

    expect(result.status).toBe(0);
    const rows = result.stdout.split('\n').filter((line) => line.startsWith('BR1_'));
    expect(rows).toHaveLength(20);
    expect(rows[0]!.split(/\s{2,}/)).toEqual(['BR1_422', '2026-10-09 09:00Z', '1750', 'CHERRY', '6x3', '16.20.824.8524']);
    expect(rows[1]!.split(/\s{2,}/)).toEqual(['BR1_421', '2026-10-09 08:00Z', '1740', 'CHERRY', '6x3', '16.20.824.8524']);
    expect(rows[2]!.split(/\s{2,}/)).toEqual(['BR1_420', '2026-10-09 07:00Z', '420', 'CHERRY', '6x3', '16.20.824.8524']);
    expect(rows[3]!.split(/\s{2,}/)).toEqual(['BR1_419', '2026-10-09 06:00Z', '1700', 'CHERRY', '8x2', '16.20.824.8524']);
    expect(rows.at(-1)).toMatch(/^BR1_403 /);
    const requested = (await fake.requests()).map((request) => request.path);
    expect(requested).toContain('/lol/match/v5/matches/by-puuid/kevin/ids?start=0&count=100');
    expect(requested).not.toContain(matchPath('BR1_402'));
  });

  it('names the queue ids it saw that ARENA_QUEUE_IDS does not hold', async () => {
    const result = await run('Player0001#ANON');

    expect(result.stdout).toContain('not in ARENA_QUEUE_IDS (1700, 1740): 420, 1750');
  });

  it('exits non-zero naming the path when Riot rejects the key', async () => {
    await fake.respondNext({ path: '/riot/account/v1/*', response: loadCanned('key-rejected') });

    const result = await run('Player0001#ANON');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Riot rejected the key (403) on /riot/account/v1/accounts/by-riot-id/Player0001/ANON');
  });

  it('exits non-zero when the Riot ID does not resolve', async () => {
    const result = await run('Nobody#0000');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not-found (404) on /riot/account/v1/accounts/by-riot-id/Nobody/0000');
  });

  it('exits non-zero with usage when the Riot ID is missing or malformed', async () => {
    for (const args of [[], ['Player0001']]) {
      const result = await run(...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('usage: pnpm riot:queues <Name#TAG>');
    }
  });
});
