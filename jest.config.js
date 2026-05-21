module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js', '**/src/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.js', '!src/app.js', '!src/config/**'],
};
