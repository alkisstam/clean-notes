package io.cleannotes.app

import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.InputChip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.window.PopupProperties
import org.json.JSONObject
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
import androidx.compose.ui.window.Dialog
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
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
/** `pdf` is the web's PdfTarget as JSON text: {fileId, page?, query?}. */
fun NoteScreen(app: App, id: String, tag: String?, pdf: String?, onClose: () -> Unit, onOpenTag: (String) -> Unit, onOpenNote: (String) -> Unit) {
    val live by app.db.dao().liveNotes().collectAsStateWithLifecycle(emptyList())
    val allTags = remember(live) { allTagPaths(live.map { it.tagList }) }
    val note by app.db.dao().note(id).collectAsStateWithLifecycle(null)
    val view = remember(id) { NoteViewState() }
    var menu by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    // Queued behind the page's last save, so an empty check sees what was typed.
    val discard = { app.enqueue { app.discardIfEmpty(id) } }
    val back = { if (view.pdfOpen) view.closePdf() else view.flush { discard(); onClose() } }
    BackHandler { back() }
    // Pending keystrokes are saved and sent when the app goes to the background.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { view.flush { app.sync.runInBackground() } }
    Scaffold(
        topBar = {
            // The PDF viewer has its own toolbar; back still closes it.
            if (!view.pdfOpen) TopAppBar(
                title = {
                    // Daily notes step to the day before or after, creating it if needed, as on the web.
                    val date = note?.date?.takeIf { note?.kind == "daily" }
                    if (date != null) {
                        val go = { days: Long ->
                            view.flush { app.scope.launch { app.dailyNote(addDays(date, days)).let { withContext(Dispatchers.Main) { onOpenNote(it) } } } }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { go(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous day") }
                            IconButton(onClick = { go(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next day") }
                        }
                    }
                },
                navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    IconButton(onClick = view::undo, enabled = view.canUndo) { Icon(painterResource(R.drawable.ic_undo), "Undo", Modifier.size(22.dp)) }
                    IconButton(onClick = view::redo, enabled = view.canRedo) { Icon(painterResource(R.drawable.ic_redo), "Redo", Modifier.size(22.dp)) }
                    IconButton(onClick = { adding = true }) { Icon(painterResource(R.drawable.ic_plus), "Add", Modifier.size(22.dp)) }
                    Menu(adding, { adding = false }) {
                        // A sub-note keeps this note, so only leaving for a sibling may discard it.
                        val open = { leaving: Boolean, make: suspend () -> String? ->
                            adding = false
                            view.flush {
                                if (leaving) discard()
                                app.scope.launch { make()?.let { withContext(Dispatchers.Main) { onOpenNote(it) } } }
                            }
                        }
                        MenuItem("New note", { open(true) { app.newNote(note?.notebookId, tag) } }, R.drawable.ic_square_pen)
                        MenuItem("New sub-note", { open(false) { app.newSubNote(id, tag) } }, R.drawable.ic_file_plus)
                        MenuItem("Add image", { adding = false; view.pick("image") }, R.drawable.ic_image)
                        MenuItem("Add PDF", { adding = false; view.pick("pdf") }, R.drawable.ic_file_text)
                    }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    note?.let { n -> NoteMenu(app, n, live, menu, { menu = false }, view::flush, onClose) }
                },
            )
        },
    ) { pad ->
        note?.let { n ->
            Column(Modifier.padding(pad).consumeWindowInsets(pad).fillMaxSize().imePadding()) {
                // Saving pending keystrokes first keeps the editor from adopting a copy older than what it shows.
                val tags = { change: (List<String>) -> List<String> -> view.flush { app.scope.launch { app.editTags(id, change) } } }
                if (!view.pdfOpen) TagRow(
                    n.tagList, allTags,
                    onAdd = { t -> tags { if (t in it) it else it + t } },
                    onRemove = { t -> tags { it - t } },
                    onOpen = { t -> view.flush { discard(); onOpenTag(t) } },
                )
                NoteView(app, n, view, pdf, Modifier.weight(1f).fillMaxWidth())
            }
        }
    }
}

/** The note's ⋮ menu, also opened by a long press in the list. `before` runs first, to save pending keystrokes. */
@Composable
fun NoteMenu(
    app: App, note: NoteRow, live: List<NoteRow>, expanded: Boolean, onDismiss: () -> Unit, before: (() -> Unit) -> Unit, onTrashed: () -> Unit,
    centered: Boolean = false,
) {
    val context = LocalContext.current
    val id = note.id
    var nesting by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    val notebooks by app.db.dao().liveNotebooks().collectAsStateWithLifecycle(emptyList())
    val act = { block: suspend () -> Unit -> onDismiss(); before { app.scope.launch { block() } } }
    val items: @Composable () -> Unit = {
        // Same toggles as the web's note menu.
        MenuItem(if (note.pinned) "Unpin" else "Pin to top", {
            act { app.updateNote(id) { j, _ -> j.put("pinned", !note.pinned) } }
        })
        MenuItem(if (note.archivedAt != null) "Unarchive" else "Archive", {
            act { app.updateNote(id) { j, now -> j.put("archivedAt", if (note.archivedAt != null) JSONObject.NULL else now) } }
        })
        MenuItem("Move into note…", { onDismiss(); nesting = true })
        if (note.parentId != null) {
            MenuItem("Move to top level", {
                act { app.updateNote(id) { j, _ -> j.put("parentId", JSONObject.NULL) } }
            })
        }
        MenuItem("Move to notebook", { onDismiss(); moving = true })
        MenuItem("Move to Trash", {
            onDismiss()
            before { app.scope.launch { app.trashNote(id) }; onTrashed() }
        })
    }
    // A long press in the list opens it in the middle of the screen; the note page's ⋮ drops it from the corner.
    if (centered) {
        if (expanded) Dialog(onDismiss) {
            Surface(shape = MenuShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Column(Modifier.width(IntrinsicSize.Max).widthIn(min = 240.dp).padding(vertical = 8.dp)) { items() }
            }
        }
    } else Menu(expanded, onDismiss) { items() }
    if (nesting) {
        // The note itself and its own sub-notes cannot hold it; nestNote() also refuses them.
        val inside = mutableSetOf(id)
        var grew = true
        while (grew) grew = live.filter { it.parentId in inside }.map { it.id }.any { inside.add(it) }
        val targets = live.filter { it.archivedAt == null && it.id !in inside }.sortedBy { it.title.ifBlank { "Untitled" }.lowercase() }
        val pick = { target: String ->
            nesting = false
            before {
                app.scope.launch {
                    if (!app.nestNote(id, target)) withContext(Dispatchers.Main) {
                        Toast.makeText(context, "A note cannot go inside its own sub-note", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        AlertDialog(
            onDismissRequest = { nesting = false },
            title = { Text("Move into note") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    if (targets.isEmpty()) Text("There is no other note to move it into.")
                    targets.forEach { t ->
                        Text(
                            t.title.ifBlank { "Untitled" },
                            Modifier.fillMaxWidth().clickable { pick(t.id) }.padding(vertical = 12.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { nesting = false }) { Text("Cancel") } },
        )
    }
    if (moving) {
        val pick = { target: String? -> moving = false; before { app.scope.launch { app.moveNote(id, target) } } }
        AlertDialog(
            onDismissRequest = { moving = false },
            title = { Text("Move to notebook") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    (listOf<NotebookRow?>(null) + notebooks).forEach { nb ->
                        Row(Modifier.fillMaxWidth().clickable { pick(nb?.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = note.notebookId == nb?.id, onClick = { pick(nb?.id) })
                            Text(nb?.name?.ifBlank { "Untitled" } ?: "No notebook")
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { moving = false }) { Text("Cancel") } },
        )
    }
}

/** Port of TagInput in EditorPane.tsx: chips that open the tag, and a field that suggests existing tags. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagRow(tags: List<String>, allTags: List<String>, onAdd: (String) -> Unit, onRemove: (String) -> Unit, onOpen: (String) -> Unit) {
    var value by remember { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    val norm = normalizeTag(value)
    val options = if (value.isBlank()) emptyList() else allTags.filter { norm in it && it !in tags }.take(7)
    val add = { raw: String ->
        normalizeTag(raw).takeIf { it.isNotEmpty() }?.let(onAdd)
        value = ""
    }
    FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        tags.forEach { t ->
            InputChip(
                selected = false,
                onClick = { onOpen(t) },
                label = { Text(t) },
                trailingIcon = { Icon(Icons.Default.Close, "Remove tag $t", Modifier.size(16.dp).clickable { onRemove(t) }) },
            )
        }
        Box(Modifier.align(Alignment.CenterVertically)) {
            BasicTextField(
                value,
                { v -> if (v.endsWith(",")) add(v.dropLast(1)) else value = v },
                Modifier.widthIn(min = 140.dp).padding(vertical = 12.dp).onFocusChanged {
                    focused = it.isFocused
                    if (!it.isFocused && value.isNotBlank()) add(value)
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { add(value) }),
                decorationBox = { inner ->
                    if (value.isEmpty()) {
                        Text(
                            if (tags.isEmpty()) "Add a tag, like work/ideas" else "Add tag",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    inner()
                },
            )
            // Not focusable, so the keyboard stays up while suggestions show.
            Menu(focused && options.isNotEmpty(), {}, PopupProperties(focusable = false)) {
                options.forEach { o -> MenuItem(o, { add(o) }) }
            }
        }
    }
}
