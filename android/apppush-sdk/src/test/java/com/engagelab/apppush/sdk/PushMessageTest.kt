package com.engagelab.apppush.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushMessageTest {
    @Test
    fun `reads the data payload the backend sends`() {
        val message = PushMessage.from(
            mapOf(
                "msgid" to "1760000000000123456",
                "type" to "NOTIFICATION",
                "title" to "Sale",
                "body" to "Today only",
                "style" to "INBOX",
                "styleConfig" to """{"lines":["one","two"]}""",
            ),
        )
        assertNotNull(message)
        assertEquals("1760000000000123456", message!!.msgid)
        assertTrue(message.isNotification)
        assertEquals("INBOX", message.style)
        assertEquals(2, message.styleConfig!!.getJSONArray("lines").length())
    }

    @Test
    fun `ignores messages that did not come from AppPush`() {
        assertNull(PushMessage.from(mapOf("title" to "Someone else's message")))
        assertNull(PushMessage.from(mapOf("msgid" to " ")))
    }

    @Test
    fun `survives a malformed style configuration`() {
        val message = PushMessage.from(mapOf("msgid" to "1", "styleConfig" to "{broken"))
        assertNull(message!!.styleConfig)
    }

}

class RecentMessagesTest {
    private fun message(msgid: String, extra: Map<String, String> = mapOf("title" to "T", "body" to "B")) =
        PushMessage.from(mapOf("msgid" to msgid) + extra)!!

    @Test
    fun `lists the newest message first`() {
        val recent = RecentMessages()
        recent.add(message("old"), 1)
        recent.add(message("new"), 2)
        assertEquals(listOf("new", "old"), recent.all.map { it.msgid })
    }

    @Test
    fun `shows a custom message as its payload`() {
        val recent = RecentMessages()
        recent.add(message("1", mapOf("type" to "CUSTOM", "payload" to """{"a":1}""")), 1)
        assertNull(recent.all[0].title)
        assertEquals("""{"a":1}""", recent.all[0].body)
    }

    @Test
    fun `survives being stored and restored`() {
        val recent = RecentMessages()
        recent.add(message("1"), 5)
        recent.add(message("2", mapOf("type" to "CUSTOM", "payload" to "{}")), 6)
        val restored = RecentMessages.parse(recent.serialize())
        assertEquals(recent.all, restored.all)
    }

    @Test
    fun `keeps only the newest messages`() {
        val recent = RecentMessages()
        repeat(RecentMessages.MAX_SIZE + 3) { recent.add(message("id-$it"), it.toLong()) }
        assertEquals(RecentMessages.MAX_SIZE, recent.all.size)
        assertEquals("id-${RecentMessages.MAX_SIZE + 2}", recent.all.first().msgid)
    }

    @Test
    fun `treats unreadable storage as empty`() {
        assertTrue(RecentMessages.parse("{broken").all.isEmpty())
        assertTrue(RecentMessages.parse(null).all.isEmpty())
    }
}

class SeenMessagesTest {
    @Test
    fun `reports each ID as new only once`() {
        val seen = SeenMessages()
        assertTrue(seen.add("a"))
        assertFalse(seen.add("a"))
        assertTrue(seen.add("b"))
    }

    @Test
    fun `survives being stored and restored`() {
        val seen = SeenMessages()
        seen.add("a")
        seen.add("b")
        val restored = SeenMessages.parse(seen.serialize())
        assertFalse(restored.add("a"))
        assertFalse(restored.add("b"))
        assertTrue(restored.add("c"))
    }

    @Test
    fun `starts empty from nothing`() {
        assertTrue(SeenMessages.parse(null).add("a"))
        assertTrue(SeenMessages.parse("").add("a"))
    }

    @Test
    fun `forgets the oldest IDs so storage stays bounded`() {
        val seen = SeenMessages()
        repeat(SeenMessages.MAX_SIZE + 1) { seen.add("id-$it") }
        assertTrue(seen.add("id-0"))
        assertFalse(seen.add("id-${SeenMessages.MAX_SIZE}"))
    }
}
