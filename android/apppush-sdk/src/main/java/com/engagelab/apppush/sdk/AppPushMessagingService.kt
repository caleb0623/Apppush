package com.engagelab.apppush.sdk

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Receives every message. The backend sends data-only messages, so this runs
 * whether the app is in front, in the background or not running at all.
 *
 * Open, so an app with its own FCM service can extend this one instead. See docs/android-sdk.md.
 */
open class AppPushMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val message = PushMessage.from(remoteMessage.data) ?: return
        val settings = Settings(this)

        // FCM can deliver a message twice. Only the first copy is shown and reported.
        if (!settings.markSeen(message.msgid)) {
            Log.i(TAG, "Ignoring duplicate ${message.msgid}")
            return
        }
        Log.i(TAG, "Received ${message.msgid} (${message.type})")

        EventReporter.report(this, message.msgid, EventReporter.DELIVERED)
        settings.addRecentMessage(message)

        when {
            message.isNotification -> display(message)
            // Displayed is reported through AppPush.markInAppSeen, once it is really on screen.
            message.isInApp -> settings.unseenInAppMsgid = message.msgid
        }

        AppPush.notifyListeners(message)
    }

    private fun display(message: PushMessage) {
        Channels.create(this)
        val renderer = NotificationRenderer(this)
        if (!renderer.canDisplay()) {
            EventReporter.report(this, message.msgid, EventReporter.DISPLAY_FAILED, "NOTIFICATIONS_DISABLED")
            return
        }
        if (renderer.show(message)) {
            EventReporter.report(this, message.msgid, EventReporter.DISPLAYED)
        } else {
            EventReporter.report(this, message.msgid, EventReporter.DISPLAY_FAILED, "NOTIFY_REJECTED")
        }
    }

    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token refreshed")
        val registrar = DeviceRegistrar(this)
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { registrar.refreshToken(token) }
                .onFailure { Log.w(TAG, "Could not send the new token; it is retried on next launch", it) }
        }
    }

    private companion object {
        const val TAG = "AppPush"
    }
}
