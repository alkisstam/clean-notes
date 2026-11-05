package io.cleannotes.app

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import org.json.JSONArray
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.util.UUID

class App : Application() {
    val db by lazy { Room.databaseBuilder(this, AppDb::class.java, "clean-notes").addMigrations(MIGRATION_1_2).build() }
    val sync by lazy { Sync(this, db) }
    /** Outlives screens, so a save started as a note closes still finishes. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inbox = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        scope.launch { for (job in inbox) runCatching { job() } }
    }

    /** Runs writes from the editor one at a time, in the order they arrived. */
    fun enqueue(job: suspend () -> Unit) = inbox.trySend(job)

    /** An image or PDF added in the editor: bytes to filesDir/blobs, record to the database. */
    suspend fun saveAttachment(table: String, meta: JSONObject, base64: String) {
        val id = meta.getString("id")
        require(Regex("[\\w-]{1,100}").matches(id)) { "Bad attachment id" }
        val dir = File(filesDir, "blobs")
        File(dir, "$id.tmp").apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)); renameTo(File(dir, id)) }
        db.dao().put(AttachmentRow(id, table, meta.getLong("createdAt"), meta.toString(), System.currentTimeMillis()))
    }

    suspend fun saveNote(note: JSONObject) {
        db.dao().put(noteRow(note).copy(savedAt = System.currentTimeMillis()))
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
