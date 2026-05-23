// Global test setup for Express backend
import '@testing-library/jest-dom';

// Mock environment variables — must satisfy the zod schema in src/config.
// JWT_SECRET requires min 32 characters; importing any service file that
// transitively pulls src/config will otherwise trigger process.exit(1)
// during env validation and kill the test run. Pre-existing tests did not
// hit this because they mocked @/lib/prisma before importing the service —
// but mocking prisma does not prevent the service from pulling in config
// via other paths.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-do-not-use-in-prod-32chars-min';
process.env.NODE_ENV = 'test';

// Suppress console errors and warnings in tests to reduce noise
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: console.log, // Keep log for debugging if needed
};