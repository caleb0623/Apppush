# AppPush Android SDK

Add push notifications to your Android app. The SDK registers the device, receives messages through Firebase Cloud Messaging (FCM), shows notifications, and reports delivery, display and taps to the AppPush console.

## Requirements

- `minSdk` 24 or higher, and `compileSdk` 33 or higher
- Kotlin. `AppPush.register` is a suspend function
- A Firebase project with your app's package name added
- An AppKey from the AppPush console
- An AppPush backend that your users' phones can reach
- Phones with Google Play services. FCM cannot reach a phone without them

Tested with Android Gradle Plugin 8.0.2, Gradle 8.0.2 and Kotlin 1.8.22.

## Quick start

### 1. Add the SDK

Unzip `AppPush-Android-SDK-1.0.0.zip` and copy its `repo` folder into your project. Then add it to `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("repo") }
    }
}
```

Add the dependency to `app/build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.engagelab:apppush-sdk:1.0.0")
}
```

Firebase and the SDK's other dependencies are added for you.

### 2. Add Firebase

Download `google-services.json` from the Firebase console and put it in your `app` folder. Then add the Google Services plugin to `app/build.gradle.kts`:

```kotlin
plugins {
    id("com.google.gms.google-services") version "4.3.15"
}
```

### 3. Initialise the SDK

Do this in your `Application` class, and register that class in your manifest with `android:name`:

```kotlin
class ShopApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppPush.init(this, AppPushConfig(backendUrl = "https://push.example.com", appKey = "YOUR_APP_KEY"))
    }
}
```

The AppKey is public, so it is safe in your app. Never put the Master Secret in an app.

### 4. Ask for permission and register

Do this on your launcher screen, and pass its intents to the SDK so that taps are reported:

```kotlin
class MainActivity : AppCompatActivity() {
    private val requestPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        if (savedInstanceState == null) AppPush.handleIntent(intent)
        lifecycleScope.launch {
            runCatching { AppPush.register() }
                .onSuccess { Log.i("Shop", "Registered as $it") }
                .onFailure { Log.w("Shop", "Could not register", it) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        AppPush.handleIntent(intent)
    }
}
```

`register` is safe to call on every launch.

### 5. Send a message

Run the app, and find the device under **Devices** in the console. Send it a notification from **New push**, with the strategy `fcm_mtpush`.

The SDK shows the notification, whether your app is open, in the background or closed. A tap opens your launcher screen.

## Receiving messages in your code

Add a listener to react while your app is running. It is called on the main thread:

```kotlin
private val listener = AppPushListener { message ->
    Log.i("Shop", "${message.type}: ${message.title}")
}

override fun onStart() {
    super.onStart()
    AppPush.addListener(listener)
}

override fun onStop() {
    AppPush.removeListener(listener)
    super.onStop()
}
```

| Message type | What the SDK does | What you do |
|---|---|---|
| `NOTIFICATION` | Shows it | Nothing |
| `IN_APP` | Stores it and tells listeners | Show it, then call `AppPush.markInAppSeen()` |
| `CUSTOM` | Stores it and tells listeners | Read `message.payload`, a JSON string |

`AppPush.recentMessages` holds the last 10 messages. Use it for messages that arrived while your app was closed.

## Customising

**Notification icon.** Add a drawable named `apppush_ic_notification` to your app. It replaces the SDK's icon.

**Language.** Channel names are in English and Simplified Chinese. If your app changes language at run time, call `AppPush.updateNotificationChannels(activity)` afterwards.

**Your own FCM service.** Android sends FCM messages to one service. If your app has its own, extend the SDK's service, and remove the SDK's entry from your manifest:

```kotlin
class MyMessagingService : AppPushMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage) // Ignores messages that AppPush did not send.
        // Your own handling.
    }
}
```

```xml
<service android:name="com.engagelab.apppush.sdk.AppPushMessagingService" tools:node="remove" />
<service android:name=".MyMessagingService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

**Plain HTTP.** Android blocks `http://` addresses by default. Use HTTPS. For local testing only, allow plain HTTP with a [network security configuration](https://developer.android.com/privacy-and-security/security-config), as the demo app does.

## API

| Member | Purpose |
|---|---|
| `init(context, config)` | Sets the backend and AppKey. A different AppKey registers the device afresh |
| `savedConfig(context)` | The configuration from the last `init`, or null |
| `config` | The current configuration |
| `register()` | Registers the device and returns its registration ID |
| `isRegistered`, `registrationId`, `pushToken` | The device's current state |
| `isFirebaseReady` | False if `google-services.json` is missing |
| `checkConnection()` | Asks the backend about this app and device. For support screens |
| `handleIntent(intent)` | Reports a notification tap. Returns true if the intent was one |
| `addListener(listener)`, `removeListener(listener)` | Tells your code about incoming messages |
| `recentMessages` | The last 10 messages, newest first |
| `markInAppSeen()` | Reports that a waiting in-app message is on screen |
| `updateNotificationChannels(context)` | Renames channels after a language change |

`register` and `checkConnection` throw `IOException` when the backend cannot be reached, and `ApiException`, which is an `IOException`, when it refuses the request. Calling them before `init` throws `IllegalStateException`.

## What the SDK reports

| Event | Sent when |
|---|---|
| `DELIVERED` | The message reached the phone |
| `DISPLAYED` | Android accepted the notification, or you called `markInAppSeen` |
| `DISPLAY_FAILED` | The message arrived, but notifications are off for your app |
| `CLICKED` | The user tapped the notification, and you passed the intent to `handleIntent` |

Reports are queued, so they survive having no network, a closed app and a restart. FCM can deliver a message twice. The SDK shows and reports it once.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Call AppPush.init from Application.onCreate first` | `init` has not run. Check `android:name` on your `<application>` |
| `Firebase is not set up` | `google-services.json` or the Google Services plugin is missing |
| `register` times out | The phone cannot reach `backendUrl` |
| `CLEARTEXT communication not permitted` | See **Plain HTTP** above |
| The device is listed, but nothing arrives | The strategy has no FCM step. Use `fcm_mtpush` or `mtpush_fcm` |
| Tap counts stay at zero | `handleIntent` is not called from both `onCreate` and `onNewIntent` |
