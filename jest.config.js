module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "src/.*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      { isolatedModules: true, tsconfig: { allowJs: true } },
    ],
  },
  collectCoverageFrom: [
    "src/**/*.(t|j)s",
    "!src/**/*.module.ts",
    "!src/main.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.mock.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "json-summary", "text-summary"],
  coverageThreshold: {
    global: {
      lines: 70,
      branches: 70,
      functions: 70,
      statements: 70,
    },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: ["node_modules/(?!.pnpm|uuid)"],
  testEnvironment: "node",
};
