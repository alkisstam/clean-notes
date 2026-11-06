package io.cleannotes.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncMergeTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDb::class.java).build()
    private val sync = Sync(context, db)

    private fun note(id: String, time: Long) = JSONObject().put("id", id).put("title", "t").put("updatedAt", time)
        .put("content", JSONObject().put("type", "doc")).put("tags", JSONArray())
    private fun deleted(id: String, at: Long) = JSONObject().put("id", id).put("table", "notes").put("deletedAt", at)

    @After fun close() = db.close()

    @Test fun deleteWinsOverOlderEditsAndLosesToNewerOnes() = runBlocking {
        sync.merge(listOf(note("n1", 10)), emptyList(), emptyList(), emptyList())
        assertEquals("rows from the server are not pushed back", 0L, db.dao().noteOnce("n1")!!.savedAt)

        assertEquals(1, sync.merge(emptyList(), emptyList(), listOf(deleted("n1", 20)), emptyList()).deleted)
        assertNull(db.dao().noteOnce("n1"))

        sync.merge(listOf(note("n1", 15)), emptyList(), emptyList(), emptyList())
        assertNull("an edit older than the delete stays deleted", db.dao().noteOnce("n1"))

        sync.merge(listOf(note("n1", 30)), emptyList(), emptyList(), emptyList())
        assertNotNull("an edit after the delete brings the note back", db.dao().noteOnce("n1"))
    }

    @Test fun importedRowsAreMarkedForPush() = runBlocking {
        sync.merge(listOf(note("n2", 10)), emptyList(), emptyList(), emptyList(), savedAt = 99)
        assertEquals(99L, db.dao().noteOnce("n2")!!.savedAt)
    }
}
