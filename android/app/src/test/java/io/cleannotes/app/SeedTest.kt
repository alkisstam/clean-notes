package io.cleannotes.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SeedTest {
    @Test fun welcomeNoteMatchesTheWebSeedAndHasDatedTasks() {
        val n = welcomeNote("2026-03-10")
        val row = noteRow(n)
        assertEquals("welcome", row.id)
        assertEquals(SEED_TIME, row.updatedAt)
        assertEquals(SEED_NOTEBOOK, row.notebookId)
        assertEquals(0L, row.savedAt)
        assertTrue("Write" in row.text)
        assertEquals(listOf("2026-03-10", "2026-03-11", null), extractTasks(n.getString("id"), n.getString("title"), n.getJSONObject("content")).map { it.due })
    }
}
