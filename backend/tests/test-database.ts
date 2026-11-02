import { resolve } from 'node:path';
import { config } from 'dotenv';

/** Returns the test database URL, and refuses anything that is not a *_test database. */
export function testDatabaseUrl(): string {
  config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set in backend/.env');
  const database = new URL(url).pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${database}": the name must end in _test`);
  }
  return url;
}
