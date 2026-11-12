import { loadConfig } from './config';

describe('loadConfig', () => {
  it('fills local development defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config.databaseUrl).toBe('postgres://arena:arena@localhost:54329/arena');
    expect(config.redisUrl).toBe('redis://localhost:63799');
    expect(config.redisPrefix).toBe('arena');
    expect(config.logLevel).toBe('info');
    expect(config.port).toBe(3001);
    expect(config.riot).toEqual({
      keyFile: undefined,
      apiKey: undefined,
      baseAmericas: 'https://americas.api.riotgames.com',
      baseBr1: 'https://br1.api.riotgames.com',
      ratePerSecond: 20,
      ratePerTwoMinutes: 100,
      keyProbeIntervalMs: 60_000,
      arenaQueueIds: [1700, 1710, 1740, 1750],
    });
    expect(config.ddragonBase).toBe('https://ddragon.leagueoflegends.com');
    expect(config.cdragonBase).toBe('https://raw.communitydragon.org');
    expect(config.ladderMinGames).toBe(10);
    expect(config.sweepLookbackHours).toBe(168);
    expect(config.trustedProxies).toEqual(['loopback']);
    expect(config.dashboard).toEqual({ user: undefined, pass: undefined });
  });

  it('reads every documented variable', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@db:5432/x',
      REDIS_URL: 'redis://cache:6379',
      REDIS_PREFIX: 'run-1',
      LOG_LEVEL: 'debug',
      PORT: '4000',
      RIOT_KEY_FILE: '/run/secrets/riot.key',
      RIOT_API_KEY: 'RGAPI-test',
      RIOT_API_BASE_AMERICAS: 'http://127.0.0.1:9000',
      RIOT_API_BASE_BR1: 'http://127.0.0.1:9001',
      DDRAGON_BASE: 'http://127.0.0.1:9002',
      CDRAGON_BASE: 'http://127.0.0.1:9003',
      RIOT_RATE_PER_SECOND: '500',
      RIOT_RATE_PER_TWO_MINUTES: '10000',
      RIOT_KEY_PROBE_INTERVAL_MS: '250',
      ARENA_QUEUE_IDS: '1740, 1750,1800',
      LADDER_MIN_GAMES: '1',
      SWEEP_LOOKBACK_HOURS: '4',
      TRUSTED_PROXIES: '10.0.0.0/8, 172.18.0.5',
      DASHBOARD_USER: 'kevin',
      DASHBOARD_PASS: 'secret',
    });
    expect(config).toEqual({
      databaseUrl: 'postgres://u:p@db:5432/x',
      redisUrl: 'redis://cache:6379',
      redisPrefix: 'run-1',
      logLevel: 'debug',
      port: 4000,
      riot: {
        keyFile: '/run/secrets/riot.key',
        apiKey: 'RGAPI-test',
        baseAmericas: 'http://127.0.0.1:9000',
        baseBr1: 'http://127.0.0.1:9001',
        ratePerSecond: 500,
        ratePerTwoMinutes: 10000,
        keyProbeIntervalMs: 250,
        arenaQueueIds: [1740, 1750, 1800],
      },
      ddragonBase: 'http://127.0.0.1:9002',
      cdragonBase: 'http://127.0.0.1:9003',
      ladderMinGames: 1,
      sweepLookbackHours: 4,
      trustedProxies: ['10.0.0.0/8', '172.18.0.5'],
      dashboard: { user: 'kevin', pass: 'secret' },
    });
  });

  it('trusts no proxy when TRUSTED_PROXIES is set empty', () => {
    expect(loadConfig({ TRUSTED_PROXIES: '' }).trustedProxies).toEqual([]);
  });

  it('refuses a number that is not a positive integer, naming the variable', () => {
    expect(() => loadConfig({ RIOT_RATE_PER_SECOND: 'fast' })).toThrow('RIOT_RATE_PER_SECOND');
    expect(() => loadConfig({ LADDER_MIN_GAMES: '0' })).toThrow('LADDER_MIN_GAMES');
  });

  it('refuses Arena queue ids that are not a list of positive integers', () => {
    expect(() => loadConfig({ ARENA_QUEUE_IDS: '1740,cherry' })).toThrow('ARENA_QUEUE_IDS');
    expect(() => loadConfig({ ARENA_QUEUE_IDS: ' , ' })).toThrow('ARENA_QUEUE_IDS');
  });

  it('refuses an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow('LOG_LEVEL');
  });
});
