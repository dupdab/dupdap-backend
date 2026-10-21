module.exports = {
  rootDir: '../..', testRegex: 'test/integration/.*\\.spec\\.ts$',
  testEnvironment: 'node', testTimeout: 20000,
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
  moduleNameMapper: { '^uuid$': '<rootDir>/test/integration/uuid.js' },
};
