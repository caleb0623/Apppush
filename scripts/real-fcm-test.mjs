// Guided end-to-end test against a real phone. It sends ONE real notification, so it
// is never part of `npm test` and refuses to run without --confirm.
//   npm run test:fcm:real -- --app-key <key> --master-secret <secret> --registration-id <rid> --confirm
const options = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) =>
    arg.startsWith('--') ? [[arg.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : [],
  ),
);

const { 'app-key': appKey, 'master-secret': secret, 'registration-id': registrationId, confirm } = options;
const base = options.url ?? 'http://localhost:4000';
const RECEIPT_TIMEOUT_MS = 60_000;
const CLICK_TIMEOUT_MS = 120_000;

if (!appKey || !secret || !registrationId) {
  console.error('Required: --app-key, --master-secret and --registration-id. See docs/testing.md.');
  process.exit(2);
}
if (!confirm) {
  console.error('This sends a real notification to a real phone. Add --confirm to go ahead.');
  process.exit(2);
}

const headers = {
  Authorization: `Basic ${Buffer.from(`${appKey}:${secret}`).toString('base64')}`,
  'Content-Type': 'application/json',
};

async function api(path, init) {
  const response = await fetch(`${base}/api/v1/open${path}`, { headers, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.error?.code} ${body.error?.message}`);
  return body.data;
}

const results = [];
function check(name, passed, detail = '') {
  results.push(passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return passed;
}

async function targetOf(msgid) {
  const [target] = await api(`/messages/${msgid}/targets`);
  return target;
}

const event = (target, type) => target.events.find((e) => e.type === type);

async function waitFor(msgid, type, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await targetOf(msgid);
    if (event(target, type)) return event(target, type);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

const fromPhone = (found) => found?.source === 'DEVICE_CLIENT';
const describe = (found) => (found ? `${found.source}${found.inferred ? ', inferred' : ''}` : 'no event');

const health = await fetch(`${base}/api/health`).then((r) => r.json());
if (!check('FCM is configured on the backend', health.fcm?.configured, health.fcm?.problem ?? health.fcm?.projectId)) {
  process.exit(1);
}

const device = await api(`/devices/${registrationId}`);
check('The device is registered as a real phone', device.deliveryMode === 'REAL');
if (!check('The backend holds a valid FCM token', device.pushTokenStatus === 'ACTIVE', `${device.pushTokenStatus}`)) {
  process.exit(1);
}

const message = await api('/messages', {
  method: 'POST',
  body: JSON.stringify({
    type: 'NOTIFICATION',
    title: 'AppPush real device test',
    body: `Sent ${new Date().toLocaleTimeString()}. Tap this notification.`,
    platforms: ['ANDROID'],
    audience: { type: 'REGISTRATION_IDS', values: [registrationId] },
    strategy: 'fcm_mtpush',
  }),
});
console.log(`      msgid ${message.msgid}`);

const target = await targetOf(message.msgid);
const attempt = target.attempts.find((a) => a.channel === 'fcm');
check('Firebase accepted the message', attempt?.outcome === 'ACCEPTED', attempt?.providerMessageId ?? attempt?.failureReason ?? 'no attempt');
check('The attempt is real, not simulated', attempt?.isSimulated === false);

console.log('      Waiting for the phone to report receipt...');
const delivered = await waitFor(message.msgid, 'DELIVERED', RECEIPT_TIMEOUT_MS);
check('The phone reported receipt', fromPhone(delivered), describe(delivered));
const displayed = await waitFor(message.msgid, 'DISPLAYED', 30_000);
check('The phone reported displaying it', fromPhone(displayed), describe(displayed));

console.log('      Look at the phone: is the notification visible? Tap it now.');
const clicked = await waitFor(message.msgid, 'CLICKED', CLICK_TIMEOUT_MS);
check('The phone reported the tap', fromPhone(clicked), describe(clicked));

const { funnel } = await api(`/messages/${message.msgid}`);
console.log(`      Funnel: sent ${funnel.sent}, delivered ${funnel.delivered}, displayed ${funnel.displayed}, clicked ${funnel.clicked}`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} checks passed.`);
console.log('Only your own eyes can confirm the notification was on the screen: this script cannot see the phone.');
process.exit(passed === results.length ? 0 : 1);
