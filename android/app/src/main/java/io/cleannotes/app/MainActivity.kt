package io.cleannotes.app

import android.os.Bundle
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.Alignment
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.RadioButton
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.DrawerValue
import androidx.compose.material.icons.filled.Menu
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

private fun ago(time: Long): CharSequence =
    if (System.currentTimeMillis() - time < 60_000) "just now"
    else DateUtils.getRelativeTimeSpanString(time, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as App
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                NotesApp(app)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PairScreen(sync: Sync, onBack: () -> Unit) {
    val context = LocalContext.current
    var url by rememberSaveable { mutableStateOf("https://") }
    var token by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val pair = { block: () -> Unit ->
        error = try {
            block()
            null
        } catch (e: Exception) {
            e.message ?: "That pairing code could not be read."
        }
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Connect to server") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { pad ->
        Column(
            Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("On the web app, open Settings → Sync → Pair a phone and scan the code. Or enter the server address and sync token.")
            Button(onClick = {
                GmsBarcodeScanning.getClient(context).startScan()
                    .addOnSuccessListener { code -> pair { sync.pair(code.rawValue ?: "") } }
                    .addOnFailureListener { error = "The scanner is not available on this phone. Enter the details instead." }
            }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
            OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth(), label = { Text("Server address") }, singleLine = true)
            OutlinedTextField(
                token, { token = it }, Modifier.fillMaxWidth(),
                label = { Text("Sync token") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
            )
            OutlinedButton(onClick = { pair { sync.pair(url, token) } }, Modifier.fillMaxWidth()) { Text("Connect") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun NotesApp(app: App) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var connecting by rememberSaveable { mutableStateOf(false) }
    var trash by rememberSaveable { mutableStateOf(false) }
    var notebook by rememberSaveable { mutableStateOf<String?>(null) }
    val paired by app.sync.paired.collectAsState()
    val runSync = {
        if (!syncing && paired) scope.launch {
            syncing = true
            try {
                app.sync.run()
            } catch (e: Exception) {
                snackbar.showSnackbar(if (e is SyncError) e.message!! else "Sync failed. Check your connection.")
            } finally {
                syncing = false
            }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { runSync() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { app.sync.runInBackground() }

    LaunchedEffect(paired) {
        if (paired) {
            connecting = false
            runSync()
        }
    }

    val id = openId
    if (trash) {
        BackHandler { trash = false }
        TrashScreen(app, onBack = { trash = false })
    } else if (connecting) {
        BackHandler { connecting = false }
        PairScreen(app.sync, onBack = { connecting = false })
    } else if (id != null) {
        NoteScreen(app, id, onClose = { openId = null })
    } else {
        NoteList(
            app, syncing, snackbar, notebook,
            onNotebook = { notebook = it },
            onSync = { runSync() },
            onOpen = { openId = it },
            onNew = { nb -> scope.launch { openId = app.newNote(nb) } },
            onConnect = { connecting = true },
            onTrash = { trash = true },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoteList(
    app: App,
    syncing: Boolean,
    snackbar: SnackbarHostState,
    notebook: String?,
    onNotebook: (String?) -> Unit,
    onSync: () -> Unit,
    onOpen: (String) -> Unit,
    onNew: (String?) -> Unit,
    onConnect: () -> Unit,
    onTrash: () -> Unit,
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
    val current = notebooks.find { it.id == notebook }
    // An id with no notebook (deleted on another device) shows all notes, and new notes go outside any notebook.
    val notes = if (current == null) all else all.filter { it.notebookId == current.id }

    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    val pick = { id: String? -> onNotebook(id); scope.launch { drawer.close() } }
                    NavigationDrawerItem(label = { Text("All notes") }, selected = current == null, onClick = { pick(null) })
                    Text("Notebooks", Modifier.padding(16.dp, 16.dp, 16.dp, 8.dp), style = MaterialTheme.typography.labelMedium)
                    notebooks.forEach { nb ->
                        NavigationDrawerItem(
                            label = { Text(nb.name.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            badge = { Text(all.count { it.notebookId == nb.id }.toString()) },
                            selected = current?.id == nb.id,
                            onClick = { pick(nb.id) },
                        )
                    }
                    NavigationDrawerItem(label = { Text("New notebook") }, selected = false, onClick = { creating = true; scope.launch { drawer.close() } })
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    NavigationDrawerItem(label = { Text("Trash") }, selected = false, onClick = { onTrash(); scope.launch { drawer.close() } })
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
        if (name != null) scope.launch { onNotebook(app.createNotebook(name)) }
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
                TextButton(onClick = { deleting = null; onNotebook(null); app.scope.launch { app.deleteNotebook(nb.id) } }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun NameDialog(title: String, initial: String, confirm: String, onDone: (String?) -> Unit) {
    var name by remember { mutableStateOf(TextFieldValue(initial, TextRange(initial.length))) }
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }) },
        confirmButton = { TextButton(enabled = name.text.isNotBlank(), onClick = { onDone(name.text) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoteScreen(app: App, id: String, onClose: () -> Unit) {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrashScreen(app: App, onBack: () -> Unit) {
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
