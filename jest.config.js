module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/**/*.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 100,
      lines: 90,
      statements: 90
    }
  }
};
