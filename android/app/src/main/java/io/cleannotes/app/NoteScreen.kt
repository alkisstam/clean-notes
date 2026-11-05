package io.cleannotes.app

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
fun NoteScreen(app: App, id: String, tag: String?, onClose: () -> Unit, onOpenTag: (String) -> Unit, onOpenNote: (String) -> Unit) {
    val context = LocalContext.current
    var nesting by remember { mutableStateOf(false) }
    val live by app.db.dao().liveNotes().collectAsStateWithLifecycle(emptyList())
    val allTags = remember(live) { allTagPaths(live.map { it.tagList }) }
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
                        // Same toggles as the web's note menu; pending keystrokes are saved first.
                        val n = note
                        if (n != null) {
                            DropdownMenuItem(text = { Text(if (n.pinned) "Unpin" else "Pin to top") }, onClick = {
                                menu = false
                                view.flush { app.scope.launch { app.updateNote(id) { j, _ -> j.put("pinned", !n.pinned) } } }
                            })
                            DropdownMenuItem(text = { Text(if (n.archivedAt != null) "Unarchive" else "Archive") }, onClick = {
                                menu = false
                                view.flush { app.scope.launch { app.updateNote(id) { j, now -> j.put("archivedAt", if (n.archivedAt != null) JSONObject.NULL else now) } } }
                            })
                        }
                        DropdownMenuItem(text = { Text("New sub-note") }, onClick = {
                            menu = false
                            view.flush { app.scope.launch { app.newSubNote(id, tag)?.let { withContext(Dispatchers.Main) { onOpenNote(it) } } } }
                        })
                        DropdownMenuItem(text = { Text("Move into note…") }, onClick = { menu = false; nesting = true })
                        if (note?.parentId != null) {
                            DropdownMenuItem(text = { Text("Move to top level") }, onClick = {
                                menu = false
                                view.flush { app.scope.launch { app.updateNote(id) { j, _ -> j.put("parentId", JSONObject.NULL) } } }
                            })
                        }
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
        note?.let { n ->
            Column(Modifier.padding(pad).consumeWindowInsets(pad).fillMaxSize().imePadding()) {
                // Saving pending keystrokes first keeps the editor from adopting a copy older than what it shows.
                val tags = { change: (List<String>) -> List<String> -> view.flush { app.scope.launch { app.editTags(id, change) } } }
                TagRow(
                    n.tagList, allTags,
                    onAdd = { t -> tags { if (t in it) it else it + t } },
                    onRemove = { t -> tags { it - t } },
                    onOpen = { t -> view.flush { onOpenTag(t) } },
                )
                NoteView(app, n, view, Modifier.weight(1f).fillMaxWidth())
            }
        }
    }
    if (nesting) {
        // The note itself and its own sub-notes cannot hold it; nestNote() also refuses them.
        val inside = mutableSetOf(id)
        var grew = true
        while (grew) grew = live.filter { it.parentId in inside }.map { it.id }.any { inside.add(it) }
        val targets = live.filter { it.archivedAt == null && it.id !in inside }.sortedBy { it.title.ifBlank { "Untitled" }.lowercase() }
        val pick = { target: String ->
            nesting = false
            view.flush {
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
            DropdownMenu(focused && options.isNotEmpty(), onDismissRequest = {}, properties = PopupProperties(focusable = false)) {
                options.forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { add(o) }) }
            }
        }
    }
}
