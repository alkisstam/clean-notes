package io.cleannotes.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject

/** A note or PDF that matches, as built by the search in ListColumn.tsx. */
class SearchHit(val note: NoteRow?, val file: JSONObject?, val owner: NoteRow?, val page: Int?, val snippet: Snippet?)

/** Same order as the web: title matches, then text and tag matches, newest first in each, then PDFs. */
fun searchHits(notes: List<NoteRow>, files: List<JSONObject>, query: String): List<SearchHit> {
    if (foldQuery(query).isEmpty()) return emptyList()
    val has = { t: String -> includesFolded(t, query) }
    val titled = mutableListOf<SearchHit>()
    val rest = mutableListOf<SearchHit>()
    for (n in notes) {
        when {
            has(n.title) -> titled += SearchHit(n, null, null, null, snippet(n.text, query))
            has(n.text) -> rest += SearchHit(n, null, null, null, snippet(n.text, query))
            n.tagList.any(has) -> rest += SearchHit(n, null, null, null, null)
        }
    }
    val pdfs = files.mapNotNull { f ->
        val id = f.optString("id")
        val owner = notes.firstOrNull { it.raw.contains(id) }
        if (has(f.optString("name"))) return@mapNotNull SearchHit(null, f, owner, null, null)
        val texts = f.optJSONArray("pageTexts") ?: return@mapNotNull null
        val page = (0 until texts.length()).firstOrNull { has(texts.optString(it)) } ?: return@mapNotNull null
        SearchHit(null, f, owner, page + 1, snippet(texts.optString(page), query))
    }
    val byDate = compareByDescending<SearchHit> { it.note?.updatedAt ?: 0 }
    return titled.sortedWith(byDate) + rest.sortedWith(byDate) + pdfs
}

@Composable
fun SearchBody(app: App, notes: List<NoteRow>, query: String, onOpen: (String) -> Unit, onOpenPdf: (note: String, target: String) -> Unit) {
    val pdfRows by app.db.dao().livePdfs().collectAsStateWithLifecycle(emptyList())
    val files = remember(pdfRows) { pdfRows.map { JSONObject(it.raw) } }
    val hits = remember(notes, files, query) { searchHits(notes, files, query) }
    if (hits.isEmpty()) {
        Text("Nothing matches \"${query.trim()}\"", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val mark = SpanStyle(fontWeight = FontWeight.Bold, background = MaterialTheme.colorScheme.primaryContainer)
    LazyColumn(Modifier.fillMaxSize()) {
        items(hits) { h ->
            val open = h.note?.let { n -> { onOpen(n.id) } } ?: h.owner?.let { o ->
                {
                    val target = JSONObject().put("fileId", h.file!!.optString("id")).put("query", query.trim())
                    h.page?.let { target.put("page", it) }
                    onOpenPdf(o.id, target.toString())
                }
            }
            Column(Modifier.fillMaxWidth().clickable(enabled = open != null) { open?.invoke() }.padding(16.dp, 12.dp)) {
                val name = h.note?.title?.ifBlank { "Untitled" } ?: h.file!!.optString("name")
                Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                h.snippet?.let { s ->
                    Text(
                        buildAnnotatedString {
                            append(s.before)
                            withStyle(mark) { append(s.match) }
                            append(s.after)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                val where = when {
                    h.note != null && h.snippet == null -> h.note.tagList.joinToString("  ") { "#$it" }
                    h.file != null -> listOfNotNull(
                        h.page?.let { "Page $it" },
                        h.owner?.title?.ifBlank { "Untitled" } ?: "Only in a note in the Trash",
                    ).joinToString(" · ")
                    else -> null
                }
                where?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            HorizontalDivider()
        }
    }
}
