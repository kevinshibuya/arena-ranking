import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMatch,
  checkFixtures,
  REQUIRED_DERIVED,
  requiredFile,
  ZERO_ARENA_ACCOUNT,
  type BuiltMatch,
  fixtureFile,
  loadCanned,
  matchPath,
  readFixture,
  readManifest,
  startFakeUpstream,
  writeFixture,
  type FakeUpstream,
} from '../../apps/fake-upstream/src';
import { SEASON_SEED } from '../../apps/backend/src/modules/seasons/season-seed';
import { recordFixtures } from './record';

// The recorder runs against a fake standing in for live Riot, so what it records
// and the manifest it writes can be checked against a known upstream.

const day = 86_400_000;
const season3 = Date.UTC(2026, 7, 26);
const season2 = Date.UTC(2026, 3, 29);
const season1 = Date.UTC(2026, 0, 8);
const now = new Date(Date.UTC(2026, 9, 9));

// Six teams of three; `team` is the first, the rest are filler players.
function lobby(id: string, created: number, team: string[], options: { queue?: number; version?: string } = {}) {
  const others = Array.from({ length: 5 }, (_, t) => [0, 1, 2].map((s) => `${id}-p${t}${s}`));
  return buildMatch({ id, created, teams: [team, ...others], ...options });
}

const queueIds = [1700, 1710, 1740, 1750];
const current = { version: '16.19.1.1' };

const live = [
  // Current season, in the unpublished queues 1740 and 1750 and once in 1700 as
  // 8x2: Kevin with Ana three times, with Bob twice, and alone in his oldest
  // match, which the cap of five bodies leaves out.
  lobby('BR1_300', season3 + day / 2, ['kevin', 'c0', 'c00'], { ...current, queue: 1750 }),
  lobby('BR1_301', season3 + 1 * day, ['kevin', 'ana', 'c1'], { ...current, queue: 1740 }),
  lobby('BR1_302', season3 + 2 * day, ['kevin', 'ana', 'c2'], { ...current, queue: 1750 }),
  lobby('BR1_303', season3 + 3 * day, ['kevin', 'bob', 'c3'], { ...current, queue: 1740 }),
  lobby('BR1_304', season3 + 4 * day, ['kevin', 'ana', 'bob'], { ...current, queue: 1740 }),
  buildMatch({
    id: 'BR1_305',
    created: season3 + 5 * day,
    queue: 1700,
    version: current.version,
    teams: [['kevin', 'z1'], ['z2', 'z3'], ['z4', 'z5'], ['z6', 'z7'], ['z8', 'z9'], ['y1', 'y2'], ['y3', 'y4'], ['y5', 'y6']],
  }),
  // Ana alone this season.
  lobby('BR1_306', season3 + 6 * day, ['ana', 'd1', 'd2'], { ...current, queue: 1740 }),
  // Earlier 2026: three in season 2, two in season 1; only two per season and queue are sampled.
  lobby('BR1_201', season2 + 1 * day, ['kevin', 'e1', 'e2'], { version: '16.10.1.1' }),
  lobby('BR1_202', season2 + 2 * day, ['kevin', 'e1', 'e2'], { version: '16.10.1.1' }),
  lobby('BR1_203', season2 + 3 * day, ['kevin', 'e1', 'e2'], { version: '16.10.1.1' }),
  lobby('BR1_101', season1 + 1 * day, ['kevin', 'f1', 'f2'], { version: '16.2.1.1' }),
  lobby('BR1_102', season1 + 2 * day, ['kevin', 'f1', 'f2'], { version: '16.2.1.1' }),
  // 2025, outside every window.
  lobby('BR1_001', Date.UTC(2025, 11, 1), ['kevin', 'g1', 'g2'], { version: '15.24.1.1' }),
];

const rateHeaders = { 'x-app-rate-limit': '20:1,100:120', 'x-app-rate-limit-count': '1:1,1:120', date: 'Fri, 09 Oct 2026 17:00:00 GMT' };

describe('recordFixtures', () => {
  let upstream: FakeUpstream;
  let scratch: string;
  let out: string;
  const sleeps: number[] = [];

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'record-'));
    const riot = join(scratch, 'riot');
    const accounts = [
      { puuid: 'kevin', gameName: 'Player0001', tagLine: 'ANON' },
      { puuid: 'ana', gameName: 'Ana', tagLine: 'BR1' },
      { puuid: 'bob', gameName: 'Bob', tagLine: 'BR1' },
    ];
    for (const account of accounts) {
      for (const path of [
        `/riot/account/v1/accounts/by-puuid/${account.puuid}`,
        `/riot/account/v1/accounts/by-riot-id/${account.gameName}/${account.tagLine}`,
      ]) {
        writeFixture(riot, 'riot-regional', path, { status: 200, headers: rateHeaders, body: account });
      }
    }
    for (const match of live) {
      writeFixture(riot, 'riot-regional', matchPath(match.metadata.matchId), { status: 200, headers: rateHeaders, body: match });
    }
    upstream = await startFakeUpstream({ port: 0, fixturesDir: riot });
    // One 429 on the way, which the recorder must sit out and retry.
    await upstream.respondNext({ path: matchPath('BR1_302'), response: loadCanned('rate-limited') });

    out = join(scratch, 'out');
    await recordFixtures({
      riot: { keyFile: undefined, apiKey: 'RGAPI-live', baseAmericas: upstream.url, baseBr1: upstream.url },
      outDir: out,
      riotId: 'Player0001#ANON',
      seasons: SEASON_SEED,
      queueIds,
      now,
      intervalMs: 0,
      sampleSize: 2,
      maxCurrentMatches: 5,
      sleep: async (ms) => void sleeps.push(ms),
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await upstream.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  const recorded = (path: string): boolean => existsSync(fixtureFile(out, 'riot-regional', path));

  it("records the player's account by Riot ID and by PUUID, with status, headers and body", () => {
    const account = readFixture(fixtureFile(out, 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Player0001/ANON'));
    expect(account).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json;charset=utf-8', 'x-app-rate-limit': '20:1,100:120', 'x-app-rate-limit-count': '1:1,1:120' },
      body: { puuid: 'kevin', gameName: 'Player0001', tagLine: 'ANON' },
    });
    expect(recorded('/riot/account/v1/accounts/by-puuid/kevin')).toBe(true);
  });

  it('lists the current season once per Arena queue id and records the newest bodies up to the cap', () => {
    for (const id of ['BR1_301', 'BR1_302', 'BR1_303', 'BR1_304', 'BR1_305']) expect(recorded(matchPath(id))).toBe(true);
    expect(recorded(matchPath('BR1_300'))).toBe(false);
  });

  it('records a sample of earlier-2026 matches per season, and nothing from before 2026', () => {
    const sampled = ['BR1_201', 'BR1_202', 'BR1_203', 'BR1_101', 'BR1_102'].filter((id) => recorded(matchPath(id)));
    expect(sampled).toEqual(['BR1_202', 'BR1_203', 'BR1_101', 'BR1_102']);
    expect(recorded(matchPath('BR1_001'))).toBe(false);
  });

  it('records the teammate with the most shared current-season games, account and matches', () => {
    expect(recorded('/riot/account/v1/accounts/by-puuid/ana')).toBe(true);
    expect(recorded('/riot/account/v1/accounts/by-riot-id/Ana/BR1')).toBe(true);
    expect(recorded(matchPath('BR1_306'))).toBe(true);
    expect(recorded('/riot/account/v1/accounts/by-puuid/bob')).toBe(false);
  });

  it('sits out a 429 for its Retry-After and retries', () => {
    expect(sleeps).toContain(7000);
    expect(readFixture(fixtureFile(out, 'riot-regional', matchPath('BR1_302'))).status).toBe(200);
  });

  it('writes a manifest of players, shared matches and formats with their queue ids', () => {
    const manifest = readManifest(out);
    expect(manifest.players).toEqual([
      {
        role: 'primary',
        puuid: 'kevin',
        gameName: 'Player0001',
        tagLine: 'ANON',
        currentSeasonListed: { total: 6, byQueue: { '1700': 1, '1710': 0, '1740': 3, '1750': 2 } },
        currentSeasonMatchIds: ['BR1_305', 'BR1_304', 'BR1_303', 'BR1_302', 'BR1_301'],
        earlierMatchIds: ['BR1_203', 'BR1_202', 'BR1_102', 'BR1_101'],
      },
      {
        role: 'teammate',
        puuid: 'ana',
        gameName: 'Ana',
        tagLine: 'BR1',
        currentSeasonListed: { total: 4, byQueue: { '1700': 0, '1710': 0, '1740': 3, '1750': 1 } },
        currentSeasonMatchIds: ['BR1_306', 'BR1_304', 'BR1_302', 'BR1_301'],
        earlierMatchIds: [],
      },
    ]);
    expect(manifest.sharedCurrentSeasonMatchIds).toEqual(['BR1_301', 'BR1_302', 'BR1_304']);
    expect(manifest.formats).toEqual([
      { format: '6x3', queueIds: [1700, 1740, 1750], matches: 9 },
      { format: '8x2', queueIds: [1700], matches: 1 },
    ]);
  });

  it('derives the format and season variants from one recorded match, each marked derived', () => {
    const variants = readManifest(out)
      .derived.filter((entry) => entry.matchId !== undefined)
      .map(({ matchId, from, format, season }) => ({ matchId, from, format, season }));
    expect(variants).toEqual([
      { matchId: 'BR1_9000000001', from: 'BR1_304', format: '8x2', season: '2026 Season 3' },
      { matchId: 'BR1_9000000002', from: 'BR1_304', format: 'irregular', season: '2026 Season 3' },
      { matchId: 'BR1_9000000003', from: 'BR1_304', format: '6x3', season: '2026 Season 2' },
      { matchId: 'BR1_9000000004', from: 'BR1_304', format: '6x3', season: '2026 Season 1' },
    ]);

    const lastPatch = readFixture(fixtureFile(out, 'riot-regional', matchPath('BR1_9000000003')));
    const body = lastPatch.body as BuiltMatch;
    expect(lastPatch.derived).toMatchObject({ from: 'BR1_304' });
    expect(body.info.gameVersion).toMatch(/^16\.16\./);
    expect(body.info.gameCreation).toBe(season3 + 2 * 3_600_000);
    expect(body.info.gameEndTimestamp - body.info.gameStartTimestamp).toBe(body.info.gameDuration * 1000);
    expect(body.metadata.matchId).toBe('BR1_9000000003');
    expect(body.info.gameId).toBe(9000000003);

    const earlier = readFixture(fixtureFile(out, 'riot-regional', matchPath('BR1_9000000004'))).body as BuiltMatch;
    expect(earlier.info.gameVersion).toMatch(/^16\.2\./);
    expect(earlier.info.gameCreation).toBe(season1 + 14 * day);
  });

  it('stops on an empty current season, naming the queue ids tried and the probe', async () => {
    const run = recordFixtures({
      riot: { keyFile: undefined, apiKey: 'RGAPI-live', baseAmericas: upstream.url, baseBr1: upstream.url },
      outDir: join(scratch, 'empty'),
      riotId: 'Player0001#ANON',
      seasons: SEASON_SEED,
      queueIds: [1710, 1720],
      now,
      intervalMs: 0,
      sleep: async () => undefined,
      log: () => undefined,
    });

    await expect(run).rejects.toThrow(
      'no current-season match for Player0001#ANON under queue ids 1710, 1720: run `pnpm riot:queues Player0001#ANON` to find the queue ids behind the newest matches, then set ARENA_QUEUE_IDS',
    );
  });

  it('writes the hand-authored accounts and responses', () => {
    const notFound = readFixture(fixtureFile(out, 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Ninguem/0000'));
    expect(notFound.status).toBe(404);
    expect(readFixture(fixtureFile(out, 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Sem Arena/BR1')).body).toEqual(
      ZERO_ARENA_ACCOUNT,
    );
    expect(loadCanned('rate-limited', out).headers['retry-after']).toBe('7');
    expect(loadCanned('key-rejected', out).status).toBe(403);
  });

  describe('fixtures:check', () => {
    const check = { seasons: SEASON_SEED };

    function copyOfSet(): string {
      const copy = mkdtempSync(join(scratch, 'check-'));
      cpSync(out, copy, { recursive: true });
      return copy;
    }

    function setVersion(dir: string, id: string, version: string): void {
      const file = fixtureFile(dir, 'riot-regional', matchPath(id));
      const fixture = readFixture(file);
      (fixture.body as BuiltMatch).info.gameVersion = version;
      writeFixture(dir, 'riot-regional', matchPath(id), fixture);
    }

    it('passes on the complete set', () => {
      expect(checkFixtures(out, check)).toEqual([]);
    });

    // Paths relative to the set.
    const required = [
      'manifest.json',
      fixtureFile('', 'riot-regional', '/riot/account/v1/accounts/by-puuid/kevin'),
      fixtureFile('', 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Player0001/ANON'),
      fixtureFile('', 'riot-regional', '/riot/account/v1/accounts/by-puuid/ana'),
      fixtureFile('', 'riot-regional', '/riot/account/v1/accounts/by-riot-id/Ana/BR1'),
      fixtureFile('', 'riot-regional', matchPath('BR1_303')),
      ...REQUIRED_DERIVED.map((fixture) => requiredFile('', fixture)),
    ];

    it.each(required)('fails when %s is removed', (file) => {
      const copy = mkdtempSync(join(scratch, 'check-'));
      cpSync(out, copy, { recursive: true });
      rmSync(join(copy, file));

      expect(checkFixtures(copy, check)).not.toEqual([]);
    });

    it('fails when the two players share no current-season match', () => {
      const copy = mkdtempSync(join(scratch, 'check-'));
      cpSync(out, copy, { recursive: true });
      for (const id of ['BR1_301', 'BR1_302', 'BR1_304']) rmSync(fixtureFile(copy, 'riot-regional', matchPath(id)));

      expect(checkFixtures(copy, check)).toContain('no recorded current-season match shared by both players');
    });

    it("fails when a recorded current-season match's game version does not map to the manifest's current season", () => {
      const copy = copyOfSet();
      setVersion(copy, 'BR1_303', '16.16.1.1');

      expect(checkFixtures(copy, check)).toContain(
        'current-season match BR1_303 is on 16.16.1.1, which maps to 2026 Season 2, not 2026 Season 3',
      );
    });

    it('fails when a recorded earlier match maps to the current season or to none', () => {
      const copy = copyOfSet();
      setVersion(copy, 'BR1_202', '16.17.1.1');
      setVersion(copy, 'BR1_101', '15.24.1.1');

      expect(checkFixtures(copy, check)).toEqual([
        'earlier match BR1_202 is on 16.17.1.1, which maps to 2026 Season 3, not an earlier season',
        'earlier match BR1_101 is on 15.24.1.1, which maps to no season, not an earlier season',
      ]);
    });

    it('exits 1 naming the problem from the command line, 0 on the complete set', () => {
      const copy = mkdtempSync(join(scratch, 'check-'));
      cpSync(out, copy, { recursive: true });
      rmSync(join(copy, 'canned', 'key-rejected.json'));
      const tsx = join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');
      const cli = join(__dirname, '..', 'fixtures-check.ts');

      const broken = spawnSync(tsx, [cli, copy], { encoding: 'utf8' });
      const complete = spawnSync(tsx, [cli, out], { encoding: 'utf8' });

      expect(broken.status).toBe(1);
      expect(broken.stderr).toContain('derived fixture missing: canned/key-rejected.json');
      expect(complete.status).toBe(0);
    });
  });
});
