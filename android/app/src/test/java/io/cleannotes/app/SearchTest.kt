package io.cleannotes.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Same cases as the "search" block in tests/lib.test.ts.
class SearchTest {
    private fun hits(text: String, q: String) = findRanges(text, q).map { text.substring(it.first, it.last + 1) }

    @Test fun ignoresCaseAndAccentsIncludingGreek() {
        assertTrue(includesFolded("Καλημέρα κόσμε", "καλημερα"))
        assertTrue(includesFolded("Café", "CAFE"))
        assertFalse(includesFolded("Café", "tea"))
    }

    @Test fun treatsFinalSigmaLikeSigmaInBothSearchPaths() {
        assertTrue(includesFolded("ΚΑΛΗΜΕΡΑ ΚΟΣΜΟΣ", "κόσμος"))
        assertTrue(includesFolded("ο κόσμος", "ΚΟΣΜΟΣ"))
        assertEquals(listOf("ΚΟΣΜΟΣ"), hits("ΚΑΛΗΜΕΡΑ ΚΟΣΜΟΣ", "κόσμος"))
    }

    @Test fun mapsRangesBackToTheOriginalText() {
        assertEquals(listOf("Café", "café"), hits("Το Café και το café", "cafe"))
        assertEquals(listOf("ok"), hits("Café ok", "ok"))
    }

    @Test fun buildsASnippet() {
        assertEquals(Snippet("one ", "two", " three"), snippet("one two three", "TWO"))
        assertNull(snippet("one", "x"))
        assertEquals(emptyList<IntRange>(), findRanges("abc", "   "))
    }
}

class SearchHitsTest {
    private fun note(id: String, title: String, text: String, updated: Long, tags: String = "[]") = noteRow(
        org.json.JSONObject("""{"id":"$id","title":"$title","text":"$text","updatedAt":$updated,"tags":$tags,"content":{"type":"doc","content":[]}}"""),
    )

    @Test fun titlesFirstThenTextAndTagsNewestFirstThenPdfs() {
        val notes = listOf(
            note("old-text", "A", "about zebra", 1),
            note("title", "Zebra facts", "", 2),
            note("new-text", "B", "zebra again", 3),
            note("tagged", "C", "", 4, """["animals/zebra"]"""),
            note("owner", "Holds file", "f1", 0),
        )
        val pdf = org.json.JSONObject("""{"id":"f1","name":"scan.pdf","pageTexts":["nothing","A zebra here"]}""")
        val hits = searchHits(notes, listOf(pdf), "ZEBRA")
        assertEquals(listOf("title", "tagged", "new-text", "old-text"), hits.mapNotNull { it.note?.id })
        val p = hits.last()
        assertEquals(2, p.page)
        assertEquals("owner", p.owner?.id)
        assertEquals("zebra", p.snippet?.match)
    }
}
