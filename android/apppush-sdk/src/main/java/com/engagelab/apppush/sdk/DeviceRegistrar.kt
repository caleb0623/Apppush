package com.engagelab.apppush.sdk

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/** Keeps the backend's copy of this device and its FCM token up to date. */
internal class DeviceRegistrar(context: Context) {
    private val appContext = context.applicationContext
    private val settings = Settings(appContext)
    private val api = ApiClient(settings)

    /** False until google-services.json has been added and the app rebuilt. */
    fun firebaseReady(): Boolean = FirebaseApp.getApps(appContext).isNotEmpty()

    /** Sends the current token and device details. Safe to call on every launch. */
    suspend fun sync() {
        check(settings.appKey.isNotBlank()) { "AppKey is not set" }
        val token = FirebaseMessaging.getInstance().token.await()
        settings.lastToken = token
        save(api.register(token, notificationsEnabled()))
    }

    /** Handles a token the system replaced while the app may not be open. */
    suspend fun refreshToken(token: String) {
        settings.lastToken = token
        // Before the first registration there is nobody to tell; sync() will send it.
        if (settings.appKey.isBlank() || !settings.isRegistered) return
        try {
            api.updateToken(token)
        } catch (error: ApiException) {
            if (!error.deviceUnknown) throw error
            // Deleted in the console: come back as a new device.
            settings.forgetRegistration()
            save(api.register(token, notificationsEnabled()))
        }
    }

    private fun notificationsEnabled(): Boolean =
        NotificationManagerCompat.from(appContext).areNotificationsEnabled()

    private fun save(data: JSONObject) {
        val secret = data.optString("deviceSecret").takeUnless { it.isEmpty() || it == "null" }
        settings.saveRegistration(data.getString("registrationId"), secret)
    }
}
