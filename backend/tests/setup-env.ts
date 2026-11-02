import { testDatabaseUrl } from './test-database.js';

// Runs before any application module loads, so Prisma can only see the test database.
process.env.DATABASE_URL = testDatabaseUrl();
// Also stops loadFcmSetup creating a real sender, even with credentials in .env.
process.env.NODE_ENV = 'test';
