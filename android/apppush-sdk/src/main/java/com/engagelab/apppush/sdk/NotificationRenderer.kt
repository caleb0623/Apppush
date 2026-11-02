package com.engagelab.apppush.sdk

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.net.HttpURLConnection
import java.net.URL

/** Draws a push message on the phone. Returns false if the system refused to show it. */
internal class NotificationRenderer(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    fun canDisplay(): Boolean = manager.areNotificationsEnabled()

    fun show(message: PushMessage): Boolean {
        val builder = NotificationCompat.Builder(context, context.getString(R.string.apppush_notification_channel_id))
            .setSmallIcon(R.drawable.apppush_ic_notification)
            .setContentTitle(message.title)
            .setContentText(message.body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(clickIntent(message.msgid))
        applyStyle(builder, message)

        return try {
            // The msgid is the tag, so a repeat replaces the notification rather than adding one.
            manager.notify(message.msgid, NOTIFICATION_ID, builder.build())
            true
        } catch (error: SecurityException) {
            false
        }
    }

    private fun applyStyle(builder: NotificationCompat.Builder, message: PushMessage) {
        val config = message.styleConfig
        when (message.style) {
            "TEXT" -> builder.setStyle(
                NotificationCompat.BigTextStyle().bigText(config?.optString("bigText") ?: message.body),
            )
            "INBOX" -> {
                val style = NotificationCompat.InboxStyle()
                val lines = config?.optJSONArray("lines")
                for (index in 0 until (lines?.length() ?: 0)) style.addLine(lines?.optString(index))
                builder.setStyle(style)
            }
            "BIG_PICTURE" -> download(config?.optString("pictureUrl"))?.let { picture ->
                builder.setLargeIcon(picture)
                    .setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture))
            }
            "THUMBNAIL" -> download(config?.optString("thumbnailUrl"))?.let(builder::setLargeIcon)
            // CUSTOM names a layout the backend cannot deliver; the text still shows.
        }
    }

    /** Best effort: a missing picture must not cost the user the message. */
    private fun download(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        return runCatching {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = IMAGE_TIMEOUT_MS
            connection.readTimeout = IMAGE_TIMEOUT_MS
            try {
                connection.inputStream.use(BitmapFactory::decodeStream)
            } finally {
                connection.disconnect()
            }
        }.getOrNull()
    }

    /** Opens the host app. Its launcher screen passes the intent to AppPush.handleIntent. */
    private fun clickIntent(msgid: String): PendingIntent? {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        intent.putExtra(AppPush.EXTRA_CLICKED_MSGID, msgid)
        // A distinct request code per message, or Android reuses the previous intent's extras.
        return PendingIntent.getActivity(
            context,
            msgid.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val NOTIFICATION_ID = 1
        const val IMAGE_TIMEOUT_MS = 5_000
    }
}
