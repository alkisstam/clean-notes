package io.cleannotes.app

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Base64OutputStream
import android.util.JsonReader
import android.util.JsonToken
import android.util.MalformedJsonException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.util.UUID

/** Reads and writes the web app's backup file (buildBackup and importBackup in src/lib/backup.ts), so either side can restore the other's. */
class Backup(private val context: Context, private val db: AppDb, private val sync: Sync) {
    private val blobDir = File(context.filesDir, "blobs")

    /** Streams straight to the file, so large PDFs are never held in memory. */
    suspend fun export(uri: Uri) = withContext(Dispatchers.IO) {
        val dao = db.dao()
        val attachments = dao.attachments().filter { File(blobDir, it.id).exists() }
        val (files, images) = attachments.partition { it.tbl == "files" }
        val out = context.contentResolver.openOutputStream(uri, "wt") ?: error("The file could not be written.")
        out.buffered().use { o ->
            fun w(s: String) = o.write(s.toByteArray())
            fun list(items: List<String>) = items.joinToString(",", "[", "]")
            fun bytes(id: String) {
                // NO_CLOSE leaves the file's stream open; closing the encoder writes its last bytes.
                Base64OutputStream(object : OutputStream() {
                    override fun write(b: Int) = o.write(b)
                    override fun write(b: ByteArray, off: Int, len: Int) = o.write(b, off, len)
                }, Base64.NO_WRAP or Base64.NO_CLOSE).use { enc -> File(blobDir, id).inputStream().use { it.copyTo(enc) } }
            }
            w("""{"format":"clean-notes-backup","version":3,"exportedAt":${System.currentTimeMillis()}""")
            w(",\"notes\":" + list(dao.allNotes().map { it.raw }))
            w(",\"notebooks\":" + list(dao.allNotebooks().map { it.raw }))
            w(",\"tombstones\":" + list(dao.allTombstones().map { JSONObject().put("id", it.id).put("table", it.tbl).put("deletedAt", it.deletedAt).toString() }))
            w(",\"files\":" + list(files.map { it.raw }))
            w(",\"blobs\":[")
            files.forEachIndexed { i, f ->
                w((if (i > 0) "," else "") + "{\"id\":" + JSONObject.quote(f.id) + ",\"data\":\"")
                bytes(f.id)
                w("\"}")
            }
            w("],\"images\":[")
            images.forEachIndexed { i, img ->
                // The stored record already carries the image's type, as the web's backup expects.
                w((if (i > 0) "," else "") + img.raw.trimEnd().dropLast(1) + ",\"data\":\"")
                bytes(img.id)
                w("\"}")
            }
            w("]}")
        }
    }

    /** Merges a backup into this device: per row the newer edit wins, as when syncing. */
    suspend fun import(uri: Uri): Sync.MergeResult = withContext(Dispatchers.IO) {
        val notes = mutableListOf<JSONObject>()
        val notebooks = mutableListOf<JSONObject>()
        val tombstones = mutableListOf<JSONObject>()
        val files = mutableListOf<JSONObject>()
        val images = mutableListOf<AttachmentRow>()
        val written = mutableListOf<String>()
        var format: String? = null
        try {
            val input = context.contentResolver.openInputStream(uri) ?: error("The file could not be read.")
            JsonReader(input.buffered().reader()).use { r ->
                if (r.peek() != JsonToken.BEGIN_OBJECT) throw IllegalArgumentException(NOT_BACKUP)
                r.beginObject()
                while (r.hasNext()) when (r.nextName()) {
                    "format" -> format = r.nextString()
                    "notes" -> eachIn(r) { notes += read(r) as? JSONObject ?: throw IllegalArgumentException(NOT_BACKUP) }
                    "notebooks" -> eachIn(r) { notebooks += read(r) as JSONObject }
                    "tombstones" -> eachIn(r) { tombstones += read(r) as JSONObject }
                    "files" -> eachIn(r) { files += read(r) as JSONObject }
                    "blobs" -> eachIn(r) { readEntry(r) { meta, tmp -> written += store(meta.getString("id"), tmp) } }
                    "images" -> eachIn(r) {
                        readEntry(r) { meta, tmp ->
                            val id = store(meta.getString("id"), tmp)
                            written += id
                            images += AttachmentRow(id, "images", meta.optLong("createdAt"), meta.toString())
                        }
                    }
                    else -> r.skipValue()
                }
                r.endObject()
            }
            // Same check as the web: the right format, and notes that look like notes.
            val valid = { n: JSONObject ->
                n.opt("id") is String && n.optJSONObject("content")?.optString("type") == "doc" &&
                    n.opt("tags") is JSONArray && n.opt("updatedAt") is Number
            }
            if (format != "clean-notes-backup" || !notes.all(valid)) throw IllegalArgumentException(NOT_BACKUP)
            // A PDF record is only kept with its bytes, as when syncing.
            val pdfs = files.filter { File(blobDir, it.getString("id")).exists() }
                .map { AttachmentRow(it.getString("id"), "files", it.optLong("createdAt"), it.toString()) }
            val result = sync.merge(notes, notebooks, tombstones, pdfs + images, savedAt = System.currentTimeMillis())
            sync.pushAgainFrom(result.oldest)
            if (result.deleted > 0) sync.collectOrphans()
            sync.schedule()
            result
        } catch (e: Exception) {
            // Bytes written for a backup that turned out unusable have no record; drop them.
            val kept = db.dao().attachmentIds().toSet()
            written.filter { it !in kept }.forEach { File(blobDir, it).delete() }
            // Same messages as the web: broken JSON, or JSON of the wrong shape.
            throw when (e) {
                is MalformedJsonException, is java.io.EOFException -> IllegalArgumentException("That file is not valid JSON.")
                is IllegalStateException, is ClassCastException -> IllegalArgumentException(NOT_BACKUP)
                else -> e
            }
        }
    }

    /** Moves a decoded file into place and returns its id. */
    private fun store(id: String, tmp: File): String {
        require(Regex("[\\w-]{1,100}").matches(id)) { NOT_BACKUP }
        tmp.renameTo(File(blobDir, id))
        return id
    }

    private fun eachIn(r: JsonReader, each: () -> Unit) {
        r.beginArray()
        while (r.hasNext()) each()
        r.endArray()
    }

    /** One {…, "data": base64} entry: the data goes to a temporary file, the rest is returned as JSON. */
    private fun readEntry(r: JsonReader, done: (JSONObject, File) -> Unit) {
        val meta = JSONObject()
        val tmp = File(blobDir, "import-${UUID.randomUUID()}.tmp")
        r.beginObject()
        while (r.hasNext()) {
            val name = r.nextName()
            // shortcut: the whole base64 string is read at once; a file of several hundred MB could run out of memory.
            if (name == "data") tmp.writeBytes(Base64.decode(r.nextString(), Base64.DEFAULT)) else meta.put(name, read(r))
        }
        r.endObject()
        if (tmp.exists()) done(meta, tmp)
    }

    private fun read(r: JsonReader): Any = when (r.peek()) {
        JsonToken.BEGIN_OBJECT -> JSONObject().also { o ->
            r.beginObject()
            while (r.hasNext()) o.put(r.nextName(), read(r))
            r.endObject()
        }
        JsonToken.BEGIN_ARRAY -> JSONArray().also { a ->
            r.beginArray()
            while (r.hasNext()) a.put(read(r))
            r.endArray()
        }
        JsonToken.NUMBER -> r.nextString().let { it.toLongOrNull() ?: it.toDouble() }
        JsonToken.BOOLEAN -> r.nextBoolean()
        JsonToken.NULL -> JSONObject.NULL.also { r.nextNull() }
        else -> r.nextString()
    }

    companion object {
        const val NOT_BACKUP = "That file is not a Clean Notes backup."
    }
}
