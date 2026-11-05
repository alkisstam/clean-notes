package io.cleannotes.app

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrashScreen(app: App, onBack: () -> Unit) {
    val notes by app.db.dao().liveTrash().collectAsStateWithLifecycle(emptyList())
    var picked by remember { mutableStateOf<NoteRow?>(null) }
    var confirmEmpty by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Trash") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = { if (notes.isNotEmpty()) TextButton(onClick = { confirmEmpty = true }) { Text("Empty Trash") } },
            )
        },
    ) { pad ->
        if (notes.isEmpty()) {
            Text("Trash is empty", Modifier.padding(pad).padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            items(notes, key = { it.id }) { note ->
                Column(Modifier.fillMaxWidth().clickable { picked = note }.padding(16.dp, 12.dp)) {
                    Text(note.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "Trashed ${ago(note.trashedAt ?: 0)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                HorizontalDivider()
            }
        }
    }
    picked?.let { note ->
        AlertDialog(
            onDismissRequest = { picked = null },
            title = { Text(note.title.ifBlank { "Untitled" }) },
            text = { Text("Restore it to your notes, or delete it for good. Deleting cannot be undone, and removes it from your other devices too.") },
            confirmButton = { TextButton(onClick = { picked = null; app.scope.launch { app.restoreNote(note.id) } }) { Text("Restore") } },
            dismissButton = {
                TextButton(onClick = { picked = null; app.scope.launch { app.deleteForever(listOf(note.id)) } }) {
                    Text("Delete forever", color = MaterialTheme.colorScheme.error)
                }
            },
        )
    }
    if (confirmEmpty) {
        AlertDialog(
            onDismissRequest = { confirmEmpty = false },
            title = { Text("Empty Trash?") },
            text = { Text("${notes.size} ${if (notes.size == 1) "note" else "notes"} will be deleted for good, here and on your other devices.") },
            confirmButton = {
                TextButton(onClick = { confirmEmpty = false; val ids = notes.map { it.id }; app.scope.launch { app.deleteForever(ids) } }) {
                    Text("Empty Trash", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmEmpty = false }) { Text("Cancel") } },
        )
    }
}
