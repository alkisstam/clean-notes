package io.cleannotes.app

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteScreen(app: App, id: String, onClose: () -> Unit) {
    val note by app.db.dao().note(id).collectAsStateWithLifecycle(null)
    val view = remember(id) { NoteViewState() }
    var menu by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    val notebooks by app.db.dao().liveNotebooks().collectAsStateWithLifecycle(emptyList())
    val back = { if (view.pdfOpen) view.closePdf() else view.flush(onClose) }
    BackHandler { back() }
    // Pending keystrokes are saved and sent when the app goes to the background.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { view.flush { app.sync.runInBackground() } }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Move to notebook") }, onClick = { menu = false; moving = true })
                        DropdownMenuItem(text = { Text("Move to Trash") }, onClick = {
                            menu = false
                            view.flush { app.scope.launch { app.trashNote(id) }; onClose() }
                        })
                    }
                },
            )
        },
    ) { pad ->
        note?.let { NoteView(app, it, view, Modifier.padding(pad).consumeWindowInsets(pad).fillMaxSize().imePadding()) }
    }
    if (moving) {
        val pick = { target: String? -> moving = false; view.flush { app.scope.launch { app.moveNote(id, target) } } }
        AlertDialog(
            onDismissRequest = { moving = false },
            title = { Text("Move to notebook") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    (listOf<NotebookRow?>(null) + notebooks).forEach { nb ->
                        Row(Modifier.fillMaxWidth().clickable { pick(nb?.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = note?.notebookId == nb?.id, onClick = { pick(nb?.id) })
                            Text(nb?.name?.ifBlank { "Untitled" } ?: "No notebook")
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { moving = false }) { Text("Cancel") } },
        )
    }
}
