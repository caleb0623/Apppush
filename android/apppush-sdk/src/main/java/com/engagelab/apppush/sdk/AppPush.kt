package com.engagelab.apppush.sdk

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

/** Where this app's devices register. The AppKey is public, so it is safe to ship in an app. */
data class AppPushConfig(val backendUrl: String, val appKey: String)

/** What the backend said about this app and device. For a settings or support screen. */
data class AppPushConnection(
    val application: String,
    val environment: String,
    val fcmConfigured: Boolean,
    val tokenStatus: String?,
)

fun interface AppPushListener {
    /** Called on the main thread, while the app's process is running. */
    fun onMessage(message: PushMessage)
}

/**
 * The SDK's only entry point. Call [init] from Application.onCreate, then [register].
 * Showing notifications and reporting delivery need no further code.
 */
object AppPush {
    internal const val EXTRA_CLICKED_MSGID = "com.engagelab.apppush.sdk.CLICKED_MSGID"

    private lateinit var appContext: Context
    private val listeners = CopyOnWriteArraySet<AppPushListener>()
    private val mainThread by lazy { Handler(Looper.getMainLooper()) }

    private val settings: Settings
        get() {
            check(::appContext.isInitialized) { "Call AppPush.init from Application.onCreate first" }
            return Settings(appContext)
        }

    /** Safe to call again. A different AppKey means a different app, so the device registers afresh. */
    fun init(context: Context, config: AppPushConfig) {
        appContext = context.applicationContext
        val settings = settings
        val appKey = config.appKey.trim()
        if (appKey != settings.appKey) settings.forgetRegistration()
        settings.appKey = appKey
        settings.backendUrl = config.backendUrl
        Channels.create(appContext)
    }

    /** The configuration from the last [init], for an app that lets people edit it. */
    fun savedConfig(context: Context): AppPushConfig? {
        val saved = Settings(context)
        return AppPushConfig(saved.backendUrl, saved.appKey).takeIf { it.appKey.isNotBlank() }
    }

    val config: AppPushConfig get() = settings.let { AppPushConfig(it.backendUrl, it.appKey) }

    /** False until google-services.json has been added to the app and it has been rebuilt. */
    val isFirebaseReady: Boolean get() = DeviceRegistrar(appContext).firebaseReady()

    val isRegistered: Boolean get() = settings.isRegistered

    /** The ID that the console and the API use to target this device. */
    val registrationId: String? get() = settings.registrationId

    val pushToken: String? get() = settings.lastToken

    /** Registers this device, or refreshes its details. Safe to call on every launch. */
    suspend fun register(): String {
        check(isFirebaseReady) { "Firebase is not set up: add google-services.json to the app" }
        DeviceRegistrar(appContext).sync()
        return checkNotNull(settings.registrationId) { "The backend returned no registration ID" }
    }

    suspend fun checkConnection(): AppPushConnection {
        val data = ApiClient(settings).ping()
        return AppPushConnection(
            application = data.optString("application"),
            environment = data.optString("environment"),
            fcmConfigured = data.optBoolean("fcmConfigured"),
            tokenStatus = data.optJSONObject("device")?.optString("pushTokenStatus"),
        )
    }

    /**
     * Reports a notification tap. Pass every intent from the launcher screen's onCreate and
     * onNewIntent. Returns true if the intent came from a notification.
     */
    fun handleIntent(intent: Intent?): Boolean {
        val extras = intent?.extras ?: return false
        // Without this key, a msgid extra belongs to the host app and not to a tap.
        val hybridTap = extras.containsKey("google.message_id")
        val msgid = extras.getString(EXTRA_CLICKED_MSGID)
            ?: extras.getString("msgid").takeIf { hybridTap }
            ?: return false
        EventReporter.report(appContext, msgid, EventReporter.CLICKED)
        return true
    }

    /** The newest messages on this device, newest first. */
    val recentMessages: List<RecentMessage> get() = settings.recentMessages

    /** Call once an in-app message is on screen. Display cannot be known until then. */
    fun markInAppSeen() {
        val settings = settings
        val msgid = settings.unseenInAppMsgid ?: return
        settings.unseenInAppMsgid = null
        EventReporter.report(appContext, msgid, EventReporter.DISPLAYED)
    }

    fun addListener(listener: AppPushListener) {
        listeners.add(listener)
    }

    fun removeListener(listener: AppPushListener) {
        listeners.remove(listener)
    }

    /** Applies the app's current language to the names shown in Android's settings. */
    fun updateNotificationChannels(context: Context) = Channels.create(context)

    internal fun notifyListeners(message: PushMessage) {
        mainThread.post { listeners.forEach { it.onMessage(message) } }
    }
}
