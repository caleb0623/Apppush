package com.engagelab.apppush.sdk

import android.content.Context
import java.util.UUID

/** Everything the SDK remembers. Private to the host app, and cleared when it is uninstalled. */
internal class Settings(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("apppush", Context.MODE_PRIVATE)

    var backendUrl: String
        get() = prefs.getString(KEY_BACKEND_URL, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_BACKEND_URL, value.trim().trimEnd('/')).apply()

    var appKey: String
        get() = prefs.getString(KEY_APP_KEY, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_APP_KEY, value.trim()).apply()

    /** The host app's version, which the console's analytics group by. */
    val appVersion: String
        get() = appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionName ?: "unknown"

    /** Stable across launches, so the backend sees one device however often the token changes. */
    val installationId: String
        @Synchronized get() = prefs.getString(KEY_INSTALLATION_ID, null)
            ?: UUID.randomUUID().toString().also {
                prefs.edit().putString(KEY_INSTALLATION_ID, it).apply()
            }

    val registrationId: String? get() = prefs.getString(KEY_REGISTRATION_ID, null)
    val deviceSecret: String? get() = prefs.getString(KEY_DEVICE_SECRET, null)
    val isRegistered: Boolean get() = registrationId != null && deviceSecret != null

    var lastToken: String?
        get() = prefs.getString(KEY_LAST_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_LAST_TOKEN, value).apply()

    val recentMessages: List<RecentMessage>
        get() = RecentMessages.parse(prefs.getString(KEY_RECENT_MESSAGES, null)).all

    @Synchronized
    fun addRecentMessage(message: PushMessage) {
        val recent = RecentMessages.parse(prefs.getString(KEY_RECENT_MESSAGES, null))
        recent.add(message, System.currentTimeMillis())
        prefs.edit().putString(KEY_RECENT_MESSAGES, recent.serialize()).apply()
    }

    /** An in-app message waiting for the user to open the app and actually see it. */
    var unseenInAppMsgid: String?
        get() = prefs.getString(KEY_UNSEEN_IN_APP, null)
        set(value) = prefs.edit().putString(KEY_UNSEEN_IN_APP, value).apply()

    fun saveRegistration(registrationId: String, deviceSecret: String?) {
        prefs.edit().putString(KEY_REGISTRATION_ID, registrationId).apply {
            if (deviceSecret != null) putString(KEY_DEVICE_SECRET, deviceSecret)
        }.apply()
    }

    /** Called when the backend no longer knows this device, or the AppKey changes. */
    fun forgetRegistration() {
        prefs.edit()
            .remove(KEY_REGISTRATION_ID)
            .remove(KEY_DEVICE_SECRET)
            .remove(KEY_INSTALLATION_ID)
            .apply()
    }

    /** True the first time a message ID is seen. FCM may deliver the same message twice. */
    @Synchronized
    fun markSeen(msgid: String): Boolean {
        val seen = SeenMessages.parse(prefs.getString(KEY_SEEN, null))
        if (!seen.add(msgid)) return false
        prefs.edit().putString(KEY_SEEN, seen.serialize()).commit()
        return true
    }

    private companion object {
        const val KEY_BACKEND_URL = "backend_url"
        const val KEY_APP_KEY = "app_key"
        const val KEY_INSTALLATION_ID = "installation_id"
        const val KEY_REGISTRATION_ID = "registration_id"
        const val KEY_DEVICE_SECRET = "device_secret"
        const val KEY_LAST_TOKEN = "last_token"
        const val KEY_RECENT_MESSAGES = "recent_messages"
        const val KEY_UNSEEN_IN_APP = "unseen_in_app"
        const val KEY_SEEN = "seen_messages"
    }
}

/** A bounded, ordered set of recent message IDs. */
internal class SeenMessages(private val ids: ArrayDeque<String> = ArrayDeque()) {
    fun add(msgid: String): Boolean {
        if (msgid in ids) return false
        ids.addLast(msgid)
        while (ids.size > MAX_SIZE) ids.removeFirst()
        return true
    }

    fun serialize(): String = ids.joinToString(SEPARATOR)

    companion object {
        const val MAX_SIZE = 200
        private const val SEPARATOR = ","

        fun parse(text: String?): SeenMessages =
            SeenMessages(ArrayDeque(text?.split(SEPARATOR)?.filter { it.isNotBlank() }.orEmpty()))
    }
}
