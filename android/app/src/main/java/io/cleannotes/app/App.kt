package io.cleannotes.app

import kotlinx.coroutines.flow.MutableStateFlow
import androidx.core.content.edit
import android.app.Application
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.room.Room
import androidx.room.withTransaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

class App : Application() {
    val db by lazy { Room.databaseBuilder(this, AppDb::class.java, "clean-notes").addMigrations(MIGRATION_1_2, MIGRATION_2_3).build() }
    val sync by lazy { Sync(this, db) }
    val backup by lazy { Backup(this, db, sync) }

    // Settings, kept on this device only, as the web keeps its theme.
    val ui by lazy { getSharedPreferences("ui", MODE_PRIVATE) }
    val theme by lazy { MutableStateFlow(ui.getString("theme", "system")!!) }
    val webFonts by lazy { MutableStateFlow(ui.getBoolean("webFonts", true)) }

    fun setTheme(value: String) {
        ui.edit { putString("theme", value) }
        theme.value = value
    }

    fun setWebFonts(value: Boolean) {
        ui.edit { putBoolean("webFonts", value) }
        webFonts.value = value
    }
    /** Outlives screens, so a save started as a note closes still finishes. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inbox = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (job in inbox) {
                try {
                    job()
                } catch (e: Exception) {
                    Log.e("CleanNotes", "Save failed", e)
                    Handler(Looper.getMainLooper()).post { Toast.makeText(this@App, "Could not save the note.", Toast.LENGTH_LONG).show() }
                }
            }
        }
    }

    @OptIn(FlowPreview::class)
    override fun onCreate() {
        super.onCreate()
        // Also schedules it for installs paired before background sync existed.
        if (sync.paired.value) SyncWorker.schedule(this)
        // Every change to the notes (edits, sync, ticks, trash) re-picks the next reminder.
        scope.launch { db.dao().liveNotes().debounce(1000).collect { Reminders.schedule(this@App, it) } }
    }

    /** Runs writes from the editor one at a time, in the order they arrived. */
    fun enqueue(job: suspend () -> Unit) = inbox.trySend(job)

    /** Where an attachment's bytes collect while the editor sends them, before [saveAttachment] moves them into place. */
    fun incomingFile(id: String): File {
        require(Regex("[\\w-]{1,100}").matches(id)) { "Bad attachment id" }
        return File(File(filesDir, "blobs"), "$id.tmp")
    }

    /** An image or PDF added in the editor: bytes to filesDir/blobs, record to the database. */
    suspend fun saveAttachment(table: String, meta: JSONObject) {
        val id = meta.getString("id")
        val tmp = incomingFile(id)
        if (!tmp.exists()) tmp.createNewFile()
        check(tmp.renameTo(File(tmp.parentFile, id))) { "Could not store attachment $id" }
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

    // Notes made by New note / New sub-note on this run, discarded on leaving if still empty.
    private val fresh: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

    suspend fun discardIfEmpty(id: String) {
        if (!fresh.remove(id)) return
        val n = db.dao().noteOnce(id) ?: return
        val attached = "\"noteImage\"" in n.raw || "\"pdfAttachment\"" in n.raw
        if (n.title.isBlank() && n.text.isBlank() && !attached && db.dao().childCount(id) == 0) deleteForever(listOf(id))
    }

    /** Same shape as baseNote() in src/lib/actions.ts. */
    suspend fun newNote(notebookId: String? = null, tag: String? = null, parentId: String? = null, title: String = "", body: String = ""): String {
        val now = System.currentTimeMillis()
        val id = UUID.randomUUID().toString()
        val content = textDoc(body)
        saveNote(
            JSONObject()
                .put("id", id)
                .put("title", title)
                .put("content", content)
                .put("text", docText(content))
                .put("notebookId", notebookId ?: JSONObject.NULL)
                .put("tags", JSONArray(listOfNotNull(tag)))
                .put("kind", "note")
                .put("pinned", false)
                .put("createdAt", now)
                .put("updatedAt", now)
                .put("trashedAt", JSONObject.NULL)
                .apply { if (parentId != null) put("parentId", parentId) }
        )
        fresh.add(id)
        return id
    }

    /** Files shared into the app, added by the next note to open. */
    @Volatile var sharedFiles: List<android.net.Uri> = emptyList()

    suspend fun duplicateNote(id: String) {
        val src = JSONObject((db.dao().noteOnce(id) ?: return).raw)
        saveNote(duplicated(src, UUID.randomUUID().toString(), System.currentTimeMillis()) { UUID.randomUUID().toString() })
    }

    /** Port of getOrCreateDaily(): one daily note per date. */
    suspend fun dailyNote(date: String): String {
        val id = stamped { now ->
            db.dao().liveDaily(date, "")?.id ?: UUID.randomUUID().toString().also { id ->
                val note = JSONObject()
                    .put("id", id)
                    .put("title", longDate(date))
                    .put("content", JSONObject().put("type", "doc").put("content", JSONArray().put(JSONObject().put("type", "paragraph"))))
                    .put("text", "")
                    .put("notebookId", JSONObject.NULL)
                    .put("tags", JSONArray())
                    .put("kind", "daily")
                    .put("date", date)
                    .put("pinned", false)
                    .put("createdAt", now)
                    .put("updatedAt", now)
                    .put("trashedAt", JSONObject.NULL)
                db.dao().put(noteRow(note).copy(savedAt = now))
            }
        }
        sync.schedule()
        return id
    }

    /** Port of setTaskAttrs(): ticks a task or sets its due date, where it lives in its note. */
    suspend fun setTaskAttrs(noteId: String, taskId: String, attrs: Map<String, Any?>) =
        updateNote(noteId, contentChanged = true) { n, _ -> n.put("content", patchTask(n.getJSONObject("content"), taskId, attrs)) }

    /** Port of quickAddTask(): new tasks go to the end of today's note. */
    suspend fun quickAddTask(text: String, due: String?, remind: String? = null) {
        val id = dailyNote(dateKey())
        updateNote(id, contentChanged = true) { n, _ ->
            val content = appendTask(n.getJSONObject("content"), UUID.randomUUID().toString(), text, due, remind)
            n.put("content", content).put("text", docText(content))
        }
    }

    /** Port of createSubNote(): the new note goes in its parent's notebook. */
    suspend fun newSubNote(parentId: String, tag: String?): String? {
        val parent = db.dao().noteOnce(parentId) ?: return null
        return newNote(parent.notebookId, tag, parentId)
    }

    /**
     * Port of nestNote(): puts a note and its sub-notes under another note, in that note's notebook.
     * Returns false when the target is inside the note itself.
     */
    suspend fun nestNote(id: String, parentId: String): Boolean {
        val ok = stamped { now ->
            val all = db.dao().allNotes()
            val byId = all.associateBy { it.id }
            val parent = byId[parentId] ?: return@stamped true
            val note = byId[id] ?: return@stamped true
            if (id == parentId || note.parentId == parentId) return@stamped true
            var n: NoteRow? = parent
            var hops = 0
            while (n != null && hops <= all.size) {
                if (n.id == id) return@stamped false
                n = n.parentId?.let(byId::get)
                hops++
            }
            val subtree = mutableListOf(id)
            var i = 0
            while (i < subtree.size) {
                for (c in all) if (c.parentId == subtree[i] && c.id !in subtree) subtree += c.id
                i++
            }
            for (sid in subtree) {
                val row = byId.getValue(sid)
                val j = JSONObject(row.raw)
                if (sid == id) j.put("parentId", parentId)
                else if (row.notebookId == parent.notebookId) continue
                j.put("notebookId", parent.notebookId ?: JSONObject.NULL).put("updatedAt", now)
                db.dao().put(noteRow(j).copy(savedAt = now))
            }
            true
        }
        sync.schedule()
        return ok
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
