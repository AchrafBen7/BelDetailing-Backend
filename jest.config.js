export default {
  testEnvironment: "node",
  transform: {},
  moduleFileExtensions: ["js", "json"],
  testMatch: ["**/tests/**/*.test.js", "**/__tests__/**/*.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/**/*.test.js", "!src/config/**"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  verbose: true,
  testTimeout: 30000,
  setupFiles: ["./tests/jest.setup.js"],
};
