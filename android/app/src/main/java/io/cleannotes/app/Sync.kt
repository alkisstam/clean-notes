package io.cleannotes.app

import android.content.Context
import androidx.core.content.edit
import androidx.room.withTransaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
)

/** Client for server/sync.mjs. Mirrors serverSync() in src/lib/sync.ts. */
class Sync(context: Context, private val db: AppDb) {
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
    }

    fun unpair() {
        prefs.edit { clear() }
        paired.value = false
        syncedAt.value = 0
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var scheduled: Job? = null

    /** Errors are left for the next sync, which the list shows when it runs it. */
    fun runInBackground() = scope.launch { if (paired.value) runCatching { run() } }

    /** Counted from the first change, so steady typing cannot put the sync off forever. */
    fun schedule() {
        if (scheduled?.isActive == true) return
        scheduled = scope.launch {
            delay(60_000)
            runInBackground()
        }
    }

    suspend fun run() = lock.withLock {
        withContext(Dispatchers.IO) {
            val since = prefs.getLong("seq", 0)
            val pushFrom = prefs.getLong("lastPushAt", 0)
            val startedAt = System.currentTimeMillis()
            // shortcut: pushes notes only; notebooks, deletes and new PDFs/images come when the app can make them.
            val out = dao.notesSince(pushFrom).map {
                JSONObject().put("table", "notes").put("id", it.id).put("time", it.updatedAt).put("data", JSONObject(it.raw))
            }
            val body = JSONObject().put("since", since).put("records", JSONArray(out)).toString()
            val res = JSONObject(String(request("POST", "api/sync", body) ?: throw SyncError("The sync server was not found.")))
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
            // shortcut: bytes of PDFs/images no note uses any more stay on disk; add orphan cleanup with the editor.
            val now = System.currentTimeMillis()
            prefs.edit { putLong("seq", res.getLong("seq")); putLong("lastPushAt", startedAt); putLong("syncedAt", now) }
            syncedAt.value = now
        }
    }

    /** Returns the body, or null on 404. */
    private fun request(method: String, path: String, body: String? = null): ByteArray? {
        val base = prefs.getString("url", null) ?: throw SyncError("Not paired.")
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.setRequestProperty("Authorization", "Bearer ${prefs.getString("token", "")}")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
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
