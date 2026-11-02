import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Messaging, TokenMessage } from 'firebase-admin/messaging';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { FcmSender } from './fcm.js';

const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().startsWith('-----BEGIN PRIVATE KEY-----'),
});

type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export interface FirebaseSources {
  path?: string | undefined;
  json?: string | undefined;
}

/** `FIREBASE_SERVICE_ACCOUNT_JSON` may be raw JSON or base64, which survives .env quoting. */
const decode = (value: string) =>
  value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');

/**
 * Returns null when Firebase is simply not set up. Errors name the problem but
 * never the file's contents, because they reach logs and the health endpoint.
 */
export function loadServiceAccount(sources: FirebaseSources): ServiceAccount | null {
  let raw: string;
  if (sources.json) {
    raw = decode(sources.json);
  } else if (sources.path) {
    const path = resolve(import.meta.dirname, '../../..', sources.path);
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`Cannot read the service account file at ${path}`);
    }
  } else {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The Firebase service account is not valid JSON');
  }
  const account = serviceAccountSchema.safeParse(parsed);
  if (!account.success) {
    const fields = account.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`The Firebase service account is missing or has bad fields: ${fields}`);
  }
  return account.data;
}

export function createFirebaseSender(account: ServiceAccount): FcmSender {
  let messaging: Promise<Messaging> | undefined;

  // Loaded on first use, so an environment with no real devices never pays for the SDK.
  const connect = async () => {
    const [{ cert, getApps, initializeApp }, { getMessaging }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/messaging'),
    ]);
    const name = 'apppush';
    const app =
      getApps().find((candidate) => candidate.name === name) ??
      initializeApp(
        {
          credential: cert({
            projectId: account.project_id,
            clientEmail: account.client_email,
            privateKey: account.private_key,
          }),
        },
        name,
      );
    return getMessaging(app);
  };

  return {
    projectId: account.project_id,
    send: async (message: TokenMessage, dryRun = false) => {
      messaging ??= connect();
      return (await messaging).send(message, dryRun);
    },
  };
}

export interface FcmSetup {
  sender: FcmSender | null;
  /** Why a configured Firebase account could not be used. */
  problem: string | null;
}

/** Automated tests can never get a real sender, whatever .env contains. */
export function loadFcmSetup(): FcmSetup {
  if (env.NODE_ENV === 'test') return { sender: null, problem: null };
  try {
    const account = loadServiceAccount({
      path: env.FIREBASE_SERVICE_ACCOUNT_PATH,
      json: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    });
    return { sender: account ? createFirebaseSender(account) : null, problem: null };
  } catch (error) {
    return { sender: null, problem: (error as Error).message };
  }
}
