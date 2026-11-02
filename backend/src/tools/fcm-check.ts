/**
 * Proves that the Firebase credentials work, using FCM's validate-only mode.
 * Google checks the request and sends nothing, so no phone can be disturbed.
 *   npm run fcm:check                  checks the credentials
 *   npm run fcm:check -- <registrationId>  also checks that device's stored token
 */
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { buildFcmMessage, classifyFcmError } from '../modules/delivery/fcm.js';
import { loadFcmSetup } from '../modules/delivery/firebase.js';

const PLACEHOLDER_TOKEN = 'apppush-credential-check-not-a-real-registration-token';

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

async function main() {
  const { sender, problem } = loadFcmSetup();
  if (problem) fail(problem);
  if (!sender) fail('Set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env (see docs/firebase-setup.md).');
  console.log(`Service account loaded for Firebase project "${sender.projectId}".`);

  const registrationId = process.argv[2];
  let token = PLACEHOLDER_TOKEN;
  if (registrationId) {
    const device = await prisma.device.findUnique({ where: { registrationId } });
    if (!device?.pushToken) fail(`Device ${registrationId} has no stored push token.`);
    token = device.pushToken;
  }

  const message = buildFcmMessage(
    {
      msgid: 'fcm-check',
      registrationId: registrationId ?? 'none',
      platform: 'ANDROID',
      online: false,
      title: 'Validate only',
      body: 'Sent with dryRun, so nothing is delivered',
      payload: null,
      pushToken: token,
    },
    { mode: env.FCM_PAYLOAD_MODE, ttlSeconds: 60, timeoutMs: env.FCM_TIMEOUT_MS },
  );

  try {
    const name = await sender.send(message, true);
    console.log(`OK: FCM validated the request for this device (${name}). Nothing was delivered.`);
  } catch (error) {
    const { reason, tokenInvalid } = classifyFcmError(error);
    if (!registrationId && reason === 'TOKEN_INVALID') {
      // Reaching this answer means Google authenticated us and then judged the token.
      console.log('OK: Google accepted the credentials. It rejected only the placeholder token, as expected.');
      return;
    }
    fail(`${reason}${tokenInvalid ? ' (this device must register again)' : ''}: ${(error as Error).message}`);
  }
}

await main().finally(() => prisma.$disconnect());
