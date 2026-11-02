# Firebase setup and real-device test

This guide takes you from no Firebase configuration to a real notification on an Android phone. Allow about 20 minutes.

Two different Firebase files are involved. They are easy to confuse:

| File | Used by | Secret? | Goes in |
|---|---|---|---|
| `google-services.json` | The Android app | No, but keep it out of Git anyway | `android/app/` |
| Service account key (`...firebase-adminsdk...json`) | The backend, to send through FCM | **Yes.** It can send to all your users | `backend/secrets/` |

Both are ignored by Git. Never commit them, and never put the service account key in frontend code.

## Current state of this repository

| Step | Status |
|---|---|
| 1 to 3. Firebase project and Android app | Done: project `engage-2c0f7`, package `com.caleb.engagelab` |
| 4. Android project configured | Done: `android/app/google-services.json` is in place and the APK builds |
| 5 and 6. Service account key | Done, and accepted by Google |
| 7 to 9. Real device test | Done on a Samsung Galaxy Tab A8. See [testing.md](testing.md) |

If you start again with a different Firebase project, work through every step.

## 1. Create a Firebase project

1. Open <https://console.firebase.google.com> and choose **Add project**.
2. Enter a name. Google Analytics is not needed.

## 2. Register the Android app

1. In the project overview, choose the **Android** icon.
2. Enter this package name exactly: `com.caleb.engagelab`
3. Skip the SHA-1 and the SDK steps. They are not needed for FCM, and the project already contains the SDK.

The package name must equal `applicationId` in [android/app/build.gradle.kts](../android/app/build.gradle.kts). If you register a different one, change that line to match.

## 3. Download the Android configuration

Download `google-services.json` from **Project settings > General > Your apps**.

## 4. Configure the Android project

Put the file at `android/app/google-services.json`, then rebuild. The build applies the Google Services plugin only when this file exists. A build without it still succeeds, and the app then shows what is missing.

## 5. Create the backend service credentials

1. In the Firebase console, open **Project settings > Service accounts**.
2. Choose **Generate new private key**, and confirm. A JSON file downloads.
3. Create the folder `backend/secrets/` and save the file there as `firebase-service-account.json`.

The FCM API is enabled by default on new projects. If `npm run fcm:check` reports a permission error, enable **Firebase Cloud Messaging API (V1)** under **Project settings > Cloud Messaging**.

## 6. Configure the backend

Add this line to `backend/.env`:

```
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
```

Check it. This uses FCM's validate-only mode, so nothing reaches any phone:

```powershell
npm run fcm:check
```

Expected result:

```
Service account loaded for Firebase project "engage-2c0f7".
OK: Google accepted the credentials. It rejected only the placeholder token, as expected.
```

Restart the API and the worker afterwards, because they read the key at startup. The top bar of the console then shows **FCM configured**, and <http://localhost:4000/api/health> shows `"configured": true`.

## 7. Register a real Android device

1. Start the system: `npm run db:local:start`, then `npm run dev`.
2. In the console, create an application and copy its **AppKey** from the application page. Save the Master Secret if you plan to use `npm run test:fcm:real`, because it is shown only once.
3. Connect the phone by USB, with USB debugging on, and install the app:

   ```powershell
   cd android
   .\gradlew.bat installDebug
   adb reverse tcp:4000 tcp:4000
   ```

   If `adb` is not recognised, use `$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe`.
4. Open **AppPush Demo** on the phone and allow notifications.
5. Keep the backend URL `http://127.0.0.1:4000`, which `adb reverse` forwards to this PC. Paste the AppKey and press **Save and register**.
6. **Test backend connection** should report your application and `FCM on the backend: configured`.

The phone now appears on the **Devices** page as a **Real phone**.

### Without a USB cable

Wireless debugging works on Android 11 and newer, and needs no firewall change:

1. Put the phone and PC on the same Wi-Fi.
2. On the phone, open **Developer options > Wireless debugging**, and choose **Pair device with pairing code**.
3. Pair, using the address and code in that popup: `adb pair <ip>:<pairing port> <code>`
4. Connect, using the different port on the main Wireless debugging screen: `adb connect <ip>:<connect port>`
5. Run `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`, then `adb reverse tcp:4000 tcp:4000`.

The connect port changes whenever Wireless debugging restarts, and `adb reverse` must then be repeated.

Otherwise, use your PC's Wi-Fi address (from `ipconfig`) as the backend URL, such as `http://192.168.1.20:4000`, and allow inbound TCP port 4000 through Windows Firewall.

## 8. Send a test notification

1. Open **New push** in the console.
2. Enter a title and body.
3. Set **Audience** to **Selected devices**, and tick your phone.
4. Set **Delivery strategy** to `fcm_mtpush`.
5. Press **Send push**.

Only `fcm_mtpush` and `mtpush_fcm` can reach a phone, unless you choose **FCM only** as the channel. The page warns you about the others.

## 9. Verify that the phone received it

Do this twice: once with the app open, and once after pressing Home.

| What to check | Where | Meaning |
|---|---|---|
| The notification appears on the phone | **Your own eyes** | The only proof it was really on screen |
| `Accepted by provider (provider response)`, with an FCM message ID | Message details | Google took it. This says nothing about the phone |
| `Received by device (reported by the device)` | Message details | The app received it |
| `Displayed (reported by the device)` | Message details | The app showed it |
| Tap it, then `Clicked (reported by the device)` | Message details | The tap was recorded |

Message details updates by itself for five minutes after a send.

For a guided version that checks each stage:

```powershell
npm run test:fcm:real -- --app-key <AppKey> --master-secret <MasterSecret> --registration-id <rid_...> --confirm
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sends fail with `FCM_NOT_CONFIGURED` | No service account key loaded | Steps 5 and 6, then restart the API and worker |
| `SENDER_ID_MISMATCH` | `google-services.json` and the service account come from different projects | Use files from the same project, rebuild, and re-register |
| `TOKEN_UNREGISTERED` or `PUSH_TOKEN_INVALID` | The token died, usually after a reinstall | Open the app. It registers a new token |
| `SIMULATOR_CANNOT_REACH_REAL_DEVICE` | The plan has no FCM step | Use `fcm_mtpush` or `mtpush_fcm` |
| Accepted by provider, but nothing arrives | No Google Play services, no internet, or the phone blocked the app | See below |
| `Connection failed` in the app | `adb reverse` was lost, or the firewall blocks port 4000 | Run `adb reverse` again after each reconnect |
| `DISPLAY_FAILED: NOTIFICATIONS_DISABLED` | Notifications are off for the app | Press **Allow notifications** in the app |
| Windows shows no phone at all on USB | The cable only charges | Use a data cable, or wireless debugging |
| `INSTALL_FAILED_VERIFICATION_FAILURE` on Samsung | Installation blocked on the device, most likely by Auto Blocker | Turn off **Security and privacy > Auto Blocker** and **Verify apps over USB**. This cleared it on the test tablet |

**Phones that block background apps.** Xiaomi, Huawei, OPPO, Vivo and similar phones may refuse to wake an app you swiped away, and force-stopping any app blocks FCM until it is opened again. Allow autostart and remove battery restrictions for the app. If it still fails, set `FCM_PAYLOAD_MODE=hybrid` in `backend/.env` and restart. Android then draws the notification itself, which works more often, but the app cannot see background messages, so only the tap is reported.

**Phones without Google Play services**, including recent Huawei phones, cannot use FCM.
