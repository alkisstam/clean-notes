package io.cleannotes.app

import android.content.Context
import androidx.core.content.edit
import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class SyncError(message: String) : Exception(message)

/** Same LWW rule as the web merge: newer edit wins, and a delete at or after the edit wins over it. */
fun accepts(incoming: Long, current: Long?, diedAt: Long?) =
    (diedAt ?: -1) < incoming && (current == null || incoming > current)

private fun JSONObject.str(key: String) = if (isNull(key)) null else optString(key)
private fun JSONObject.long(key: String) = if (isNull(key)) null else optLong(key)

fun noteRow(n: JSONObject) = NoteRow(
    id = n.getString("id"),
    title = n.optString("title"),
    text = n.optString("text"),
    notebookId = n.str("notebookId"),
    kind = n.optString("kind", "note"),
    date = n.str("date"),
    pinned = n.optBoolean("pinned"),
    updatedAt = n.getLong("updatedAt"),
    trashedAt = n.long("trashedAt"),
    archivedAt = n.long("archivedAt"),
    raw = n.toString(),
    tags = n.optJSONArray("tags")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty().joinToString("\n"),
    parentId = n.str("parentId"),
)

/** Client for server/sync.mjs. Mirrors serverSync() in src/lib/sync.ts. */
class Sync(private val context: Context, private val db: AppDb) {
    private val prefs = context.getSharedPreferences("sync", Context.MODE_PRIVATE)
    private val blobDir = File(context.filesDir, "blobs").apply { mkdirs() }
    private val dao = db.dao()
    private val lock = Mutex()

    val paired = MutableStateFlow(prefs.getString("token", null) != null)
    val syncedAt = MutableStateFlow(prefs.getLong("syncedAt", 0))

    /** Accepts the JSON from the web app's pairing QR code. */
    fun pair(qr: String) {
        val o = JSONObject(qr)
        pair(o.getString("url"), o.getString("token"))
    }

    fun pair(url: String, token: String) {
        val base = url.trim().trimEnd('/') + "/"
        require(base.startsWith("https://")) { "The server address must start with https://" }
        require(token.isNotBlank()) { "The token is empty" }
        prefs.edit { putString("url", base); putString("token", token.trim()); putLong("seq", 0); putLong("lastPushAt", 0) }
        paired.value = true
        SyncWorker.schedule(context)
    }

    fun unpair() {
        SyncWorker.cancel(context)
        prefs.edit { clear() }
        paired.value = false
        syncedAt.value = 0
    }

    /** Hands the sync to WorkManager, so it finishes after the app closes and waits for a network if there is none. */
    fun runInBackground() {
        if (paired.value) SyncWorker.now(context)
    }

    fun schedule() {
        if (paired.value) SyncWorker.soon(context)
    }

    suspend fun run() = lock.withLock {
        withContext(Dispatchers.IO) {
            val since = prefs.getLong("seq", 0)
            val pushFrom = prefs.getLong("lastPushAt", 0)
            // Read in one transaction with the start time, so no local write stamped before it can land after these reads.
            var startedAt = 0L
            var notes = emptyList<NoteRow>()
            var tombstones = emptyList<TombstoneRow>()
            var notebooks = emptyList<NotebookRow>()
            var files = emptyList<AttachmentRow>()
            db.withTransaction {
                startedAt = System.currentTimeMillis()
                notes = dao.notesSince(pushFrom)
                tombstones = dao.tombstonesSince(pushFrom)
                notebooks = dao.notebooksSince(pushFrom)
                // The server drops files no note uses, so each pushed note's own go along, in case they were dropped.
                files = dao.attachments().filter { a -> a.savedAt > pushFrom || notes.any { it.raw.contains(a.id) } }
            }
            // Bytes go first, so no device ever sees a file record whose bytes are missing.
            for (f in files) {
                if (request("HEAD", "api/blob/${f.id}") != null) continue
                request("PUT", "api/blob/${f.id}", File(blobDir, f.id).readBytes(), "application/octet-stream")
            }
            val out = notes.map {
                JSONObject().put("table", "notes").put("id", it.id).put("time", it.updatedAt).put("data", JSONObject(it.raw))
            } + files.map {
                JSONObject().put("table", it.tbl).put("id", it.id).put("time", it.time).put("data", JSONObject(it.raw))
            } + notebooks.map {
                JSONObject().put("table", "notebooks").put("id", it.id).put("time", it.time).put("data", JSONObject(it.raw))
            } + tombstones.map {
                JSONObject().put("table", "tombstones").put("id", it.id).put("time", it.deletedAt)
                    .put("data", JSONObject().put("id", it.id).put("table", it.tbl).put("deletedAt", it.deletedAt))
            }
            val body = JSONObject().put("since", since).put("records", JSONArray(out)).toString()
            val res = JSONObject(String(request("POST", "api/sync", body.toByteArray(), "application/json") ?: throw SyncError("The sync server was not found.")))
            val records = res.getJSONArray("records").let { a -> List(a.length()) { a.getJSONObject(it) } }

            // Bytes first, like the web client: a PDF or image record is only kept once its file is here.
            val have = dao.attachmentIds().toSet()
            val attachments = records.filter { (it.getString("table") == "files" || it.getString("table") == "images") && it.getString("id") !in have }
                .mapNotNull { r ->
                    val id = r.getString("id")
                    val bytes = request("GET", "api/blob/$id") ?: return@mapNotNull null
                    File(blobDir, "$id.tmp").apply { writeBytes(bytes); renameTo(File(blobDir, id)) }
                    AttachmentRow(id, r.getString("table"), r.getLong("time"), r.getJSONObject("data").toString())
                }

            db.withTransaction {
                attachments.forEach { dao.put(it) }
                val tombstones = records.filter { it.getString("table") == "tombstones" }.map { it.getJSONObject("data") }
                    .filter { t -> t.getLong("deletedAt") > (dao.diedAt(t.getString("id")) ?: -1) }
                tombstones.forEach { dao.put(TombstoneRow(it.getString("id"), it.getString("table"), it.getLong("deletedAt"))) }

                for (r in records.filter { it.getString("table") == "notebooks" }) {
                    val nb = r.getJSONObject("data")
                    val id = nb.getString("id")
                    val time = nb.long("updatedAt") ?: nb.getLong("createdAt")
                    if (accepts(time, dao.notebookTime(id), dao.diedAt(id))) dao.put(NotebookRow(id, nb.optString("name"), time, nb.toString()))
                }
                for (r in records.filter { it.getString("table") == "notes" }) {
                    val n = r.getJSONObject("data")
                    val id = n.getString("id")
                    val time = n.getLong("updatedAt")
                    if (accepts(time, dao.noteTime(id), dao.diedAt(id))) dao.put(noteRow(n))
                }
                for (t in tombstones) {
                    val id = t.getString("id")
                    val at = t.getLong("deletedAt")
                    if (t.getString("table") == "notes") dao.deleteNote(id, at) else dao.deleteNotebook(id, at)
                }
            }
            collectOrphans()
            val now = System.currentTimeMillis()
            prefs.edit { putLong("seq", res.getLong("seq")); putLong("lastPushAt", startedAt); putLong("syncedAt", now) }
            syncedAt.value = now
        }
    }

    /** Same as collectOrphanFiles() in src/lib/actions.ts: drops PDFs and images no note refers to, trashed ones included. */
    suspend fun collectOrphans() {
        // A file just added to a note is stored before the note is; give the note time to catch up.
        val before = System.currentTimeMillis() - 5 * 60_000
        val raws = dao.allRaw()
        val orphans = dao.attachments().filter { a -> a.time < before && raws.none { it.contains(a.id) } }.map { it.id }
        if (orphans.isEmpty()) return
        dao.deleteAttachments(orphans)
        orphans.forEach { File(blobDir, it).delete() }
    }

    /** Returns the body, or null on 404. */
    private fun request(method: String, path: String, body: ByteArray? = null, type: String? = null): ByteArray? {
        val base = prefs.getString("url", null) ?: throw SyncError("Not paired.")
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.setRequestProperty("Authorization", "Bearer ${prefs.getString("token", "")}")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", type)
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
            }
            return when (c.responseCode) {
                200 -> c.inputStream.use { it.readBytes() }
                404 -> null
                401 -> throw SyncError("The sync server did not accept the token.")
                else -> throw SyncError("The sync server answered ${c.responseCode}.")
            }
        } finally {
            c.disconnect()
        }
    }
}
