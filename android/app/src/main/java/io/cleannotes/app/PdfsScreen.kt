package io.cleannotes.app

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject
import java.util.Locale

/** Port of formatBytes() in src/lib/pdf.ts. */
fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${Math.round(n / 1024.0)} KB"
    n < 1024L * 1024 * 1024 -> String.format(Locale.US, "%.1f MB", n / 1024.0 / 1024)
    else -> String.format(Locale.US, "%.2f GB", n / 1024.0 / 1024 / 1024)
}

/** Port of the web's PDFs view: every PDF, newest first, opening in the note it belongs to. */
@Composable
fun PdfsBody(app: App, notes: List<NoteRow>, onOpen: (note: String, target: String) -> Unit) {
    val files by app.db.dao().livePdfs().collectAsStateWithLifecycle(emptyList())
    if (files.isEmpty()) {
        Text("No PDFs yet. Type /pdf in a note to add one.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(files, key = { it.id }) { f ->
            val meta = remember(f.raw) { JSONObject(f.raw) }
            // The first note that holds it, as on the web; one only in the Trash has nowhere to open.
            val owner = remember(notes, f.id) { notes.firstOrNull { it.raw.contains(f.id) } }
            val thumb = remember(f.raw) {
                meta.optString("thumb").substringAfter("base64,", "").takeIf { it.isNotEmpty() }?.let {
                    runCatching { Base64.decode(it, Base64.DEFAULT).let { b -> BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap() } }.getOrNull()
                }
            }
            val pages = meta.optInt("pageCount")
            Row(
                Modifier.fillMaxWidth().clickable(enabled = owner != null) { owner?.let { onOpen(it.id, JSONObject().put("fileId", f.id).toString()) } }.padding(16.dp, 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(44.dp, 56.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                    if (thumb != null) Image(thumb, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    else Text("PDF", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(Modifier.weight(1f)) {
                    Text(meta.optString("name"), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        (if (meta.optBoolean("encrypted")) "Password protected" else "$pages ${if (pages == 1) "page" else "pages"}") + " · " + formatBytes(meta.optLong("size")),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        owner?.title?.ifBlank { "Untitled" } ?: "Only in a note in the Trash",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            HorizontalDivider()
        }
    }
}
