package io.cleannotes.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ExportTest {
    private fun html(json: String, image: (String) -> String? = { null }) = noteHtml(JSONObject(json), image)

    @Test fun rendersBlocksAndMarks() {
        assertEquals("<p><strong><em>a&lt;b</em></strong></p>", html("""{"type":"paragraph","content":[{"type":"text","text":"a<b","marks":[{"type":"italic"},{"type":"bold"}]}]}"""))
        assertEquals("<h2>T</h2>", html("""{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"T"}]}"""))
        assertEquals("<div data-pdf-attachment>x&quot;.pdf</div>", html("""{"type":"pdfAttachment","attrs":{"name":"x\".pdf"}}"""))
    }

    @Test fun keepsOnlyOutsideLinks() {
        val link = { href: String -> html("""{"type":"text","text":"t","marks":[{"type":"link","attrs":{"href":"$href"}}]}""") }
        assertEquals("<a href=\"https://a.b\">t</a>", link("https://a.b"))
        assertEquals("t", link("#note/1"))
        assertEquals("t", link("javascript:alert(1)"))
    }

    @Test fun tasksShowTheirState() {
        val out = html("""{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph"}]}""")
        assertTrue(out.contains("<input type=\"checkbox\" checked>"))
    }

    @Test fun imagesUseTheFileOrDisappear() {
        val node = """{"type":"noteImage","attrs":{"imageId":"i","alt":"a"}}"""
        assertEquals("<img src=\"data:x\" alt=\"a\">", html(node) { "data:x" })
        assertEquals("", html(node))
    }

    @Test fun tableStyleLetsOnlyKnownValuesThrough() {
        val out = html("""{"type":"table","attrs":{"tableStyle":{"fill":"red;x:url(y)","ink":"#112233","borders":"lines","header":true,"size":"9em"}}}""")
        assertEquals("<table data-header data-borders=\"lines\" style=\"color:#112233\"><tbody></tbody></table>", out)
        val cell = html("""{"type":"tableCell","attrs":{"colspan":2,"rowspan":1,"cellStyle":{"fill":"#aabbcc","strike":true}}}""")
        assertEquals("<td colspan=\"2\" style=\"background:#aabbcc;text-decoration-line:line-through\"></td>", cell)
    }

    @Test fun combinesSeveralNotes() {
        assertEquals("A\n\none\n\n---\n\nUntitled\n\ntwo\n", exportText(listOf("A" to "one", "" to "two")))
        val page = exportPages(listOf("A" to "<p>1</p>", "B" to "<p>2</p>"))
        assertTrue(page.contains("<title>Clean Notes (2 notes)</title>"))
        assertTrue(page.contains("<h1>A</h1><p>1</p><h1 style=\"break-before:page\">B</h1><p>2</p>"))
    }

    @Test fun jsonIsAnObjectForOneAndAnArrayForSeveral() {
        val raw = """{"id":"a","writer":"w"}"""
        assertFalse(exportJson(listOf(raw)).contains("writer"))
        assertTrue(exportJson(listOf(raw)).trimStart().startsWith("{"))
        assertTrue(exportJson(listOf(raw, raw)).trimStart().startsWith("["))
    }

    @Test fun namesFilesSafely() {
        assertEquals("abc.pdf", exportName("a/b:c?", "pdf"))
        assertEquals("Untitled.txt", exportName(" / ", "txt"))
    }

    @Test fun textBecomesParagraphs() {
        val doc = textDoc("one\r\n\ntwo")
        assertEquals("one\ntwo", docText(doc))
        assertEquals(3, doc.getJSONArray("content").length())
    }
}
