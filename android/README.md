# AppPush for Android

| Module | What it is |
|---|---|
| `apppush-sdk` | The SDK that other Android apps add. It registers with the backend, receives FCM messages, shows them, and reports each stage back. See [docs/android-sdk.md](../docs/android-sdk.md) |
| `app` | A small demo app built only on the SDK's public API. It proves that real notifications arrive |

## Requirements

- Android Studio Flamingo (2022.2) or newer, or the command line with JDK 17
- Android SDK 33 and build tools 33.0.0
- A phone with Android 7.0 or newer and Google Play services
- `app/google-services.json`, which is not in Git. See [docs/firebase-setup.md](../docs/firebase-setup.md)

Versions are pinned to what Android Studio Flamingo can open: AGP 8.0.2, Gradle 8.0.2, Kotlin 1.8.22 and SDK 33. If you upgrade the IDE, you can raise them together.

## Build and install

In Android Studio: open the `android` folder and press **Run**.

From PowerShell, with a phone connected by USB:

```powershell
cd android
.\gradlew.bat installDebug
adb reverse tcp:4000 tcp:4000
```

Other commands:

```powershell
.\gradlew.bat assembleDebug        # APK at app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat testDebugUnitTest    # Unit tests
.\gradlew.bat --stop               # Frees the memory used by Gradle's background processes
.\gradlew.bat :apppush-sdk:publishReleasePublicationToLocalRepository   # The SDK, as a Maven repository in apppush-sdk\build\repo
```

The first build downloads a few hundred megabytes and took about 9 minutes on a 3.6 GB machine. Close other applications first if memory is low.

## An APK to install directly

The release APK runs without a cable or `adb`. It needs a signing key, which stays out of Git. Create it once:

```powershell
keytool -genkeypair -keystore release.keystore -storetype PKCS12 -alias apppush -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=AppPush Demo"
```

Then add `android/keystore.properties`:

```properties
storeFile=release.keystore
keyAlias=apppush
password=<the password you chose>
```

Build it with this PC's Wi-Fi address and the application's AppKey:

```powershell
.\gradlew.bat assembleRelease "-Papppush.backendUrl=http://192.168.1.243:4000" "-Papppush.appKey=<AppKey>"
```

The APK is at `app\build\outputs\apk\release\app-release.apk`. On the phone:

1. Allow installs from unknown sources. On Samsung, turn off Auto Blocker too.
2. Uninstall any debug build first. It has a different signature, so Android refuses to replace it.
3. Install the APK and open it. It registers by itself.

The backend still runs on this PC, so `npm run dev` must be running. The phone needs the same Wi-Fi to register and to report receipts. Once registered, it can receive notifications on any network, and its reports wait until it can reach the backend again. If the PC's address changes, edit the backend URL in the app's Connection section.

Keep `release.keystore` and its password safe. A later version signed with another key cannot replace this one.

## Connecting to the backend

The backend URL and AppKey are edited on the phone. Defaults can be set in `gradle.properties`.

| Setup | Backend URL |
|---|---|
| USB cable, after `adb reverse tcp:4000 tcp:4000` | `http://127.0.0.1:4000` |
| Android emulator | `http://10.0.2.2:4000` |
| Phone on the same Wi-Fi | `http://<your PC's address>:4000`, with port 4000 open in Windows Firewall |

`adb reverse` must be repeated each time the phone reconnects.

## How it works

| File | Purpose |
|---|---|
| `AppPush.kt` | The SDK's public API |
| `Channels.kt` | Creates the notification channels |
| `DeviceRegistrar.kt` | Gets the FCM token and registers it. Runs on every launch |
| `AppPushMessagingService.kt` | Receives messages and token refreshes |
| `NotificationRenderer.kt` | Draws the notification, in the requested style |
| `EventReporter.kt` | Reports events through WorkManager, so they survive no network and restarts |
| `Settings.kt` | Stored settings, the last 10 messages, and the record of message IDs already seen |
| `ApiClient.kt` | Calls the backend's client API |

These are all in `apppush-sdk`. The demo app is `AppPushApplication.kt`, which starts the SDK, and `MainActivity.kt`, the home screen with its status, messages and Connection section.

**Reported events.** Each report means that thing really happened on this phone:

| Event | Sent when |
|---|---|
| `DELIVERED` | `onMessageReceived` ran |
| `DISPLAYED` | Android accepted the notification, or an in-app message was on screen |
| `DISPLAY_FAILED` | The message arrived, but notifications are off for this app |
| `CLICKED` | The user tapped the notification |

**Foreground and background.** The backend sends data-only messages, so `onMessageReceived` runs in both cases and the app always draws the notification itself.

**Duplicates.** FCM can deliver a message twice. `Settings.markSeen` remembers the last 200 message IDs, and a repeat is ignored. The notification is also tagged with the message ID, and the backend ignores repeated reports.

**Token refresh.** `onNewToken` sends the new token straight away. If that fails, the next launch sends it again.

**Language.** The button at the top of the home screen switches between English and Simplified Chinese. AppCompat remembers the choice, and the screen reloads in the new language. English text is in `res/values/strings.xml`, and Chinese is in `res/values-zh/strings.xml`. Text written in the console is shown as it was sent.

## Tests

`testDebugUnitTest` runs both modules. It covers payload parsing, duplicate detection, the stored message list, and that every string exists in both languages. Everything that needs a real device is covered by the procedure in [docs/testing.md](../docs/testing.md).
