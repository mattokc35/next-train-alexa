import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**'],
  clearMocks: true,
  transform: {
    // ts-jest warns (TS151002) that the tsconfig's Node16 module mode is
    // "only supported in isolatedModules: true" — but enabling ts-jest's
    // isolatedModules transpile-only mode breaks dynamic `import()` support
    // for ESM-only packages (see pathService.test.ts), which we rely on to
    // mock puppeteer-core/@sparticuz/chromium. The warning is cosmetic in
    // full-program mode, so it's suppressed here instead.
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
};

export default config;
