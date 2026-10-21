module.exports = {
  ...require("../../jest.config"),
  rootDir: "../..",
  testRegex: "test/e2e/.*\\.e2e-spec\\.ts$",
  coverageThreshold: {},
  testTimeout: 30000,
};
