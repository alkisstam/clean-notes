package io.cleannotes.app

import android.text.format.DateFormat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TimePicker
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID

private data class Todo(val id: String, val text: String, val done: Boolean)

val REPEATS = listOf(null to "Don't repeat", "daily" to "Daily", "weekly" to "Weekly", "monthly" to "Monthly", "yearly" to "Yearly")

/**
 * Adds or edits a reminder note (kind "reminder"): title, attached note, to-dos, date, time and repeat. [id] null makes a new one,
 * attached to [attach] if given. With [task] (note id to to-do id) it edits that to-do's own text, date and time instead.
 */
@Composable
fun ReminderScreen(app: App, id: String?, attach: String?, task: Pair<String, String>?, onClose: () -> Unit, onOpenNote: (String) -> Unit) {
    // An existing reminder opens to view; Edit switches to the form, and Cancel goes back with the changes dropped.
    val existing = remember {
        id != null || task?.let { (noteId, taskId) ->
            runBlocking { app.db.dao().noteOnce(noteId) }?.let { row -> extractTasks(noteId, row.title, JSONObject(row.raw).getJSONObject("content")).find { it.id == taskId }?.remind }
        } != null
    }
    var editing by rememberSaveable { mutableStateOf(!existing) }
    var rev by rememberSaveable { mutableStateOf(0) }
    key(rev) {
        ReminderForm(app, id, attach, task, onClose, onOpenNote, editing, if (existing) { on, drop -> editing = on; if (drop) rev++ } else null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderForm(
    app: App, id: String?, attach: String?, task: Pair<String, String>?, onClose: () -> Unit, onOpenNote: (String) -> Unit,
    editing: Boolean, onEdit: ((on: Boolean, drop: Boolean) -> Unit)?,
) {
    val ro = !editing
    val ctx = LocalContext.current
    val note = remember(id) { id?.let { runBlocking { app.db.dao().noteOnce(it) } }?.let { JSONObject(it.raw) } }
    val todo = remember(task) {
        task?.let { (noteId, taskId) ->
            runBlocking { app.db.dao().noteOnce(noteId) }?.let { row -> extractTasks(noteId, row.title, JSONObject(row.raw).getJSONObject("content")).find { it.id == taskId } }
        }
    }
    // The to-do was deleted meanwhile.
    if (task != null && todo == null) {
        LaunchedEffect(Unit) { onClose() }
        return
    }
    var ref by rememberSaveable { mutableStateOf(task?.first ?: note?.let(::noteRef) ?: attach) }
    val refRow = remember(ref) { ref?.let { runBlocking { app.db.dao().noteOnce(it) } }?.takeIf { it.trashedAt == null } }
    val nextHour = LocalDateTime.now().withMinute(0).withSecond(0).withNano(0).plusHours(1)
    val start = remember(id) {
        note?.let(::noteRemindAt)?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
            ?: todo?.let(::taskAt)
            ?: todo?.due?.let { runCatching { java.time.LocalDate.parse(it).atTime(nextHour.toLocalTime()) }.getOrNull() }
            ?: nextHour
    }
    // Only to-do lists at the top of the document are edited here; anything else in it is kept as it is.
    val content = remember(id) { note?.getJSONObject("content") ?: JSONObject().put("type", "doc").put("content", JSONArray()) }
    val blocks = remember(id) { content.optJSONArray("content")?.let { a -> List(a.length()) { a.getJSONObject(it) } }.orEmpty() }
    var title by rememberSaveable { mutableStateOf(note?.optString("title") ?: todo?.text ?: refRow?.title.orEmpty()) }
    var favorite by rememberSaveable { mutableStateOf(note?.optBoolean("favorite") ?: false) }
    var repeat by rememberSaveable { mutableStateOf(note?.let(::noteRepeat)) }
    val todos = remember(id) {
        val lists = JSONObject().put("type", "doc").put("content", JSONArray(blocks.filter { it.optString("type") == "taskList" }))
        mutableStateListOf<Todo>().apply { addAll(extractTasks("", "", lists).map { Todo(it.id, it.text, it.done) }) }
    }
    var focusTodo by remember { mutableStateOf<String?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val date = rememberDatePickerState(initialSelectedDateMillis = keyToMillis(start.toLocalDate().toString()))
    val time = rememberTimePickerState(start.hour, start.minute, DateFormat.is24HourFormat(ctx))
    val day = date.selectedDateMillis?.let(::millisToKey) ?: dateKey()
    val allowReminders = rememberReminderPermission()
    LaunchedEffect(Unit) { if (id == null && todo?.remind == null) allowReminders() }
    val titleFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (id == null && task == null && attach == null) titleFocus.requestFocus() }
    val addTodo = {
        val t = Todo(UUID.randomUUID().toString(), "", false)
        todos += t
        focusTodo = t.id
    }

    val save = save@{
        val at = "${day}T%02d:%02d".format(time.hour, time.minute)
        if (task != null && todo != null) {
            val name = title.trim()
            app.scope.launch {
                app.updateNote(task.first, contentChanged = true) { n, _ ->
                    var c = patchTask(n.getJSONObject("content"), task.second, mapOf("due" to day, "remind" to "%02d:%02d".format(time.hour, time.minute)))
                    if (name != todo.text) c = renameTask(c, task.second, name)
                    n.put("content", c).put("text", docText(c))
                }
            }
            if (onEdit != null) onEdit(false, false) else onClose()
            return@save
        }
        var doc = JSONObject().put("type", "doc").put("content", JSONArray(blocks.filter { it.optString("type") != "taskList" }))
        todos.filter { it.text.isNotBlank() }.forEach { t ->
            doc = appendTask(doc, t.id, t.text.trim(), null)
            if (t.done) doc = patchTask(doc, t.id, mapOf("checked" to true))
        }
        if (doc.getJSONArray("content").length() == 0) doc.put("content", JSONArray().put(JSONObject().put("type", "paragraph")))
        val fav = favorite
        val rep = repeat
        val name = title.trim()
        val attached = ref
        app.scope.launch {
            if (id == null) {
                val now = System.currentTimeMillis()
                app.saveNote(
                    JSONObject()
                        .put("id", UUID.randomUUID().toString())
                        .put("title", name)
                        .put("content", doc)
                        .put("text", docText(doc))
                        .put("notebookId", JSONObject.NULL)
                        .put("tags", JSONArray())
                        .put("kind", "reminder")
                        .put("pinned", false)
                        .put("createdAt", now)
                        .put("updatedAt", now)
                        .put("trashedAt", JSONObject.NULL)
                        .put("remindAt", at)
                        .put("repeat", rep ?: JSONObject.NULL)
                        .put("favorite", fav)
                        .put("doneAt", JSONObject.NULL)
                        .put("noteRef", attached ?: JSONObject.NULL),
                )
            } else app.updateNote(id, contentChanged = true) { n, _ ->
                // A new time makes a completed reminder active again.
                if (noteRemindAt(n) != at) n.put("doneAt", JSONObject.NULL)
                n.put("title", name).put("content", doc).put("text", docText(doc))
                    .put("remindAt", at).put("repeat", rep ?: JSONObject.NULL).put("favorite", fav).put("noteRef", attached ?: JSONObject.NULL)
            }
        }
        if (onEdit != null) onEdit(false, false) else onClose()
    }
    val cancel = { if (onEdit != null) onEdit(false, true) else onClose() }
    var askDelete by remember { mutableStateOf(false) }

    val clear = TextFieldDefaults.colors(
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
    )
    Box(Modifier.noteBounds(LocalOpenFrom.current.value.takeIf { it.startsWith("rem:") }, 0.dp).fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding().imePadding()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.End) {
                if (ro) IconButton(onClick = { onEdit?.invoke(true, false) }) {
                    Icon(painterResource(R.drawable.ic_pencil), "Edit reminder")
                }
                if (id != null || task != null && todo?.remind != null) IconButton(onClick = { askDelete = true }) {
                    Icon(painterResource(R.drawable.ic_trash), if (id != null) "Move reminder to Trash" else "Remove reminder")
                }
                // To-dos have no favorite flag of their own.
                if (task == null) IconButton(onClick = {
                    favorite = !favorite
                    val fav = favorite
                    if (ro && id != null) app.scope.launch { app.updateNote(id) { n, _ -> n.put("favorite", fav) } }
                }) {
                    Icon(
                        painterResource(if (favorite) R.drawable.ic_star_filled else R.drawable.ic_star),
                        if (favorite) "Remove from favorites" else "Add to favorites",
                        tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
            Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.padding(8.dp)) {
                    TextField(
                        title, { title = it }, Modifier.fillMaxWidth().heightIn(min = 96.dp).focusRequester(titleFocus),
                        readOnly = ro,
                        placeholder = { Text("Title") },
                        textStyle = MaterialTheme.typography.titleLarge,
                        colors = clear,
                    )
                    refRow?.let { r ->
                        NoteCard(r, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), onRemove = if (task == null && !ro) ({ ref = null }) else null) { onOpenNote(r.id) }
                    }
                    if (task == null) todos.forEachIndexed { i, t ->
                        val focus = remember(t.id) { FocusRequester() }
                        LaunchedEffect(focusTodo) { if (focusTodo == t.id) { focus.requestFocus(); focusTodo = null } }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RoundTick(t.done, if (t.done) "Mark to-do not done" else "Mark to-do done") { if (!ro) todos[i] = t.copy(done = !t.done) }
                            TextField(
                                t.text, { todos[i] = t.copy(text = it.replace("\n", "")) },
                                Modifier.weight(1f).focusRequester(focus).onPreviewKeyEvent { e ->
                                    // Backspace in an empty to-do removes it.
                                    (e.type == KeyEventType.KeyDown && e.key == Key.Backspace && t.text.isEmpty()).also { if (it) todos.removeAt(i) }
                                },
                                readOnly = ro,
                                placeholder = { Text("To-do") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { addTodo() }),
                                colors = clear,
                            )
                        }
                    }
                    if (task == null && !ro) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        IconButton(onClick = addTodo) { Icon(painterResource(R.drawable.ic_circle_check), "Add to-do") }
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    Option(R.drawable.ic_calendar_days, dueLabel(day), open == "date", enabled = !ro) { open = if (open == "date") null else "date" }
                    AnimatedVisibility(open == "date") {
                        DatePicker(date, title = null, headline = null, showModeToggle = false, colors = DatePickerDefaults.colors(containerColor = Color.Transparent))
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    Option(R.drawable.ic_clock, LocalTime.of(time.hour, time.minute).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)), open == "time", enabled = !ro) {
                        open = if (open == "time") null else "time"
                    }
                    AnimatedVisibility(open == "time") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { TimePicker(time) }
                    }
                    if (task == null) HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    if (task == null) Option(R.drawable.ic_repeat, REPEATS.first { it.first == repeat }.second, open == "repeat", dim = repeat == null, enabled = !ro) {
                        open = if (open == "repeat") null else "repeat"
                    }
                    AnimatedVisibility(open == "repeat") {
                        Column(Modifier.padding(bottom = 8.dp)) {
                            REPEATS.forEach { (key, label) ->
                                Row(Modifier.fillMaxWidth().clickable { repeat = key; open = null }.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(repeat == key, { repeat = key; open = null })
                                    Text(label)
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(112.dp))
        }
        if (!ro) Surface(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shadowElevation = 6.dp,
        ) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp).height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = cancel, Modifier.width(96.dp)) { Text("Cancel", fontWeight = FontWeight.SemiBold) }
                VerticalDivider(Modifier.height(20.dp))
                TextButton(onClick = save, Modifier.width(96.dp), enabled = title.isNotBlank()) { Text("Save", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
    if (askDelete) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text(if (id != null) "Delete reminder?" else "Remove reminder?") },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                app.scope.launch { if (id != null) app.trashNote(id) else if (task != null) app.setTaskAttrs(task.first, task.second, mapOf("remind" to null)) }
                onClose()
            }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text("Cancel") } },
    )
}

/** A note attached to a reminder: its title, and a preview of its text unless [compact]. Tapping opens it; [onRemove] detaches it. */
@Composable
fun NoteCard(note: NoteRow, modifier: Modifier = Modifier, compact: Boolean = false, onRemove: (() -> Unit)? = null, onClick: () -> Unit) = Box(modifier) {
    Surface(onClick = onClick, shape = RoundedCornerShape(if (compact) 14.dp else 20.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest) {
        Row(Modifier.padding(if (compact) 8.dp else 12.dp).padding(end = if (onRemove != null) 24.dp else 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(Modifier.size(if (compact) 28.dp else 36.dp), shape = CircleShape, color = MaterialTheme.colorScheme.primary) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.ic_file_text), null, Modifier.size(if (compact) 15.dp else 18.dp), tint = MaterialTheme.colorScheme.onPrimary)
                }
            }
            Column(Modifier.padding(start = 12.dp)) {
                Text(note.title.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                if (!compact && note.text.isNotBlank()) Text(
                    note.text.replace('\n', ' '), maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    if (onRemove != null) IconButton(onClick = onRemove, Modifier.align(Alignment.TopEnd).size(32.dp)) {
        Icon(Icons.Default.Close, "Detach note", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun Option(icon: Int, label: String, open: Boolean, dim: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) =
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(16.dp, 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(22.dp))
        Text(
            label, Modifier.padding(start = 20.dp).weight(1f),
            style = MaterialTheme.typography.titleMedium,
            color = if (open) MaterialTheme.colorScheme.primary else if (dim) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
