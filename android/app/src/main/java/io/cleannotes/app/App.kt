package io.cleannotes.app

import android.app.Application
import androidx.room.Room
import androidx.room.withTransaction
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
    val db by lazy { Room.databaseBuilder(this, AppDb::class.java, "clean-notes").addMigrations(MIGRATION_1_2, MIGRATION_2_3).build() }
    val sync by lazy { Sync(this, db) }
    /** Outlives screens, so a save started as a note closes still finishes. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inbox = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        scope.launch { for (job in inbox) runCatching { job() } }
    }

    override fun onCreate() {
        super.onCreate()
        // Also schedules it for installs paired before background sync existed.
        if (sync.paired.value) SyncWorker.schedule(this)
    }

    /** Runs writes from the editor one at a time, in the order they arrived. */
    fun enqueue(job: suspend () -> Unit) = inbox.trySend(job)

    /** An image or PDF added in the editor: bytes to filesDir/blobs, record to the database. */
    suspend fun saveAttachment(table: String, meta: JSONObject, base64: String) {
        val id = meta.getString("id")
        require(Regex("[\\w-]{1,100}").matches(id)) { "Bad attachment id" }
        val dir = File(filesDir, "blobs")
        File(dir, "$id.tmp").apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)); renameTo(File(dir, id)) }
        stamped { now -> db.dao().put(AttachmentRow(id, table, meta.getLong("createdAt"), meta.toString(), now)) }
    }

    /**
     * Runs a write with the time taken inside its transaction. Sync reads its start time inside one too,
     * so every row stamped before that time is already stored when sync looks for it.
     */
    private suspend fun <T> stamped(block: suspend (Long) -> T) = db.withTransaction { block(System.currentTimeMillis()) }

    suspend fun saveNote(note: JSONObject) {
        stamped { now -> db.dao().put(noteRow(note).copy(savedAt = now)) }
        sync.schedule()
    }

    /** Same shape as baseNote() in src/lib/actions.ts. */
    suspend fun newNote(notebookId: String? = null, tag: String? = null): String {
        val now = System.currentTimeMillis()
        val id = UUID.randomUUID().toString()
        saveNote(
            JSONObject()
                .put("id", id)
                .put("title", "")
                .put("content", JSONObject().put("type", "doc").put("content", JSONArray().put(JSONObject().put("type", "paragraph"))))
                .put("text", "")
                .put("notebookId", notebookId ?: JSONObject.NULL)
                .put("tags", JSONArray(listOfNotNull(tag)))
                .put("kind", "note")
                .put("pinned", false)
                .put("createdAt", now)
                .put("updatedAt", now)
                .put("trashedAt", JSONObject.NULL)
        )
        return id
    }

    /**
     * Changes one note's JSON and stores it as this device's edit. A content change gets a new writer stamp,
     * so an open editor adopts it, as the web editor does for its Tasks view.
     */
    suspend fun updateNote(id: String, contentChanged: Boolean = false, change: (JSONObject, Long) -> Unit) {
        stamped { now ->
            val row = db.dao().noteOnce(id) ?: return@stamped
            val note = JSONObject(row.raw)
            change(note, now)
            note.put("updatedAt", now)
            if (contentChanged) note.put("writer", "tasks:${UUID.randomUUID()}")
            db.dao().put(noteRow(note).copy(savedAt = now))
        }
        sync.schedule()
    }

    suspend fun editTags(id: String, change: (List<String>) -> List<String>) =
        updateNote(id) { n, _ -> n.put("tags", JSONArray(change(noteRow(n).tagList))) }

    /** Port of retag() in src/lib/actions.ts: renames or (with an empty `to`) removes a tag and its subtree on every note. */
    suspend fun retag(from: String, to: String) {
        stamped { now ->
            for (row in db.dao().allNotes()) {
                val tags = renameTagIn(row.tagList, from, to)
                if (tags == row.tagList) continue
                val note = JSONObject(row.raw).put("tags", JSONArray(tags)).put("updatedAt", now)
                db.dao().put(noteRow(note).copy(savedAt = now))
            }
        }
        sync.schedule()
    }

    suspend fun trashNote(id: String) = updateNote(id) { n, now -> n.put("trashedAt", now) }

    /** Same as restoreNote() in src/lib/actions.ts, including merging a daily note into a newer one for its date. */
    suspend fun restoreNote(id: String) {
        stamped { now ->
            val dao = db.dao()
            val row = dao.noteOnce(id) ?: return@stamped
            val note = JSONObject(row.raw)
            val twin = row.date?.takeIf { row.kind == "daily" }?.let { dao.liveDaily(it, id) }
            if (twin == null) {
                dao.put(noteRow(note.put("trashedAt", JSONObject.NULL).put("updatedAt", now)).copy(savedAt = now))
                return@stamped
            }
            val merged = JSONObject(twin.raw)
            val blocks = merged.getJSONObject("content").optJSONArray("content") ?: JSONArray()
            note.getJSONObject("content").optJSONArray("content")?.let { a -> for (i in 0 until a.length()) blocks.put(a.get(i)) }
            merged.getJSONObject("content").put("content", blocks)
            merged.put("text", listOf(twin.text, row.text).filter { it.isNotBlank() }.joinToString("\n"))
                .put("writer", "restore:${UUID.randomUUID()}")
                .put("updatedAt", now)
            dao.put(noteRow(merged).copy(savedAt = now))
            dao.deleteNoteNow(id)
            dao.put(TombstoneRow(id, "notes", now))
        }
        sync.schedule()
    }

    suspend fun moveNote(id: String, notebookId: String?) = updateNote(id) { n, _ -> n.put("notebookId", notebookId ?: JSONObject.NULL) }

    // Notebooks are pushed by their edit time, which is stamped inside the write, like tombstones.
    suspend fun createNotebook(name: String): String {
        val id = UUID.randomUUID().toString()
        stamped { now ->
            val raw = JSONObject().put("id", id).put("name", name.trim()).put("createdAt", now).put("updatedAt", now)
            db.dao().put(NotebookRow(id, name.trim(), now, raw.toString()))
        }
        sync.schedule()
        return id
    }

    suspend fun renameNotebook(id: String, name: String) {
        stamped { now ->
            val row = db.dao().notebookOnce(id) ?: return@stamped
            db.dao().put(NotebookRow(id, name.trim(), now, JSONObject(row.raw).put("name", name.trim()).put("updatedAt", now).toString()))
        }
        sync.schedule()
    }

    /** Same as deleteNotebook() in src/lib/actions.ts: its notes stay, outside any notebook. */
    suspend fun deleteNotebook(id: String) {
        stamped { now ->
            val dao = db.dao()
            for (n in dao.notesIn(id)) {
                dao.put(noteRow(JSONObject(n.raw).put("notebookId", JSONObject.NULL).put("updatedAt", now)).copy(savedAt = now))
            }
            dao.deleteNotebookNow(id)
            dao.put(TombstoneRow(id, "notebooks", now))
        }
        sync.schedule()
    }

    /** The tombstone makes other devices delete the note too. */
    suspend fun deleteForever(ids: List<String>) {
        stamped { now ->
            ids.forEach {
                db.dao().deleteNoteNow(it)
                db.dao().put(TombstoneRow(it, "notes", now))
            }
        }
        sync.collectOrphans()
        sync.schedule()
    }
}
