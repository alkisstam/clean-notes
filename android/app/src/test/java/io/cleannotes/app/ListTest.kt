package io.cleannotes.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ListTest {
    private fun note(id: String, extra: String = "") = noteRow(
        JSONObject("""{"id":"$id","title":"","updatedAt":1,"kind":"note","notebookId":null,"trashedAt":null}""").apply {
            val more = JSONObject("{" + extra.removePrefix(",") + "}")
            more.keys().forEach { put(it, more.get(it)) }
        },
    )

    @Test fun parsesTagsAndParent() {
        val n = note("a", ""","tags":["work","work/client-a"],"parentId":"p"""")
        assertEquals(listOf("work", "work/client-a"), n.tagList)
        assertEquals("p", n.parentId)
    }

    @Test fun missingTagsAndParent() {
        val n = note("a")
        assertEquals(emptyList<String>(), n.tagList)
        assertNull(n.parentId)
    }

    @Test fun allHidesArchivedAndDaily() {
        val notes = listOf(note("a"), note("b", ""","archivedAt":5"""), note("c", ""","kind":"daily","date":"2026-11-05""""))
        assertEquals(listOf("a"), listFor("all", notes).map { it.id })
    }

    @Test fun notebookKeepsDailyButNotArchived() {
        val notes = listOf(
            note("a", ""","notebookId":"n""""),
            note("b", ""","notebookId":"n","archivedAt":5"""),
            note("c", ""","notebookId":"n","kind":"daily""""),
            note("d"),
        )
        assertEquals(listOf("a", "c"), listFor("nb:n", notes).map { it.id })
    }
}
