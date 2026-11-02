package com.engagelab.apppush.sdk

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

class StringsTest {
    private val english = read("values")
    private val chinese = read("values-zh")

    private fun read(folder: String): Map<String, String> {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/$folder/strings.xml"))
        val strings = document.getElementsByTagName("string")
        return (0 until strings.length)
            .map { strings.item(it) as Element }
            .filter { it.getAttribute("translatable") != "false" }
            .associate { it.getAttribute("name") to it.textContent }
    }

    @Test
    fun `every string exists in both languages`() {
        assertEquals(english.keys, chinese.keys)
    }

    @Test
    fun `every string carries the prefix that protects the host app`() {
        assertTrue(english.keys.all { it.startsWith("apppush_") })
    }
}
