package io.cleannotes.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test fun pinnedSkipsArchived() {
        val notes = listOf(note("a", ""","pinned":true"""), note("b", ""","pinned":true,"archivedAt":5"""), note("c"))
        assertEquals(listOf("a"), listFor("pinned", notes).map { it.id })
    }

    @Test fun archiveListsOnlyArchivedOfAnyKind() {
        val notes = listOf(note("a", ""","archivedAt":5"""), note("b"), note("c", ""","kind":"daily","archivedAt":5"""))
        assertEquals(listOf("a", "c"), listFor("archive", notes).map { it.id })
    }

    @Test fun dailyListsFilledDaysAndTodayNewestFirst() {
        val notes = listOf(
            note("old", ""","kind":"daily","date":"2026-11-01","text":"x""""),
            note("empty", ""","kind":"daily","date":"2026-11-02","text":"""""),
            note("today", ""","kind":"daily","date":"2026-11-05","text":"""""),
            note("archived", ""","kind":"daily","date":"2026-11-03","text":"y","archivedAt":5"""),
            note("plain", ""","text":"z""""),
        )
        assertEquals(listOf("today", "archived", "old"), listFor("daily", notes, today = "2026-11-05").map { it.id })
    }

    @Test fun datesCrossMonthAndYear() {
        assertEquals("2026-12-01", addDays("2026-11-30", 1))
        assertEquals("2025-12-31", addDays("2026-01-01", -1))
    }

    // Same case as "builds whole-week month grids" in tests/lib.test.ts (there months count from 0).
    @Test fun buildsWholeWeekMonthGrids() {
        val g = monthGrid(2026, 11, 1) // November 2026 starts on a Sunday
        assertEquals("2026-10-26", g[0])
        assertEquals("2026-11-01", g[6])
        assertEquals(0, g.size % 7)
        assertTrue("2026-11-30" in g)
    }
}
