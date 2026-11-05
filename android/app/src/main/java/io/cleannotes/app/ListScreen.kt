package io.cleannotes.app

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteList(
    app: App,
    syncing: Boolean,
    snackbar: SnackbarHostState,
    view: String,
    onView: (String) -> Unit,
    onSync: () -> Unit,
    onOpen: (String) -> Unit,
    onNew: (String?) -> Unit,
    onConnect: () -> Unit,
) {
    val all by app.db.dao().liveNotes().collectAsStateWithLifecycle(emptyList())
    val notebooks by app.db.dao().liveNotebooks().collectAsStateWithLifecycle(emptyList())
    val syncedAt by app.sync.syncedAt.collectAsState()
    val paired by app.sync.paired.collectAsState()
    val scope = rememberCoroutineScope()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    var menu by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<NotebookRow?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<NotebookRow?>(null) }
    val current = notebooks.find { "nb:${it.id}" == view }
    // A notebook deleted on another device shows all notes, and new notes go outside any notebook.
    val notes = listFor(if (view.startsWith("nb:") && current == null) "all" else view, all)

    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    val pick = { key: String -> onView(key); scope.launch { drawer.close() } }
                    NavigationDrawerItem(label = { Text("All notes") }, selected = view == "all", onClick = { pick("all") })
                    Text("Notebooks", Modifier.padding(16.dp, 16.dp, 16.dp, 8.dp), style = MaterialTheme.typography.labelMedium)
                    notebooks.forEach { nb ->
                        NavigationDrawerItem(
                            label = { Text(nb.name.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            badge = { Text(listFor("nb:${nb.id}", all).size.toString()) },
                            selected = current?.id == nb.id,
                            onClick = { pick("nb:${nb.id}") },
                        )
                    }
                    NavigationDrawerItem(label = { Text("New notebook") }, selected = false, onClick = { creating = true; scope.launch { drawer.close() } })
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    NavigationDrawerItem(label = { Text("Trash") }, selected = false, onClick = { pick("trash") })
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(current?.name?.ifBlank { "Untitled" } ?: "Notes", maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                when {
                                    !paired -> "On this device only"
                                    syncedAt == 0L -> "Not synced yet"
                                    else -> "Synced ${ago(syncedAt)}"
                                },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    },
                    navigationIcon = { IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Default.Menu, "Notebooks") } },
                    actions = {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                        DropdownMenu(menu, { menu = false }) {
                            if (current != null) {
                                DropdownMenuItem(text = { Text("Rename notebook") }, onClick = { menu = false; naming = current })
                                DropdownMenuItem(text = { Text("Delete notebook") }, onClick = { menu = false; deleting = current })
                            }
                            if (paired) DropdownMenuItem(text = { Text("Disconnect from server") }, onClick = { menu = false; app.sync.unpair() })
                            else DropdownMenuItem(text = { Text("Connect to server") }, onClick = { menu = false; onConnect() })
                        }
                    },
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                FloatingActionButton(onClick = { onNew(current?.id) }) { Icon(Icons.Default.Add, "New note") }
            },
        ) { pad ->
            PullToRefreshBox(syncing, onSync, Modifier.padding(pad).fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(notes, key = { it.id }) { note ->
                        Column(Modifier.fillMaxWidth().clickable { onOpen(note.id) }.padding(16.dp, 12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (note.pinned) Text("Pinned", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                Text(note.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(
                                note.text.replace('\n', ' ').take(170).ifBlank { "No content yet" },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    if (creating) NameDialog("New notebook", "", "Create") { name ->
        creating = false
        if (name != null) scope.launch { onView("nb:" + app.createNotebook(name)) }
    }
    naming?.let { nb ->
        NameDialog("Rename notebook", nb.name, "Rename") { name ->
            naming = null
            if (name != null) app.scope.launch { app.renameNotebook(nb.id, name) }
        }
    }
    deleting?.let { nb ->
        val count = all.count { it.notebookId == nb.id }
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete \"${nb.name.ifBlank { "Untitled" }}\"?") },
            text = { Text(if (count == 0) "The notebook is empty." else "Its $count ${if (count == 1) "note stays" else "notes stay"}, outside any notebook.") },
            confirmButton = {
                TextButton(onClick = { deleting = null; onView("all"); app.scope.launch { app.deleteNotebook(nb.id) } }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun NameDialog(title: String, initial: String, confirm: String, onDone: (String?) -> Unit) {
    var name by remember { mutableStateOf(TextFieldValue(initial, TextRange(initial.length))) }
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }) },
        confirmButton = { TextButton(enabled = name.text.isNotBlank(), onClick = { onDone(name.text) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancel") } },
    )
}

/** Which notes a view lists, by the same rules as ListColumn.tsx: archived notes and daily notes stay out of All. */
fun listFor(view: String, notes: List<NoteRow>): List<NoteRow> {
    val shelved = notes.filter { it.archivedAt == null }
    return when {
        view.startsWith("nb:") -> shelved.filter { it.notebookId == view.removePrefix("nb:") }
        else -> shelved.filter { it.kind == "note" }
    }
}
