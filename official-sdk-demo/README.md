# EngageLab Official SDK Demo

A small Android app that integrates EngageLab's official AppPush Android SDK, version 5.5.3. Notifications are sent from the EngageLab console. This app does not use the backend or SDK in the rest of this repository.

| Setting | Value |
|---|---|
| Package name | `com.caleb.engagelab.official` |
| SDK file | `app/libs/mt-sdk-5.5.3-engagelab.aar` |
| AppKey | `manifestPlaceholders` in `app/build.gradle` |

The AppKey is tied to the package name in the console. Never put the Master Secret in the app.

## Build and install

```powershell
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The app shows the connection state and the Registration ID. It does not need a cable or a local backend.

## Test result

On 2026-11-02 a notification sent from the EngageLab console reached a Samsung Galaxy Tab A8 running Android 14 with the app in the background. The SDK reported it as arrived, and it was in the tablet's notification list. This run did not test a tap, or a phone with the app closed.

## Where the integration is

| File | Purpose |
|---|---|
| `app/build.gradle` | Adds the SDK and sets the AppKey, channel and process |
| `app/src/main/AndroidManifest.xml` | Declares the SDK service and receiver |
| `MainApplication.java` | Starts the SDK |
| `UserService.java` | Helps the SDK's connection survive |
| `UserReceiver.java` | Receives connection, arrival and tap callbacks |
| `MainActivity.java` | Asks for notification permission and shows the status |

This app uses only EngageLab's own channel, which needs its connection to be alive. Reaching a phone while the app is closed needs a vendor channel, such as FCM, set up in the console and added to the app.
