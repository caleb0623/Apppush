package com.engagelab.apppush.sdk

import org.json.JSONArray
import org.json.JSONObject

/** The FCM data payload. The backend's buildFcmMessage is the other side of this contract. */
data class PushMessage(
    val msgid: String,
    val type: String,
    val title: String?,
    val body: String?,
    val style: String,
    val styleConfig: JSONObject?,
    val payload: String?,
) {
    val isNotification: Boolean get() = type == TYPE_NOTIFICATION
    val isInApp: Boolean get() = type == TYPE_IN_APP

    companion object {
        const val TYPE_NOTIFICATION = "NOTIFICATION"
        const val TYPE_IN_APP = "IN_APP"

        /** Returns null for a message that did not come from AppPush. */
        fun from(data: Map<String, String>): PushMessage? {
            val msgid = data["msgid"]?.takeIf { it.isNotBlank() } ?: return null
            return PushMessage(
                msgid = msgid,
                type = data["type"] ?: TYPE_NOTIFICATION,
                title = data["title"],
                body = data["body"],
                style = data["style"] ?: "DEFAULT",
                styleConfig = data["styleConfig"]?.let { runCatching { JSONObject(it) }.getOrNull() },
                payload = data["payload"],
            )
        }
    }
}

/** A message kept on the device, for showing a list in the host app. */
data class RecentMessage(
    val msgid: String,
    val type: String,
    val title: String?,
    val body: String,
    val receivedAt: Long,
)

/** The newest messages, newest first, kept small enough to store as one JSON string. */
internal class RecentMessages(private val items: MutableList<RecentMessage> = mutableListOf()) {
    val all: List<RecentMessage> get() = items

    fun add(message: PushMessage, receivedAt: Long) {
        // A custom message has no text of its own, so its payload is what there is to show.
        val body = if (message.isNotification || message.isInApp) message.body else message.payload
        items.add(0, RecentMessage(message.msgid, message.type, message.title, body.orEmpty(), receivedAt))
        while (items.size > MAX_SIZE) items.removeLast()
    }

    fun serialize(): String {
        val rows = JSONArray()
        for (item in items) {
            rows.put(
                JSONObject()
                    .put("msgid", item.msgid)
                    .put("type", item.type)
                    .put("title", item.title ?: JSONObject.NULL)
                    .put("body", item.body)
                    .put("receivedAt", item.receivedAt),
            )
        }
        return rows.toString()
    }

    companion object {
        const val MAX_SIZE = 10

        /** Stored data is only a convenience, so anything unreadable just gives an empty list. */
        fun parse(text: String?): RecentMessages {
            val rows = text?.let { runCatching { JSONArray(it) }.getOrNull() } ?: return RecentMessages()
            val items = (0 until rows.length()).mapNotNull { index ->
                rows.optJSONObject(index)?.let { row ->
                    RecentMessage(
                        msgid = row.optString("msgid"),
                        type = row.optString("type"),
                        title = if (row.isNull("title")) null else row.optString("title"),
                        body = row.optString("body"),
                        receivedAt = row.optLong("receivedAt"),
                    )
                }
            }
            return RecentMessages(items.toMutableList())
        }
    }
}
