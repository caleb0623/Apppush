# EngageLab AppPush: Technical Assessment

A local push notification platform: a Vue admin console, a Node.js API and worker, MySQL, and an Android app. An administrator creates a notification in the console, the backend sends it through Firebase Cloud Messaging, and it appears on a real Android phone. The phone then reports receipt, display and clicks back to the dashboard.

## What is real and what is simulated

| Part | Status |
|---|---|
| FCM delivery to Android phones | **Real**, through the FCM HTTP v1 API |
| Receipt, display and click events from the phone | **Real**, reported by the Android app |
| Huawei, Honor, Xiaomi, Meizu, OPPO, Vivo, APNs, HarmonyOS and `mtpush` | **Simulated**, behind separate adapters, and labelled as simulated everywhere |
| Devices created in the console | **Simulated records**, used to demonstrate fallback and analytics |

A simulator never reports a delivery to a real phone. A phone is reached only by a plan that includes FCM. See [docs/technical-decisions.md](docs/technical-decisions.md).

The console and the Android app are available in English and Simplified Chinese. One button switches the language, and the choice is remembered.

## Requirements

- Windows with VS Code
- Node.js 22.12 or newer
- MySQL 8 (the project can run its own private instance using the installed binaries)
- For Android: JDK 17 and Android SDK 33, or Android Studio Flamingo or newer
- For real delivery: a Firebase project and an Android phone with Google Play services

## Quick start

```powershell
npm install
npm run setup:env       # Creates backend/.env with generated secrets
npm run db:local:init   # Starts a private MySQL on port 3307 and creates the databases
npm run db:migrate      # Applies the Prisma migrations
npm run db:seed         # Creates the admin user and demo data
npm run dev             # Starts the API, worker and console
```

The admin password is `SEED_ADMIN_PASSWORD` in `backend/.env`. The email is `admin@apppush.local`.

To use your existing MySQL instead, run `npm run setup:env -- --port=3306`, then run the statements in `.local/setup-mysql.sql` as an administrator. Skip `db:local:init`.

After a restart, run `npm run db:local:start` before `npm run dev`.

| Service | Address |
|---|---|
| Console | <http://localhost:5173> |
| API | <http://localhost:4000> |
| Swagger | <http://localhost:4000/api/docs> |
| Health check | <http://localhost:4000/api/health> |

## Real notifications

Everything else works without Firebase. To reach a phone, follow **[docs/firebase-setup.md](docs/firebase-setup.md)**. In short:

1. Save the service account key as `backend/secrets/firebase-service-account.json`.
2. Add `FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json` to `backend/.env`.
3. Run `npm run fcm:check`, then restart `npm run dev`.
4. Install the app with `cd android; .\gradlew.bat installDebug`, then run `adb reverse tcp:4000 tcp:4000`.
5. Enter the AppKey in the app, and send from **New push** with the `fcm_mtpush` strategy.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API, worker and console, with reload |
| `npm run dev:api`, `dev:worker`, `dev:web` | One service at a time |
| `npm run build`, then `npm start` | Production build |
| `npm test` | All backend and frontend tests. Never sends real notifications |
| `npm run test:unit`, `test:integration`, `test:frontend` | One test suite |
| `npm run test:e2e` | Browser journey. Needs the system running |
| `npm run test:fcm:real -- ...` | Real-phone test. Sends one real notification, and requires `--confirm` |
| `npm run fcm:check` | Validates Firebase credentials without sending anything |
| `npm run typecheck`, `lint`, `verify` | Static checks, or everything |
| `npm run db:local:start`, `stop`, `status` | Private MySQL |

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Express API, worker, Prisma schema and migrations, tests |
| `frontend/` | Vue 3 admin console |
| `android/` | The Android SDK and its demo app. See [android/README.md](android/README.md) |
| `official-sdk-demo/` | A separate app using EngageLab's official SDK. See [official-sdk-demo/README.md](official-sdk-demo/README.md) |
| `e2e/` | Browser journey test |
| `scripts/` | Environment setup, local MySQL and the real-phone test |
| `docs/` | Documentation |

## Documentation

| Document | Contents |
|---|---|
| [android-sdk.md](docs/android-sdk.md) | Adding push to your own Android app with the SDK |
| [firebase-setup.md](docs/firebase-setup.md) | Firebase setup and the real-device test |
| [requirements.md](docs/requirements.md) | Requirements, assumptions and traceability |
| [architecture.md](docs/architecture.md) | How the system fits together |
| [database-design.md](docs/database-design.md) | Tables and constraints |
| [api-documentation.md](docs/api-documentation.md) | API overview |
| [testing.md](docs/testing.md) | Test strategy, results and the real-phone procedure |
| [technical-decisions.md](docs/technical-decisions.md) | Decisions and their trade-offs |
| [interview-guide.md](docs/interview-guide.md) | Demonstration script and likely questions |

## Security notes

- Master Secrets and device secrets are stored only as keyed hashes, and are shown once.
- FCM tokens are never returned by the API, and are redacted from logs.
- Firebase credentials are read from a Git-ignored file or an environment variable.
- The AppKey inside the Android app is public by design. A device can only act for itself, using its own secret.
- The demo uses plain HTTP on a local network. A real deployment needs HTTPS.
