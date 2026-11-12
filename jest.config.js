// One Jest run covers every package. Extra CLI arguments (`pnpm test -- <filter>`)
// are path patterns matched across all projects.
const swc = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
  },
];

const common = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': swc },
  moduleFileExtensions: ['ts', 'js', 'json'],
};

/** @type {import('jest').Config} */
module.exports = {
  // Suites reach Postgres, Redis and child processes, and a filter can match the
  // worktree path and run every suite at once, so Jest's 5 s default is too
  // tight. Jest reads this from the top level only, never from a project.
  testTimeout: 30_000,
  projects: [
    {
      ...common,
      displayName: 'backend',
      rootDir: '<rootDir>/apps/backend',
      testMatch: ['<rootDir>/{src,test}/**/*.test.ts'],
      setupFiles: ['reflect-metadata'],
      globalSetup: '<rootDir>/test/harness/global-setup.ts',
      globalTeardown: '<rootDir>/test/harness/global-teardown.ts',
    },
    {
      ...common,
      displayName: 'fake-upstream',
      rootDir: '<rootDir>/apps/fake-upstream',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
    },
    {
      ...common,
      displayName: 'scripts',
      testMatch: ['<rootDir>/scripts/**/*.test.ts'],
    },
  ],
};
