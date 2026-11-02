# Testing

## Summary

| Suite | Command | Result | Date |
|---|---|---|---|
| Backend unit and integration | `npm run test -w backend` | 316 of 316 passed | 2026-10-31 |
| Frontend unit and component | `npm run test -w frontend` | 53 of 53 passed | 2026-11-01 |
| Browser journey | `npm run test:e2e` | 16 of 16 steps passed. An earlier run failed once at step 3 and did not recur | 2026-11-01 |
| Android unit | `.\gradlew.bat testDebugUnitTest` | 17 of 17 passed | 2026-11-02 |
| Typecheck, lint, production build | `npm run typecheck`, `lint`, `build` | Clean | 2026-11-01 |
| **Real FCM to a real device** | `npm run test:fcm:real` | **Passed.** See below | 2026-10-31 |

**What the automated results do not prove.** Every automated test replaces Firebase with a mock. They show that the code around Firebase behaves correctly. They do not show that a notification reaches a phone. Only the procedure at the end of this page does that.

## Real device results

Firebase project `engage-2c0f7`, on a Samsung Galaxy Tab A8 (SM-X205) running Android 14, over wireless debugging.

| Run | App state | Sent | Received | Displayed | Clicked | Script checks |
|---|---|---|---|---|---|---|
| 1 | Foreground | Yes | Yes, recorded as inferred | Yes | Yes | 8 of 8 |
| 2 | Background | Yes | Yes, 0.3 s after sending | Yes, but the report took 15.4 s | Yes, tapped later at 190 s | 6 of 8, both outside the script's time limits |
| 3 | Background, after the fix | Yes | Yes, 0.1 s after sending | Yes, report took 0.2 s | Not tapped in the 2-minute window | 7 of 8 |
| 4 | Background: a realistic "Your order is on its way" message, sent with `distribution_new` and the Text style | Yes | Yes, 0.2 s after sending | Yes, report took 0.2 s | Yes, at 4.8 s | Sent directly, not by the script |
| 5 | Locked and in deep sleep (Android Doze `IDLE`): "Your parcel has arrived" | Yes | Yes, 0.3 s after sending | Yes, 0.4 s after sending, report took 0.2 s | Not tested | Sent directly, not by the script |
| 6 and 7 | Sent by hand from the console's **New push** page | Yes | Yes | Yes | Yes for the second | Sent from the console |
| 8 | Demo app built on the SDK, tablet awake: "AppPush SDK 测试" | Yes | Yes | Yes | Yes, opened the app | Sent directly, not by the script |

Every stage has now been recorded from the real device: in the foreground, in the background, and from the console. The taps in runs 1, 2, 4 and 7 were reported by the app. In run 5, the tablet was still locked and dozing after the send, and the notification was in its notification list. `DISPLAYED` means Android accepted the notification, so a person still has to confirm how it looked on the lock screen. Firebase accepted every message. These results did not exercise flight mode, the negative checks below, or the Big Picture, Inbox and Thumbnail styles.

**A bug found only by this test.** The app sends `DELIVERED` and `DISPLAYED` about 10 ms apart. Those two transactions deadlocked in MySQL, one request received a 500, and the app retried 15 seconds later. No data was lost, but reports were slow. Report handling now takes a row lock on the target, and a regression test sends simultaneous reports.

## Language checks

On 2026-11-01 the console was walked in Chinese in Microsoft Edge: all 13 pages, the main dialogs and the push form's states. All interface text was Chinese. The English left was data, such as application names, message text, device IDs and timezones. No page scrolled sideways at desktop or phone width.

On the tablet, the language button changed the app between English and Chinese in both directions, and the choice survived a force stop. Android's notification channel names followed it. No crash was logged.

## SDK checks

On 2026-11-02 a separate app was built outside this project. It used only the published Maven repository, and code copied from [android-sdk.md](android-sdk.md). It built, and its merged manifest held the SDK's service and notification permission. That app was built but not run.

The demo app, now built on the SDK, was installed over the previous version on the tablet. It kept its registration ID and messages, reported ready, and reached the backend, with no crash. Run 8 above then went through the SDK end to end: FCM accepted the message, the SDK showed it, and received, displayed and clicked were all reported by the device. The tap opened the app through the launcher intent. Locked delivery and the Big Picture, Inbox and Thumbnail styles have not been repeated on the SDK build.

## Test layout

| Location | Covers |
|---|---|
| `backend/tests/unit/` | AppKey and credential handling, message validation, strategy selection, fallback plans, analytics calculations, testing limits, rate limiting, timezones, FCM message building, FCM error mapping |
| `backend/tests/integration/` | The HTTP API against a real MySQL test database |
| `frontend/tests/` | API client, components, push form, application creation, formatting |
| `e2e/ui-flow.mjs` | The whole console in a real browser, including all pages and phone-width layout |
| `android/apppush-sdk/src/test/` | Payload parsing, duplicate detection and SDK strings |
| `android/app/src/test/` | Demo app strings |
| `scripts/real-fcm-test.mjs` | A real notification to a real phone |

## Requirement coverage

| Required test | Where |
|---|---|
| AppKey generation, credential handling | `unit/credentials.test.ts`, `integration/apps.test.ts` |
| Message validation | `unit/payload-validation.test.ts`, `integration/messages.test.ts` |
| Delivery strategy selection, fallback | `unit/strategy.test.ts`, `integration/delivery.test.ts`, `integration/real-delivery.test.ts` |
| Analytics calculations and queries | `unit/metrics.test.ts`, `integration/analytics.test.ts` |
| Testing environment restrictions | `unit/limits.test.ts`, `integration/testing-limits.test.ts`, `integration/client-api.test.ts` |
| Product specification rules | `integration/spec-alignment.test.ts`, `integration/delivery.test.ts` |
| Application creation | `integration/apps.test.ts` |
| Device registration | `integration/devices.test.ts`, `integration/client-api.test.ts` |
| Push creation | `integration/messages.test.ts` |
| FCM with a mock provider | `integration/real-delivery.test.ts`, `unit/fcm.test.ts` |
| Invalid token handling | `integration/real-delivery.test.ts` |
| Scheduled messages | `integration/scheduler.test.ts`, `integration/real-delivery.test.ts` |
| Click and receipt reporting | `integration/client-api.test.ts` |
| Duplicate prevention | `integration/delivery.test.ts`, `integration/real-delivery.test.ts`, `PushMessageTest.kt` |

## Safety

Automated runs cannot send a real notification:

- `loadFcmSetup` never creates a real sender when `NODE_ENV=test`, whatever `.env` contains. A unit test asserts this.
- `tests/setup-env.ts` sets `NODE_ENV=test` before any application code loads.
- Integration tests inject a mock `FcmSender`.
- Tests run only against a database whose name ends in `_test`.
- `npm run test:fcm:real` is not part of `npm test`, and refuses to run without `--confirm`.

## Running the tests

The private MySQL must be running for backend tests: `npm run db:local:start`.

```powershell
npm test                  # Backend and frontend
npm run verify            # Typecheck, lint, tests and build
npm run dev               # In a second terminal, before the browser test
npm run test:e2e
```

The browser test uses the installed Microsoft Edge. It creates one application in the development database, and deactivates it at the end if it finishes.

On a machine with little memory, run these one at a time and close other applications. Do not run the Android emulator at the same time as a build. See the note below.

## Real FCM integration test

This test uses your real Firebase project and phone. No mock is involved. Complete [firebase-setup.md](firebase-setup.md) first.

### Setup

1. `npm run fcm:check` reports that Google accepted the credentials.
2. `npm run dev` is running, and the console shows **FCM configured**.
3. The app is installed, and `adb reverse tcp:4000 tcp:4000` has been run.
4. You have the AppKey and Master Secret of a non-demo application.

### Procedure

| # | Step | Pass condition | Evidence |
|---|---|---|---|
| 1 | Press **Save and register** in the app | The app shows a registration ID | App screen |
| 2 | Open **Devices** in the console | The phone is listed as **Real phone** | Console |
| 3 | Create a notification on **New push**, targeting the phone with `fcm_mtpush` | The form accepts it | Console |
| 4 | Press **Send push** | The message is `Completed` | Message details |
| 5 | Check the attempt | `FCM`, `Accepted`, with a response holding an FCM message name | Message details |
| 6 | Look at the phone | **The notification is visible** | Your own eyes |
| 7 | Tap the notification | The app opens | Phone |
| 8 | Check the dashboard | Received, Displayed and Clicked, each `reported by the device` | Message details |

Repeat with the app in the foreground, in the background, and with the phone locked.

Or run the guided version, which performs steps 3 to 5 and 8, and tells you when to tap:

```powershell
npm run test:fcm:real -- --app-key <AppKey> --master-secret <MasterSecret> --registration-id <rid_...> --confirm
```

It cannot see the phone's screen, so step 6 is still yours. `DISPLAYED` means Android accepted the notification, which is strong evidence but not the same as a person seeing it.

### Negative checks

| Check | How | Expected |
|---|---|---|
| Notifications denied | Turn off notifications for the app, then send | `Received` appears, with failure `NOTIFICATIONS_DISABLED` |
| Dead token | Uninstall the app, send twice | The first fails with `TOKEN_UNREGISTERED`. The second shows `PUSH_TOKEN_INVALID`, with no FCM call |
| Token recovery | Reinstall the app and register | A new device row appears, and it receives messages |
| No FCM step | Send with `mtpush` | The form warns, and the target fails with `SIMULATOR_CANNOT_REACH_REAL_DEVICE` |
| Offline phone | Turn on flight mode, send, then turn it off | `Accepted` first. Receipt arrives after reconnecting, within the 24-hour TTL |

Google may take a while to report a token as unregistered after an uninstall, so that check may need repeating.

## Emulator

The Android emulator is not part of the test plan on the development machine. It has 3.6 GB of RAM, and the emulator crashed twice there while Gradle was also running (`0xC0000409`, `0xC0000005`). The system images for Android 30 and 31 on that machine are also incomplete. A real phone is what the assessment requires, and it uses far less of the PC's memory.

## Low memory

Commands on that machine stalled, and Windows reported error `800705af` (page file too small), when `OneDrive.Sync.Service` held 3.3 GB. Stopping it raised available virtual memory from about 2 GB to 8 GB. If commands hang, check for large background processes first.

The private MySQL on port 3307 has stopped by itself several times, leaving no log entry. If the API returns 503, or backend tests cannot connect, run `npm run db:local:start`.

On a machine with enough memory, use a Google APIs image, with `http://10.0.2.2:4000` as the backend URL.
