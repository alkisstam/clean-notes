package io.cleannotes.app

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class App : Application() {
    val db by lazy { Room.databaseBuilder(this, AppDb::class.java, "clean-notes").build() }
    val sync by lazy { Sync(this, db) }
    /** Outlives screens, so a save started as a note closes still finishes. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun saveNote(note: JSONObject) {
        db.dao().put(noteRow(note))
        sync.schedule()
    }

    /** Same shape as baseNote() in src/lib/actions.ts. */
    suspend fun newNote(): String {
        val now = System.currentTimeMillis()
        val id = UUID.randomUUID().toString()
        saveNote(
            JSONObject()
                .put("id", id)
                .put("title", "")
                .put("content", JSONObject().put("type", "doc").put("content", JSONArray().put(JSONObject().put("type", "paragraph"))))
                .put("text", "")
                .put("notebookId", JSONObject.NULL)
                .put("tags", JSONArray())
                .put("kind", "note")
                .put("pinned", false)
                .put("createdAt", now)
                .put("updatedAt", now)
                .put("trashedAt", JSONObject.NULL)
        )
        return id
    }

    suspend fun trashNote(id: String) {
        val row = db.dao().noteOnce(id) ?: return
        val now = System.currentTimeMillis()
        saveNote(JSONObject(row.raw).put("trashedAt", now).put("updatedAt", now))
    }
}
