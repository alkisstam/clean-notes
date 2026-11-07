package io.cleannotes.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.net.Uri
import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import android.provider.OpenableColumns
import androidx.compose.ui.platform.LocalContext

private const val ORIGIN = "https://appassets.androidplatform.net"
private const val PAGE = "$ORIGIN/assets/editor/android.html"

/** Moves the received bytes to a file other apps may read, replacing the last one, and returns its content URI. */
private fun shareable(context: Context, name: String, bytes: File): Uri {
    val dir = File(context.cacheDir, "open").apply { deleteRecursively(); mkdirs() }
    val file = File(dir, name.replace(Regex("[/\\\\]"), "_").ifBlank { "file" })
    // copyTo, not renameTo: cacheDir and filesDir may sit on different file systems.
    bytes.copyTo(file, overwrite = true)
    bytes.delete()
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

/** Lets the screen save the page's pending edits before it closes the note. */
class NoteViewState {
    internal var web: WebView? = null
    var pdfOpen by mutableStateOf(false)
        internal set
    var canUndo by mutableStateOf(false)
        internal set
    var canRedo by mutableStateOf(false)
        internal set
    var imageOpen by mutableStateOf(false)
        internal set
    /** The page asked for a note to link the selection to; the screen shows its picker while set. */
    var linking by mutableStateOf(false)
    /** The selection already links to a note, so the picker offers to remove it. */
    var linked by mutableStateOf(false)
        internal set
    /** The page's "Add tags" was tapped; the screen shows its tag picker while set. */
    var tagging by mutableStateOf(false)

    fun unlinkNote() {
        linking = false
        web?.evaluateJavascript("cnUnlinkNote()", null)
    }
    /** A to-do's date button was tapped: its current due date, or "" for none. The screen shows its date dialog while set. */
    var dating by mutableStateOf<String?>(null)

    fun setDue(due: String?) {
        dating = null
        web?.evaluateJavascript("cnSetDue(${due?.let(JSONObject::quote) ?: "null"})", null)
    }

    /** Called when a note link in the page is tapped. */
    var onOpenNote: ((String) -> Unit)? = null

    fun closeViewer() {
        web?.evaluateJavascript("cnCloseViewer()", null)
    }

    fun startLink() {
        web?.evaluateJavascript("cnStartLink()", null)
    }

    fun linkNote(id: String, title: String) {
        linking = false
        web?.evaluateJavascript("cnLinkNote(${JSONObject.quote(id)}, ${JSONObject.quote(title)})", null)
    }

    fun closePdf() {
        web?.evaluateJavascript("cnClosePdf()", null)
    }

    fun undo() {
        web?.evaluateJavascript("cnUndo()", null)
    }

    fun redo() {
        web?.evaluateJavascript("cnRedo()", null)
    }

    internal var launchPicker: ((Array<String>) -> Unit)? = null

    /** `kind` is "image" or "pdf"; the picked files go into the note at the cursor. */
    fun pick(kind: String) {
        launchPicker?.invoke(arrayOf(if (kind == "pdf") "application/pdf" else "image/*"))
    }
    private var after: (() -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())

    fun flush(then: () -> Unit) {
        val web = web ?: return then()
        after = then
        web.evaluateJavascript("cnFlush()", null)
        // A page that never answers must not trap the user in the note.
        main.postDelayed({ flushed() }, 1500)
    }

    internal fun flushed() {
        val then = after ?: return
        after = null
        then()
    }
}

private const val LINK_NOTE = 0x4c4e

/** Adds "Link to note" to the overflow of the system's text selection bar. */
private fun withLinkItem(callback: ActionMode.Callback, state: NoteViewState) = object : ActionMode.Callback2() {
    private fun add(menu: Menu) {
        if (menu.findItem(LINK_NOTE) == null) menu.add(Menu.NONE, LINK_NOTE, 1000, "Link to note")
    }
    override fun onCreateActionMode(mode: ActionMode, menu: Menu) = callback.onCreateActionMode(mode, menu).also { add(menu) }
    override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = callback.onPrepareActionMode(mode, menu).also { add(menu) }
    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId != LINK_NOTE) return callback.onActionItemClicked(mode, item)
        state.startLink()
        mode.finish()
        return true
    }
    override fun onDestroyActionMode(mode: ActionMode) = callback.onDestroyActionMode(mode)
    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
        if (callback is ActionMode.Callback2) callback.onGetContentRect(mode, view, outRect) else super.onGetContentRect(mode, view, outRect)
    }
}

/** Shows and edits a note with the web app's own Tiptap editor. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun NoteView(app: App, note: NoteRow, state: NoteViewState, pdf: String?, modifier: Modifier = Modifier) {
    val dark = LocalDark.current
    val deviceFonts = !LocalWebFonts.current
    var payload by remember { mutableStateOf<String?>(null) }
    var ready by remember { mutableStateOf(false) }
    // The editor's "/image" and "/pdf" commands open a file input; Android answers it with the document picker.
    var chooser by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val context = LocalContext.current
    // Files picked from the + menu, served once to the page at /picked/<key>.
    val picked = remember { mutableMapOf<String, Uri>() }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { all ->
        val size = { uri: Uri ->
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L } ?: 0L
        }
        // The editor holds the whole file to read a PDF's text, and the sync server refuses more.
        val uris = all.filter { size(it) <= MAX_UPLOAD }
        if (uris.size < all.size) Toast.makeText(context, "Files over 200 MB cannot be added.", Toast.LENGTH_LONG).show()
        val cb = chooser
        chooser = null
        if (cb != null) return@rememberLauncherForActivityResult cb.onReceiveValue(uris.toTypedArray())
        val list = JSONArray(uris.map { uri ->
            val key = UUID.randomUUID().toString()
            picked[key] = uri
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            JSONObject().put("url", "$ORIGIN/picked/$key").put("name", name ?: "file").put("type", context.contentResolver.getType(uri) ?: "")
        })
        if (uris.isNotEmpty()) state.web?.evaluateJavascript("cnInsertPicked($list)", null)
    }
    state.launchPicker = { pick.launch(it) }

    LaunchedEffect(note.raw, dark, deviceFonts) {
        // Ids are UUIDs, so a substring match finds exactly the attachments this note uses.
        val used = app.db.dao().attachments().filter { note.raw.contains(it.id) }
        payload = JSONObject()
            .put("note", JSONObject(note.raw))
            .put("images", JSONArray(used.filter { it.tbl == "images" }.map { JSONObject(it.raw) }))
            .put("files", JSONArray(used.filter { it.tbl == "files" }.map { JSONObject(it.raw) }))
            .put("dark", dark)
            .put("deviceFonts", deviceFonts)
            .put("pdf", pdf?.let(::JSONObject) ?: JSONObject.NULL)
            .toString()
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                .addPathHandler("/blobs/", WebViewAssetLoader.InternalStoragePathHandler(ctx, File(ctx.filesDir, "blobs")))
                .build()
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            object : WebView(ctx) {
                override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? =
                    super.startActionMode(withLinkItem(callback, state), type)
            }.apply {
                // AndroidView's default WRAP_CONTENT makes vh units 0, which collapses the slash menu and the page's bottom space.
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                setBackgroundColor(0)
                check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "This WebView is too old to edit notes." }
                check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) { "This WebView is too old to edit notes." }
                // Where the attachment being sent collects its bytes. Only queued jobs touch it, one at a time.
                var incoming: File? = null
                // Only our own page can reach this, unlike addJavascriptInterface.
                WebViewCompat.addWebMessageListener(this, "CleanNotes", setOf(ORIGIN)) { _, message, _, _, _ ->
                    if (message.type == WebMessageCompat.TYPE_ARRAY_BUFFER) {
                        val bytes = message.arrayBuffer
                        app.enqueue {
                            // Acked even on failure, or the page would wait forever and stop saving.
                            try {
                                checkNotNull(incoming).appendBytes(bytes)
                            } finally {
                                withContext(Dispatchers.Main) { evaluateJavascript("cnAck()", null) }
                            }
                        }
                        return@addWebMessageListener
                    }
                    val msg = JSONObject(message.data ?: return@addWebMessageListener)
                    when (msg.getString("type")) {
                        "bytes" -> app.enqueue { incoming = app.incomingFile(msg.getString("id")).apply { delete() } }
                        // One queue, so a note is never stored before the files it points at.
                        "attachment" -> app.enqueue { app.saveAttachment(msg.getString("table"), msg.getJSONObject("meta")) }
                        "save" -> app.enqueue { app.saveNote(msg.getJSONObject("note")) }
                        "pdf" -> state.pdfOpen = msg.getBoolean("open")
                        "viewer" -> state.imageOpen = msg.getBoolean("open")
                        "linkNote" -> {
                            state.linked = msg.optBoolean("linked")
                            state.linking = true
                        }
                        "tags" -> state.tagging = true
                        "due" -> state.dating = if (msg.isNull("due")) "" else msg.getString("due")
                        "openNote" -> state.onOpenNote?.invoke(msg.getString("id"))
                        "history" -> {
                            state.canUndo = msg.getBoolean("undo")
                            state.canRedo = msg.getBoolean("redo")
                        }
                        "hideKeyboard" -> ctx.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(windowToken, 0)
                        // Queued, so it runs after the bytes sent just before it are written.
                        "open" -> app.enqueue {
                            val uri = shareable(ctx, msg.getString("name"), app.incomingFile(msg.getString("id")))
                            val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, msg.optString("mime").ifBlank { "*/*" })
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            withContext(Dispatchers.Main) {
                                runCatching { ctx.startActivity(Intent.createChooser(view, "Open with")) }
                            }
                        }
                        // Queued too, so a note is only closed once its last save is stored.
                        "flushed" -> app.enqueue { Handler(Looper.getMainLooper()).post { state.flushed() } }
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                        chooser?.onReceiveValue(null)
                        chooser = callback
                        val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }
                            .map { if (it == ".pdf") "application/pdf" else it }.filter { '/' in it }.distinct()
                        pick.launch(types.ifEmpty { listOf("*/*") }.toTypedArray())
                        return true
                    }
                }
                webViewClient = object : WebViewClientCompat() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        val url = request.url
                        val key = url.path?.removePrefix("/picked/")?.takeIf { url.host == Uri.parse(ORIGIN).host && it != url.path }
                            ?: return loader.shouldInterceptRequest(url)
                        val uri = picked.remove(key) ?: return null
                        return WebResourceResponse(ctx.contentResolver.getType(uri), null, ctx.contentResolver.openInputStream(uri))
                    }

                    // Links leave the app instead of replacing the note page.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                        return true
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        ready = true
                    }
                }
                loadUrl(PAGE)
                state.web = this
            }
        },
        update = { web -> if (ready) payload?.let { web.evaluateJavascript("cnLoad($it)", null) } },
        // A WebView left alive keeps the page's database open, and once Android freezes it, every later page waits on it forever.
        onRelease = { web ->
            state.web = null
            web.destroy()
        },
    )
}
