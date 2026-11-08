package io.cleannotes.app

import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.background
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
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
) {
    val all by app.db.dao().liveNotes().collectAsStateWithLifecycle(emptyList())
    val notebooks by app.db.dao().liveNotebooks().collectAsStateWithLifecycle(emptyList())
    val trashed by app.db.dao().liveTrash().collectAsStateWithLifecycle(emptyList())
    val syncedAt by app.sync.syncedAt.collectAsState()
    val paired by app.sync.paired.collectAsState()
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
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
    var sort by remember { mutableStateOf(ui.getString("sort", "updated")!!) }
    var sorting by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(ui.getBoolean("grid", false)) }
    // Not a column, so read from each note's JSON once per change to the notes.
    val created = remember(all) { all.associate { it.id to JSONObject(it.raw).optLong("createdAt") } }
    val colors = remember(all) { all.associate { it.id to JSONObject(it.raw).optString("color") } }
    val byId = remember(all) { all.associateBy { it.id } }
    val dark = LocalDark.current
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
    val listed = listFor(if (view.startsWith("nb:") && current == null) "all" else view, all)
    // Pinned first, then the chosen order, as on the web. Daily notes keep their date order.
    val notes = if (view == "daily") listed else listed.sortedWith(
        compareByDescending<NoteRow> { it.pinned }.then(
            when (sort) {
                "created" -> compareByDescending { created[it.id] ?: 0L }
                "title" -> compareBy(String.CASE_INSENSITIVE_ORDER) { it.title.ifBlank { "Untitled" } }
                else -> compareByDescending { it.updatedAt }
            },
        ),
    )

    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(searching && !drawer.isOpen) { closeSearch() }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                // Same order, icons (Lucide) and counts as the web's sidebar.
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    val pick = { key: String -> onView(key); scope.launch { drawer.close() } }
                    @Composable
                    fun Item(label: String, icon: Int, key: String, count: Int? = null) = NavigationDrawerItem(
                        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        icon = { Icon(painterResource(icon), null, Modifier.size(20.dp)) },
                        badge = { count?.takeIf { it > 0 }?.let { Text("$it") } },
                        selected = view == key,
                        onClick = { pick(key) },
                    )
                    Item("All notes", R.drawable.ic_library, "all", listFor("all", all).size)
                    Item("Today", R.drawable.ic_calendar_days, "daily")
                    Item("Tasks", R.drawable.ic_circle_check, "tasks", tasks.overdue.size + tasks.today.size + tasks.upcoming.size + tasks.someday.size)
                    Item("PDFs", R.drawable.ic_file_text, "pdfs")
                    Item("Pinned", R.drawable.ic_pin, "pinned", listFor("pinned", all).size)
                    Item("Archive", R.drawable.ic_archive, "archive", listFor("archive", all).size)
                    Item("Trash", R.drawable.ic_trash, "trash", trashed.size)
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Notebooks", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                        IconButton(onClick = { creating = true; scope.launch { drawer.close() } }) {
                            Icon(painterResource(R.drawable.ic_plus), "New notebook", Modifier.size(18.dp))
                        }
                    }
                    notebooks.forEach { nb -> Item(nb.name.ifBlank { "Untitled" }, R.drawable.ic_book_open, "nb:${nb.id}", listFor("nb:${nb.id}", all).size) }
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
                                painterResource(if (tagsOpen) R.drawable.ic_chevron_down else R.drawable.ic_chevron_right),
                                if (tagsOpen) "Collapse tags" else "Expand tags",
                                Modifier.size(18.dp),
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
                                        if (n.children.isEmpty()) Icon(painterResource(R.drawable.ic_hash), null, Modifier.size(18.dp))
                                        else Icon(
                                            painterResource(if (n.path in shut) R.drawable.ic_chevron_right else R.drawable.ic_chevron_down),
                                            if (n.path in shut) "Expand ${n.path}" else "Collapse ${n.path}",
                                            Modifier.size(18.dp).clickable {
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
                    Item("Settings", R.drawable.ic_settings_2, "settings")
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
                        if (view != "daily" && view != "tasks" && view != "pdfs") IconButton(onClick = {
                            grid = !grid
                            ui.edit { putBoolean("grid", grid) }
                        }) {
                            Icon(painterResource(if (grid) R.drawable.ic_list else R.drawable.ic_layout_grid), if (grid) "List view" else "Grid view", Modifier.size(22.dp))
                        }
                        if (view != "daily" && view != "tasks" && view != "pdfs") Box {
                            IconButton(onClick = { sorting = true }) { Icon(painterResource(R.drawable.ic_arrow_down_up), "Sort by", Modifier.size(22.dp)) }
                            Menu(sorting, { sorting = false }) {
                                listOf("updated" to "Last edited", "created" to "Date created", "title" to "Title").forEach { (key, label) ->
                                    MenuItem(label, {
                                        sorting = false
                                        sort = key
                                        ui.edit { putString("sort", key) }
                                    }, checked = sort == key)
                                }
                            }
                        }
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                        Menu(menu, { menu = false }) {
                            if (tag != null) {
                                MenuItem("Rename tag", { menu = false; renamingTag = true })
                                MenuItem("Delete tag", { menu = false; deletingTag = true })
                            }
                            if (current != null) {
                                MenuItem("Rename notebook", { menu = false; naming = current })
                                MenuItem("Delete notebook", { menu = false; deleting = current })
                            }
                            MenuItem("Settings", { menu = false; onView("settings") })
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
                else if (view == "daily") DailyBody(app, all, onOpen)
                else if (view == "tasks") TasksBody(app, tasks, onOpen)
                else if (view == "pdfs") PdfsBody(app, all, onOpenPdf)
                else {
                    // Sub-notes nest where the web nests them: All, notebooks and tags.
                    val rows = if (view == "all" || view.startsWith("nb:") || tag != null) nestNotes(notes, shutNotes, { it.id }, { it.parentId })
                    else notes.map { Nested(it, 0, false) }
                    val toggle = { id: String ->
                        shutNotes = if (id in shutNotes) shutNotes - id else shutNotes + id
                        ui.edit { putStringSet("collapsedNotes", shutNotes) }
                    }
                    if (grid) {
                        // Null is an empty cell, so a sibling group ending mid-row doesn't share it with the next group.
                        val cells = buildList<Nested<NoteRow>?> {
                            var half = false
                            var group: String? = null
                            for (r in rows) {
                                val g = if (r.depth == 0) "" else r.note.parentId
                                if (r.hasKids) half = false
                                else {
                                    if (half && g != group) { add(null); half = false }
                                    half = !half
                                }
                                add(r)
                                group = g
                            }
                        }
                        // Sub-note lines go in the left column only, or they would also run between the two cards.
                        val left = BooleanArray(cells.size).also {
                            var col = 0
                            cells.forEachIndexed { i, c ->
                                if (c?.hasKids == true) { it[i] = true; col = 0 } else { it[i] = col == 0; col = 1 - col }
                            }
                        }
                        val neutral = MaterialTheme.colorScheme.outline
                        LazyVerticalGrid(
                            GridCells.Fixed(2), Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(cells.size, key = { cells[it]?.note?.id ?: "gap-$it" }, span = { GridItemSpan(if (cells[it]?.hasKids == true) maxLineSpan else 1) }) { i ->
                                val (note, depth, hasKids) = cells[i] ?: return@items
                                var pressed by remember { mutableStateOf(false) }
                                val sub = depth > 0
                                val bg = noteColor(colors[note.id], dark)
                                val rails = if (left[i]) railColors(note, depth, byId, colors, dark, neutral) else emptyList()
                                val nextDepth = (i + 1 until cells.size).firstOrNull { left[it] && cells[it] != null }?.let { cells[it]!!.depth } ?: 0
                                Box(Modifier.drawBehind {
                                    rails.forEachIndexed { k, c ->
                                        val bottom = size.height + if (nextDepth > k) 8.dp.toPx() else 0f
                                        drawRect(c, Offset((k * 12 + 4).dp.toPx(), 0f), Size(3.dp.toPx(), bottom))
                                    }
                                }.padding(start = (depth * 12).dp)) {
                                    Surface(shape = RoundedCornerShape(16.dp), color = bg ?: MaterialTheme.colorScheme.surfaceContainer) {
                                        Column(Modifier.fillMaxWidth().combinedClickable(onClick = { onOpen(note.id) }, onLongClick = {
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                            pressed = true
                                        }).padding(if (sub) 12.dp else 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            NoteTitle(note, hasKids, note.id !in shutNotes, { toggle(note.id) }, if (sub) MaterialTheme.typography.titleSmall else MaterialTheme.typography.titleMedium)
                                            Text(
                                                note.text.take(400).ifBlank { "No content yet" },
                                                style = if (sub) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
                                                color = if (bg != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                                minLines = if (sub) 4 else 6,
                                                maxLines = if (sub) 4 else 6,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                        }
                                    }
                                    NoteMenu(app, note, all, pressed, { pressed = false }, { it() }, {}, centered = true)
                                }
                            }
                        }
                    } else LazyColumn(Modifier.fillMaxSize()) {
                    items(rows, key = { it.note.id }) { (note, depth, hasKids) ->
                        var pressed by remember { mutableStateOf(false) }
                        val bg = noteColor(colors[note.id], dark)
                        val rails = railColors(note, depth, byId, colors, dark, MaterialTheme.colorScheme.outline)
                        // Drawn over the whole item so the line crosses the divider too.
                        Column(Modifier.drawWithContent {
                            drawContent()
                            rails.forEachIndexed { k, c -> drawRect(c, Offset((k * 20 + 22).dp.toPx(), 0f), Size(3.dp.toPx(), size.height)) }
                        }) {
                        Box {
                        Column(Modifier.fillMaxWidth().background(bg ?: Color.Transparent).combinedClickable(onClick = { onOpen(note.id) }, onLongClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            pressed = true
                        }).padding(start = (16 + depth * 20).dp, top = 12.dp, end = 16.dp, bottom = 12.dp)) {
                            NoteTitle(note, hasKids, note.id !in shutNotes, { toggle(note.id) }, MaterialTheme.typography.bodyLarge)
                            Text(
                                note.text.replace('\n', ' ').take(170).ifBlank { "No content yet" },
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (bg != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        NoteMenu(app, note, all, pressed, { pressed = false }, { it() }, {}, centered = true)
                        }
                        HorizontalDivider()
                        }
                    }
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

/** One color per ancestor, outermost first; a parent without a color gets `neutral`. */
private fun railColors(note: NoteRow, depth: Int, byId: Map<String, NoteRow>, colors: Map<String, String>, dark: Boolean, neutral: Color): List<Color> {
    val out = ArrayList<Color>(depth)
    var up = note.parentId?.let(byId::get)
    repeat(depth) {
        out += up?.let { noteColor(colors[it.id], dark) } ?: neutral
        up = up?.parentId?.let(byId::get)
    }
    return out.asReversed()
}

@Composable
private fun NoteTitle(note: NoteRow, hasKids: Boolean, open: Boolean, onToggle: () -> Unit, style: TextStyle) =
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (hasKids) Icon(
            if (open) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
            if (open) "Hide sub-notes" else "Show sub-notes",
            Modifier.size(22.dp).clickable(onClick = onToggle),
        )
        Text(note.title.ifBlank { "Untitled" }, Modifier.weight(1f, fill = false), style = style, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (note.pinned) Icon(painterResource(R.drawable.ic_pin), "Pinned", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
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
