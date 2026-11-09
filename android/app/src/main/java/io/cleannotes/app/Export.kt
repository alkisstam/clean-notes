package io.cleannotes.app

import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.print.PdfFile
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.coroutines.resume

// From STYLE in src/lib/export.ts.
private const val STYLE = """
body { max-width: 680px; margin: 40px auto; padding: 0 20px; color: #211e1a; background: #fff; font: 16px/1.6 Georgia, serif; overflow-wrap: anywhere; }
h1, h2, h3 { line-height: 1.25; }
img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
pre { padding: 12px; background: #f3f1ec; overflow-x: auto; white-space: pre-wrap; }
code { font-family: ui-monospace, monospace; font-size: 0.9em; }
blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #ccc; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #ccc; padding: 5px 8px; text-align: inherit; font-weight: inherit; vertical-align: top; background: var(--table-bg); text-decoration-line: var(--table-deco, none); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
table[data-header] tr:first-child > *, table[data-first-col] tr > :first-child { background: color-mix(in srgb, var(--table-bg, transparent) 88%, #211e1a) !important; }
table[data-borders='rounded'] { border-collapse: separate; border-spacing: 0; border: 1px solid #ccc; border-radius: 10px; overflow: hidden; }
table[data-borders='rounded'] :is(td, th) { border-width: 0 1px 1px 0; }
table[data-borders='rounded'] tr > :last-child { border-right-width: 0; }
table[data-borders='rounded'] tr:last-child > * { border-bottom-width: 0; }
table[data-borders='lines'] :is(td, th) { border-width: 1px 0; }
table[data-borders='outer'] :is(td, th) { border-width: 0; }
table[data-borders='outer'] tr:first-child > * { border-top-width: 1px; }
table[data-borders='outer'] tr:last-child > * { border-bottom-width: 1px; }
table[data-borders='none'] :is(td, th) { border-width: 0; }
ul[data-type='taskList'] { list-style: none; padding: 0; }
ul[data-type='taskList'] li { display: flex; gap: 8px; }
ul[data-type='taskList'] p { margin: 0; }
[data-pdf-attachment] { margin: 12px 0; font-style: italic; }
"""

private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

fun exportName(title: String, ext: String) =
    "${title.replace(Regex("[/\\\\:*?\"<>|\\x00-\\x1f]"), "").trim().ifEmpty { "Untitled" }}.$ext"

private fun batchName(count: Int) = "Clean Notes ($count notes)"

fun exportPages(notes: List<Pair<String, String>>): String {
    val page = esc(if (notes.size == 1) notes[0].first.ifBlank { "Untitled" } else batchName(notes.size))
    val sections = notes.withIndex().joinToString("") { (i, n) ->
        "<h1${if (i > 0) " style=\"break-before:page\"" else ""}>${esc(n.first.ifBlank { "Untitled" })}</h1>${n.second}"
    }
    return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>$page</title><style>$STYLE</style></head><body>$sections</body></html>"
}

fun exportText(notes: List<Pair<String, String>>) =
    notes.joinToString("\n---\n\n") { (title, text) -> "${title.ifBlank { "Untitled" }}\n\n$text\n" }

fun exportJson(raw: List<String>): String {
    val notes = raw.map { JSONObject(it).apply { remove("writer") } }
    return if (notes.size == 1) notes[0].toString(2) else JSONArray(notes).toString(2)
}

/** Plain text as a document, one paragraph per line. */
fun textDoc(text: String): JSONObject {
    val lines = text.lines().ifEmpty { listOf("") }
    return JSONObject().put("type", "doc").put("content", JSONArray(lines.map { line ->
        JSONObject().put("type", "paragraph").apply {
            if (line.isNotEmpty()) put("content", JSONArray().put(JSONObject().put("type", "text").put("text", line)))
        }
    }))
}

private fun JSONObject.str(key: String) = if (isNull(key)) null else optString(key)

private val FILLS = listOf("amber", "orange", "rose", "violet", "blue", "green")
private val SIZES = listOf("12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px")
private val HEX = Regex("#[0-9a-fA-F]{6}")
private val MARK_SIZE = Regex("\\d+(\\.\\d+)?(px|em|rem|%)")

private fun hex(c: Color) = "#%06x".format(c.toArgb() and 0xFFFFFF)

private fun fillCss(fill: String?): String? = when {
    fill == null -> null
    HEX.matches(fill) -> fill
    fill.removePrefix("soft-") in FILLS && fill.startsWith("soft-") -> noteColor(fill, false)?.let(::hex)
    else -> null
}

private fun inkCss(ink: String?): String? = when {
    ink == null -> null
    HEX.matches(ink) -> ink
    ink in FILLS -> "hsl(${NoteHues.first { it.id == ink }.h.toInt()} 70% 32%)"
    else -> null
}

/** Same result as styleAttrs() in src/editor/TableStyle.tsx. These values come from synced notes, so only known ones get through. */
private fun styleAttrs(look: JSONObject?, table: Boolean): String {
    if (look == null) return ""
    val css = mutableListOf<String>()
    var attrs = ""
    look.str("size")?.takeIf { it in SIZES }?.let { css += "font-size:$it" }
    if (look.has("bold")) css += "font-weight:${if (look.optBoolean("bold")) 700 else 400}"
    if (look.has("italic")) css += "font-style:${if (look.optBoolean("italic")) "italic" else "normal"}"
    inkCss(look.str("ink"))?.let { css += "color:$it" }
    look.str("align")?.takeIf { it in listOf("left", "center", "right") }?.let { css += "text-align:$it" }
    val deco = listOfNotNull("underline".takeIf { look.optBoolean("underline") }, "line-through".takeIf { look.optBoolean("strike") }).joinToString(" ").ifEmpty { "none" }
    val fill = fillCss(look.str("fill"))
    if (table) {
        fill?.let { css += "--table-bg:$it" }
        if (deco != "none") css += "--table-deco:$deco"
        if (look.optBoolean("header")) attrs += " data-header"
        if (look.optBoolean("firstCol")) attrs += " data-first-col"
        look.str("borders")?.takeIf { it in listOf("rounded", "grid", "lines", "outer", "none") }?.let { attrs += " data-borders=\"$it\"" }
    } else {
        fill?.let { css += "background:$it" }
        if (look.has("underline") || look.has("strike")) css += "text-decoration-line:$deco"
    }
    return attrs + if (css.isEmpty()) "" else " style=\"${esc(css.joinToString(";"))}\""
}

private fun marked(text: String, marks: JSONArray?): String {
    var out = esc(text)
    for (i in 0 until (marks?.length() ?: 0)) {
        val mark = marks!!.getJSONObject(i)
        val attrs = mark.optJSONObject("attrs") ?: JSONObject()
        out = when (mark.optString("type")) {
            "bold" -> "<strong>$out</strong>"
            "italic" -> "<em>$out</em>"
            "strike" -> "<s>$out</s>"
            "underline" -> "<u>$out</u>"
            "code" -> "<code>$out</code>"
            "highlight" -> "<mark>$out</mark>"
            // Links to other notes mean nothing outside the app.
            "link" -> attrs.str("href")?.takeIf { Regex("^(https?:|mailto:)", RegexOption.IGNORE_CASE).containsMatchIn(it) }?.let { "<a href=\"${esc(it)}\">$out</a>" } ?: out
            "textStyle" -> attrs.str("fontSize")?.takeIf(MARK_SIZE::matches)?.let { "<span style=\"font-size:$it\">$out</span>" } ?: out
            else -> out
        }
    }
    return out
}

/**
 * The same HTML the web's generateHTML() gives for a note, for notes with no editor open.
 * `image` returns a noteImage's data: URL, or null if the file is gone.
 * shortcut: table column widths are left out and columns share the width, add a colgroup if exports need them.
 */
fun noteHtml(node: JSONObject, image: (String) -> String?): String {
    val attrs = node.optJSONObject("attrs") ?: JSONObject()
    val kids = { node.optJSONArray("content")?.let { a -> (0 until a.length()).joinToString("") { noteHtml(a.getJSONObject(it), image) } }.orEmpty() }
    val span = { listOf("colspan", "rowspan").joinToString("") { k -> attrs.optInt(k, 1).takeIf { it > 1 }?.let { " $k=\"$it\"" }.orEmpty() } }
    return when (node.optString("type")) {
        "text" -> marked(node.optString("text"), node.optJSONArray("marks"))
        "paragraph" -> "<p>${kids()}</p>"
        "heading" -> attrs.optInt("level", 1).coerceIn(1, 3).let { "<h$it>${kids()}</h$it>" }
        "bulletList" -> "<ul>${kids()}</ul>"
        "orderedList" -> attrs.optInt("start", 1).let { "<ol${if (it != 1) " start=\"$it\"" else ""}>${kids()}</ol>" }
        "listItem" -> "<li>${kids()}</li>"
        "taskList" -> "<ul data-type=\"taskList\">${kids()}</ul>"
        "taskItem" -> "<li data-type=\"taskItem\"><label><input type=\"checkbox\"${if (attrs.optBoolean("checked")) " checked" else ""}><span></span></label><div>${kids()}</div></li>"
        "blockquote" -> "<blockquote>${kids()}</blockquote>"
        "codeBlock" -> "<pre><code>${kids()}</code></pre>"
        "horizontalRule" -> "<hr>"
        "hardBreak" -> "<br>"
        "table" -> "<table${styleAttrs(attrs.optJSONObject("tableStyle"), true)}><tbody>${kids()}</tbody></table>"
        "tableRow" -> "<tr>${kids()}</tr>"
        "tableCell" -> "<td${span()}${styleAttrs(attrs.optJSONObject("cellStyle"), false)}>${kids()}</td>"
        "tableHeader" -> "<th${span()}${styleAttrs(attrs.optJSONObject("cellStyle"), false)}>${kids()}</th>"
        "noteImage" -> attrs.str("imageId")?.let(image)?.let { "<img src=\"$it\" alt=\"${esc(attrs.str("alt").orEmpty())}\">" }.orEmpty()
        "pdfAttachment" -> "<div data-pdf-attachment>${esc(attrs.str("name") ?: "document.pdf")}</div>"
        else -> kids()
    }
}

class Exported(val file: File, val name: String, val mime: String)

private val MIME = mapOf("pdf" to "application/pdf", "txt" to "text/plain", "json" to "application/json", "html" to "text/html")

private suspend fun rows(app: App, ids: List<String>) = ids.mapNotNull { app.db.dao().noteOnce(it) }

private suspend fun pageFor(app: App, notes: List<NoteRow>): String {
    val images = app.db.dao().attachments().filter { it.tbl == "images" }.associateBy { it.id }
    val dataUrl = { id: String ->
        images[id]?.let { row ->
            File(File(app.filesDir, "blobs"), id).takeIf { it.exists() }?.let { f ->
                "data:${JSONObject(row.raw).optString("type", "image/png")};base64,${Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)}"
            }
        }
    }
    return exportPages(notes.map { it.title to noteHtml(JSONObject(it.raw).getJSONObject("content"), dataUrl) })
}

private fun fileName(notes: List<NoteRow>, ext: String) = exportName(if (notes.size == 1) notes[0].title else batchName(notes.size), ext)

/** Renders the page offscreen, with nothing but the page itself reachable, and calls `ready` once it has loaded. */
private fun offscreen(context: Context, html: String, ready: (WebView) -> Unit) = WebView(context).apply {
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) = ready(view)
    }
    loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
}

/** Opens the system print dialog for the page. `hold` keeps the offscreen page alive behind that dialog. */
fun printHtml(context: Context, html: String, name: String, hold: (WebView) -> Unit) = hold(
    offscreen(context, html) { view ->
        context.getSystemService(PrintManager::class.java).print(name, view.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
    },
)

private suspend fun writePdf(context: Context, html: String, name: String, file: File): Boolean = withContext(Dispatchers.Main) {
    val attributes = PrintAttributes.Builder()
        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
        .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
        .setMinMargins(PrintAttributes.Margins(500, 500, 500, 500))
        .build()
    suspendCancellableCoroutine { done ->
        // Referenced until the write ends, or it could be collected partway through.
        var page: WebView? = null
        page = offscreen(context, html) { view ->
            PdfFile.write(view.createPrintDocumentAdapter(name), file, attributes) { ok ->
                page?.destroy()
                page = null
                done.resume(ok)
            }
        }
    }
}

/** One file holding all the notes, in the order given. */
suspend fun buildExport(app: App, context: Context, ids: List<String>, format: String): Exported {
    val notes = rows(app, ids)
    check(notes.isNotEmpty())
    val name = fileName(notes, format)
    val file = File(app.cacheDir, "export-${UUID.randomUUID()}")
    when (format) {
        "txt" -> file.writeText(exportText(notes.map { it.title to it.text }))
        "json" -> file.writeText(exportJson(notes.map { it.raw }))
        "html" -> file.writeText(pageFor(app, notes))
        else -> check(writePdf(context, pageFor(app, notes), name, file)) { "PDF failed" }
    }
    return Exported(file, name, MIME.getValue(format))
}

/** Moves the received bytes to a file other apps may read, replacing the last one, and returns its content URI. */
fun shareable(context: Context, name: String, bytes: File): Uri {
    val dir = File(context.cacheDir, "open").apply { deleteRecursively(); mkdirs() }
    val file = File(dir, name.replace(Regex("[/\\\\]"), "_").ifBlank { "file" })
    // copyTo, not renameTo: cacheDir and filesDir may sit on different file systems.
    bytes.copyTo(file, overwrite = true)
    bytes.delete()
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

fun shareNotes(app: App, context: Context, ids: List<String>, format: String) = app.scope.launch {
    val shared = runCatching {
        val out = buildExport(app, context, ids, format)
        val uri = shareable(context, out.name, out.file)
        val send = Intent(Intent.ACTION_SEND).setType(out.mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(out.name, uri)
        withContext(Dispatchers.Main) {
            context.startActivity(
                Intent.createChooser(send, null)
                    .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, arrayOf(ComponentName(context, MainActivity::class.java))),
            )
        }
    }.isSuccess
    if (!shared) withContext(Dispatchers.Main) { Toast.makeText(context, "That could not be shared.", Toast.LENGTH_SHORT).show() }
}

/** Saves notes through the system's file dialog, or prints them for PDF, as the note page's Export does. */
@Composable
fun rememberNoteExporter(app: App): (List<String>, String) -> Unit {
    val context = LocalContext.current
    val pending = remember { mutableStateOf<Exported?>(null) }
    val printing = remember { mutableStateOf<WebView?>(null) }
    val saver = rememberLauncherForActivityResult(object : ActivityResultContracts.CreateDocument("*/*") {
        override fun createIntent(context: Context, input: String) = super.createIntent(context, input).setType(pending.value?.mime ?: "*/*")
    }) { uri ->
        val out = pending.value ?: return@rememberLauncherForActivityResult
        pending.value = null
        if (uri == null) return@rememberLauncherForActivityResult run { out.file.delete() }
        app.scope.launch {
            val saved = runCatching {
                context.contentResolver.openOutputStream(uri)!!.use { o -> out.file.inputStream().use { it.copyTo(o) } }
            }.isSuccess
            out.file.delete()
            withContext(Dispatchers.Main) {
                Toast.makeText(context, if (saved) "Notes exported" else "Those notes could not be exported.", Toast.LENGTH_SHORT).show()
            }
        }
    }
    return { ids, format ->
        app.scope.launch {
            runCatching {
                if (format == "pdf") {
                    val notes = rows(app, ids)
                    val html = pageFor(app, notes)
                    withContext(Dispatchers.Main) { printHtml(context, html, fileName(notes, "pdf")) { printing.value = it } }
                } else {
                    val out = buildExport(app, context, ids, format)
                    withContext(Dispatchers.Main) {
                        pending.value = out
                        saver.launch(out.name)
                    }
                }
            }.onFailure {
                withContext(Dispatchers.Main) { Toast.makeText(context, "Those notes could not be exported.", Toast.LENGTH_SHORT).show() }
            }
        }
    }
}
