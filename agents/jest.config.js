/**
 * jest.config.js — unit test cho package `agents/` (ts-jest, CommonJS).
 *
 * `rootDir: '.'` cho ts-jest vì tsconfig.json của phần build chỉ include `src/`.
 * Test nằm ngoài `src/` nên nếu giữ rootDir = src, ts-jest báo TS6059.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: '.', noEmit: true } }],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  clearMocks: true,
};
