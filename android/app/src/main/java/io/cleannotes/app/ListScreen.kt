package io.cleannotes.app

import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.LaunchedEffect
import org.json.JSONObject
import android.content.Context
import androidx.core.content.edit
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.runtime.saveable.rememberSaveable
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
    onOpenPdf: (note: String, target: String) -> Unit,
    onNew: (notebook: String?, tag: String?) -> Unit,
    onToday: () -> Unit,
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
    var renamingTag by remember { mutableStateOf(false) }
    var deletingTag by remember { mutableStateOf(false) }
    // Collapsed tag paths, newline-joined so the state survives rotation.
    var collapsed by rememberSaveable { mutableStateOf("") }
    val ui = remember { app.getSharedPreferences("ui", Context.MODE_PRIVATE) }
    var tagsOpen by remember { mutableStateOf(ui.getBoolean("tagsOpen", true)) }
    var shutNotes by remember { mutableStateOf(ui.getStringSet("collapsedNotes", emptySet())!!.toSet()) }
    val tag = view.removePrefix("tag:").takeIf { view.startsWith("tag:") }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val closeSearch = { searching = false; query = "" }
    // Parsed once per change to the notes; the drawer shows the open count, the Tasks view the groups.
    val tasks = remember(all) {
        groupTasks(all.filter { it.archivedAt == null }.flatMap { extractTasks(it.id, it.title, JSONObject(it.raw).getJSONObject("content")) }, dateKey())
    }
    val tree = remember(all) { buildTagTree(all.filter { it.archivedAt == null }.map { it.tagList }) }
    val current = notebooks.find { "nb:${it.id}" == view }
    // A notebook deleted on another device shows all notes, and new notes go outside any notebook.
    val notes = listFor(if (view.startsWith("nb:") && current == null) "all" else view, all)

    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(searching && !drawer.isOpen) { closeSearch() }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    val pick = { key: String -> onView(key); scope.launch { drawer.close() } }
                    NavigationDrawerItem(label = { Text("Today") }, selected = view == "daily", onClick = { onToday(); scope.launch { drawer.close() } })
                    NavigationDrawerItem(
                        label = { Text("Tasks") },
                        badge = { (tasks.overdue.size + tasks.today.size + tasks.upcoming.size + tasks.someday.size).takeIf { it > 0 }?.let { Text("$it") } },
                        selected = view == "tasks",
                        onClick = { pick("tasks") },
                    )
                    NavigationDrawerItem(label = { Text("All notes") }, selected = view == "all", onClick = { pick("all") })
                    NavigationDrawerItem(label = { Text("PDFs") }, selected = view == "pdfs", onClick = { pick("pdfs") })
                    NavigationDrawerItem(label = { Text("Pinned") }, selected = view == "pinned", onClick = { pick("pinned") })
                    NavigationDrawerItem(label = { Text("Archive") }, selected = view == "archive", onClick = { pick("archive") })
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
                    if (tree.isNotEmpty()) {
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                tagsOpen = !tagsOpen
                                ui.edit { putBoolean("tagsOpen", tagsOpen) }
                            }.padding(16.dp, 12.dp, 16.dp, 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Tags", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                            Icon(
                                if (tagsOpen) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                if (tagsOpen) "Collapse tags" else "Expand tags",
                                Modifier.size(20.dp),
                            )
                        }
                        val shut = collapsed.split('\n').toSet()
                        fun rows(nodes: List<TagNode>, depth: Int): List<Pair<TagNode, Int>> =
                            nodes.flatMap { n -> listOf(n to depth) + if (n.path in shut) emptyList() else rows(n.children, depth + 1) }
                        if (tagsOpen) rows(tree, 0).forEach { (n, depth) ->
                            NavigationDrawerItem(
                                label = { Text(n.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                icon = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Spacer(Modifier.width((depth * 16).dp))
                                        if (n.children.isEmpty()) Text("#", Modifier.width(24.dp), textAlign = TextAlign.Center)
                                        else Icon(
                                            if (n.path in shut) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Default.KeyboardArrowDown,
                                            if (n.path in shut) "Expand ${n.path}" else "Collapse ${n.path}",
                                            Modifier.size(24.dp).clickable {
                                                collapsed = (if (n.path in shut) shut - n.path else shut + n.path).filter { it.isNotEmpty() }.joinToString("\n")
                                            },
                                        )
                                    }
                                },
                                badge = { Text(n.count.toString()) },
                                selected = view == "tag:${n.path}",
                                onClick = { pick("tag:${n.path}") },
                            )
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    NavigationDrawerItem(label = { Text("Trash") }, selected = false, onClick = { pick("trash") })
                    NavigationDrawerItem(label = { Text("Settings") }, selected = false, onClick = { pick("settings") })
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        if (searching) {
                            val focus = remember { FocusRequester() }
                            LaunchedEffect(Unit) { focus.requestFocus() }
                            TextField(
                                query, { query = it }, Modifier.fillMaxWidth().focusRequester(focus),
                                placeholder = { Text("Search notes and PDFs") },
                                singleLine = true,
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Color.Transparent,
                                    unfocusedContainerColor = Color.Transparent,
                                    focusedIndicatorColor = Color.Transparent,
                                    unfocusedIndicatorColor = Color.Transparent,
                                ),
                            )
                        } else Column {
                            Text(
                                current?.name?.ifBlank { "Untitled" } ?: when (view) {
                                    "pinned" -> "Pinned"
                                    "archive" -> "Archive"
                                    "daily" -> "Daily notes"
                                    "tasks" -> "Tasks"
                                    "pdfs" -> "PDFs"
                                    else -> tag?.let { "#$it" } ?: "Notes"
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
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
                    navigationIcon = {
                        if (searching) IconButton(onClick = closeSearch) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Close search") }
                        else IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Default.Menu, "Notebooks") }
                    },
                    actions = {
                        if (searching) {
                            if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, "Clear search") }
                            return@TopAppBar
                        }
                        IconButton(onClick = { searching = true }) { Icon(Icons.Default.Search, "Search") }
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                        DropdownMenu(menu, { menu = false }) {
                            if (tag != null) {
                                DropdownMenuItem(text = { Text("Rename tag") }, onClick = { menu = false; renamingTag = true })
                                DropdownMenuItem(text = { Text("Delete tag") }, onClick = { menu = false; deletingTag = true })
                            }
                            if (current != null) {
                                DropdownMenuItem(text = { Text("Rename notebook") }, onClick = { menu = false; naming = current })
                                DropdownMenuItem(text = { Text("Delete notebook") }, onClick = { menu = false; deleting = current })
                            }
                            DropdownMenuItem(text = { Text("Settings") }, onClick = { menu = false; onView("settings") })
                        }
                    },
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                // New notes only where they would show up, as on the web.
                if (!searching && (view == "all" || current != null || tag != null)) {
                    FloatingActionButton(onClick = { onNew(current?.id, tag) }) { Icon(Icons.Default.Add, "New note") }
                }
            },
        ) { pad ->
            PullToRefreshBox(syncing, onSync, Modifier.padding(pad).fillMaxSize()) {
                // Searching covers every view, as on the web.
                if (query.isNotBlank()) SearchBody(app, all, query, onOpen, onOpenPdf)
                else if (view == "tasks") TasksBody(app, tasks, onOpen)
                else if (view == "pdfs") PdfsBody(app, all, onOpenPdf)
                else LazyColumn(Modifier.fillMaxSize()) {
                    // Sub-notes nest where the web nests them: All, notebooks and tags.
                    val rows = if (view == "all" || view.startsWith("nb:") || tag != null) nestNotes(notes, shutNotes, { it.id }, { it.parentId })
                    else notes.map { Nested(it, 0, false) }
                    items(rows, key = { it.note.id }) { (note, depth, hasKids) ->
                        Column(Modifier.fillMaxWidth().clickable { onOpen(note.id) }.padding(start = (16 + depth * 20).dp, top = 12.dp, end = 16.dp, bottom = 12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (hasKids) {
                                    val open = note.id !in shutNotes
                                    Icon(
                                        if (open) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                        if (open) "Hide sub-notes" else "Show sub-notes",
                                        Modifier.size(22.dp).clickable {
                                            shutNotes = if (open) shutNotes + note.id else shutNotes - note.id
                                            ui.edit { putStringSet("collapsedNotes", shutNotes) }
                                        },
                                    )
                                }
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
    if (tag != null && renamingTag) NameDialog("Rename tag", tag, "Rename") { name ->
        renamingTag = false
        // Same as the web: a slash nests, and everything below the tag moves with it.
        val to = name?.let(::normalizeTag).orEmpty()
        if (to.isNotEmpty() && to != tag) {
            onView("tag:$to")
            app.scope.launch { app.retag(tag, to) }
        }
    }
    if (tag != null && deletingTag) {
        val count = notes.size
        AlertDialog(
            onDismissRequest = { deletingTag = false },
            title = { Text("Delete #$tag?") },
            text = { Text("The tag and anything nested under it come off $count ${if (count == 1) "note" else "notes"}. The notes stay.") },
            confirmButton = {
                TextButton(onClick = { deletingTag = false; onView("all"); app.scope.launch { app.retag(tag, "") } }) {
                    Text("Delete tag", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deletingTag = false }) { Text("Cancel") } },
        )
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
fun listFor(view: String, notes: List<NoteRow>, today: String = dateKey()): List<NoteRow> {
    val shelved = notes.filter { it.archivedAt == null }
    return when {
        // Daily notes with something in them, plus today's; archived ones too, as on the web.
        view == "daily" -> notes.filter { it.kind == "daily" && (it.text.isNotBlank() || it.date == today) }.sortedByDescending { it.date }
        view == "pinned" -> shelved.filter { it.pinned }
        view == "archive" -> notes.filter { it.archivedAt != null }
        view.startsWith("nb:") -> shelved.filter { it.notebookId == view.removePrefix("nb:") }
        view.startsWith("tag:") -> shelved.filter { noteHasTag(it.tagList, view.removePrefix("tag:")) }
        else -> shelved.filter { it.kind == "note" }
    }
}
