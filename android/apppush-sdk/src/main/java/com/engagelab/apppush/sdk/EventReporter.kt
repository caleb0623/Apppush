package com.engagelab.apppush.sdk

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Reports what happened to a message. WorkManager carries the report, so it
 * survives no network, a killed process and a reboot. A report is only sent
 * because the matching thing really happened on this phone.
 */
internal object EventReporter {
    const val DELIVERED = "DELIVERED"
    const val DISPLAYED = "DISPLAYED"
    const val CLICKED = "CLICKED"
    const val DISPLAY_FAILED = "DISPLAY_FAILED"

    fun report(context: Context, msgid: String, type: String, reason: String? = null) {
        val input = Data.Builder()
            .putString(EventWorker.KEY_MSGID, msgid)
            .putString(EventWorker.KEY_TYPE, type)
            .putString(EventWorker.KEY_OCCURRED_AT, timestamp())
            .putString(EventWorker.KEY_REASON, reason)
            .build()
        val request = OneTimeWorkRequestBuilder<EventWorker>()
            .setInputData(input)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            // Expedited, because a backgrounded app's ordinary work can wait for minutes.
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        // Keyed by message and stage, so a repeated report does not queue twice.
        WorkManager.getInstance(context)
            .enqueueUniqueWork("event-$msgid-$type", ExistingWorkPolicy.KEEP, request)
    }

    private fun timestamp(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())
}

internal class EventWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = Settings(applicationContext)
        if (!settings.isRegistered) return Result.retry()
        val msgid = inputData.getString(KEY_MSGID) ?: return Result.failure()
        val type = inputData.getString(KEY_TYPE) ?: return Result.failure()
        val occurredAt = inputData.getString(KEY_OCCURRED_AT) ?: return Result.failure()
        return try {
            ApiClient(settings).reportEvent(msgid, type, occurredAt, inputData.getString(KEY_REASON))
            Result.success()
        } catch (error: ApiException) {
            if (error.isPermanent) Result.failure() else Result.retry()
        } catch (error: IOException) {
            Result.retry()
        }
    }

    /** Expedited work needs this before Android 12, where it runs as a foreground service. */
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(FOREGROUND_ID, reportingNotification())

    private fun reportingNotification(): Notification =
        NotificationCompat.Builder(applicationContext, Channels.REPORTING)
            .setSmallIcon(R.drawable.apppush_ic_notification)
            .setContentTitle(applicationContext.getString(R.string.apppush_reporting_title))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    companion object {
        const val KEY_MSGID = "msgid"
        const val KEY_TYPE = "type"
        const val KEY_OCCURRED_AT = "occurredAt"
        const val KEY_REASON = "reason"
        private const val FOREGROUND_ID = 2
    }
}
