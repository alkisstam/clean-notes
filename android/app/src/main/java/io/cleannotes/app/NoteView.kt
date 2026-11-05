package io.cleannotes.app

import android.annotation.SuppressLint
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.compose.foundation.isSystemInDarkTheme
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
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

private const val PAGE = "https://appassets.androidplatform.net/assets/editor/android.html"

/** Shows a note with the web app's own Tiptap editor, read-only. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun NoteView(app: App, note: NoteRow, modifier: Modifier = Modifier) {
    val dark = isSystemInDarkTheme()
    var payload by remember { mutableStateOf<String?>(null) }
    var ready by remember { mutableStateOf(false) }

    LaunchedEffect(note.raw, dark) {
        // Ids are UUIDs, so a substring match finds exactly the attachments this note uses.
        val used = app.db.dao().attachments().filter { note.raw.contains(it.id) }
        payload = JSONObject()
            .put("note", JSONObject(note.raw))
            .put("images", JSONArray(used.filter { it.tbl == "images" }.map { JSONObject(it.raw) }))
            .put("files", JSONArray(used.filter { it.tbl == "files" }.map { JSONObject(it.raw) }))
            .put("dark", dark)
            .toString()
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                .addPathHandler("/blobs/", WebViewAssetLoader.InternalStoragePathHandler(ctx, File(ctx.filesDir, "blobs")))
                .build()
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                setBackgroundColor(0)
                webViewClient = object : WebViewClientCompat() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                        loader.shouldInterceptRequest(request.url)

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
            }
        },
        update = { web -> if (ready) payload?.let { web.evaluateJavascript("cnLoad($it)", null) } },
    )
}
