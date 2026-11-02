package com.engagelab.apppush.demo

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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

    private fun placeholders(text: String) = Regex("""%\d+\$[sd]""").findAll(text).map { it.value }.toSet()

    @Test
    fun `every string exists in both languages`() {
        assertEquals(english.keys, chinese.keys)
    }

    @Test
    fun `a translation keeps its placeholders and is not empty`() {
        for ((name, text) in english) {
            val translated = chinese.getValue(name)
            assertFalse(name, translated.isBlank())
            assertEquals(name, placeholders(text), placeholders(translated))
        }
    }

    @Test
    fun `the language button offers the other language`() {
        assertEquals("中文", english["language_toggle"])
        assertEquals("English", chinese["language_toggle"])
        assertNotEquals(english["status_ready"], chinese["status_ready"])
    }
}
