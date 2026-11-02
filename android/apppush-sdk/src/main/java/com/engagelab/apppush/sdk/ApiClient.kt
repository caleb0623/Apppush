package com.engagelab.apppush.sdk

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, val code: String?, message: String) : IOException(message) {
    /** The request was understood and refused, so repeating it cannot succeed. */
    val isPermanent: Boolean get() = status in 400..499 && status != 429
    val deviceUnknown: Boolean get() = code == "INVALID_DEVICE_CREDENTIALS"
}

/** The backend's client API. Plain HttpURLConnection is enough for four small JSON calls. */
internal class ApiClient(private val settings: Settings) {

    suspend fun ping(): JSONObject = call("GET", "/ping", deviceAuth = settings.isRegistered)

    /** Creates the device, or updates it if this installation already registered. A known secret proves it. */
    suspend fun register(pushToken: String, notificationsEnabled: Boolean): JSONObject {
        val body = JSONObject()
            .put("installationId", settings.installationId)
            .put("pushToken", pushToken)
            .put("platform", "ANDROID")
            .put("vendor", Build.MANUFACTURER.take(32))
            .put("model", Build.MODEL.take(64))
            .put("osVersion", Build.VERSION.RELEASE.take(32))
            .put("appVersion", settings.appVersion)
            .put("notificationsEnabled", notificationsEnabled)
        return call("POST", "/devices", body)
    }

    suspend fun updateToken(pushToken: String): JSONObject =
        call("PUT", "/devices/me/token", JSONObject().put("pushToken", pushToken), deviceAuth = true)

    suspend fun reportEvent(msgid: String, type: String, occurredAt: String, reason: String?): JSONObject {
        val body = JSONObject().put("msgid", msgid).put("type", type).put("occurredAt", occurredAt)
        if (reason != null) body.put("reason", reason)
        return call("POST", "/events", body, deviceAuth = true)
    }

    private suspend fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        deviceAuth: Boolean = false,
    ): JSONObject = withContext(Dispatchers.IO) {
        val url = URL("${settings.backendUrl}/api/v1/client$path")
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("X-App-Key", settings.appKey)
            settings.deviceSecret?.let { connection.setRequestProperty("X-Device-Secret", it) }
            if (deviceAuth) {
                connection.setRequestProperty("X-Registration-Id", settings.registrationId.orEmpty())
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }

            val status = connection.responseCode
            val stream = if (status < 400) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (status >= 400) {
                val error = json?.optJSONObject("error")
                throw ApiException(
                    status,
                    error?.optString("code"),
                    error?.optString("message").takeUnless { it.isNullOrEmpty() } ?: "HTTP $status",
                )
            }
            json?.optJSONObject("data") ?: JSONObject()
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000
    }
}
