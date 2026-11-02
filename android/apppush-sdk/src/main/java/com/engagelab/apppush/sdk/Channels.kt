package com.engagelab.apppush.sdk

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

internal object Channels {
    const val REPORTING = "apppush_reporting"

    /** Safe to repeat. Android keeps a user's choices for a channel and only updates its text. */
    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val messages = NotificationChannel(
            context.getString(R.string.apppush_notification_channel_id),
            context.getString(R.string.apppush_notification_channel_name),
            // High importance is what makes a message appear as a heads-up banner.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = context.getString(R.string.apppush_notification_channel_description) }
        val reporting = NotificationChannel(
            REPORTING,
            context.getString(R.string.apppush_reporting_channel_name),
            NotificationManager.IMPORTANCE_MIN,
        )
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannels(listOf(messages, reporting))
    }
}
