import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().startsWith('mysql://'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CREDENTIAL_PEPPER: z.string().min(32),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_STALE_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  TESTING_ENV_QPS: z.coerce.number().int().positive().default(10),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  FCM_PAYLOAD_MODE: z.enum(['data', 'hybrid']).default('data'),
  FCM_TTL_SECONDS: z.coerce.number().int().min(0).max(2_419_200).default(86_400),
  FCM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(
    `Invalid environment configuration (${fields}). Run "npm run setup:env" or see backend/.env.example.`,
  );
}

export const env = parsed.data;
