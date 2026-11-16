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

/** Adds or edits a reminder note (kind "reminder"): title, to-dos, date, time and repeat. [id] null makes a new one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReminderScreen(app: App, id: String?, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val note = remember(id) { id?.let { runBlocking { app.db.dao().noteOnce(it) } }?.let { JSONObject(it.raw) } }
    val start = remember(id) {
        note?.let(::noteRemindAt)?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
            ?: LocalDateTime.now().withMinute(0).withSecond(0).withNano(0).plusHours(1)
    }
    // Only to-do lists at the top of the document are edited here; anything else in it is kept as it is.
    val content = remember(id) { note?.getJSONObject("content") ?: JSONObject().put("type", "doc").put("content", JSONArray()) }
    val blocks = remember(id) { content.optJSONArray("content")?.let { a -> List(a.length()) { a.getJSONObject(it) } }.orEmpty() }
    var title by rememberSaveable { mutableStateOf(note?.optString("title").orEmpty()) }
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
    LaunchedEffect(Unit) { if (id == null) allowReminders() }
    val titleFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (id == null) titleFocus.requestFocus() }
    val addTodo = {
        val t = Todo(UUID.randomUUID().toString(), "", false)
        todos += t
        focusTodo = t.id
    }

    val save = {
        val at = "${day}T%02d:%02d".format(time.hour, time.minute)
        var doc = JSONObject().put("type", "doc").put("content", JSONArray(blocks.filter { it.optString("type") != "taskList" }))
        todos.filter { it.text.isNotBlank() }.forEach { t ->
            doc = appendTask(doc, t.id, t.text.trim(), null)
            if (t.done) doc = patchTask(doc, t.id, mapOf("checked" to true))
        }
        if (doc.getJSONArray("content").length() == 0) doc.put("content", JSONArray().put(JSONObject().put("type", "paragraph")))
        val fav = favorite
        val rep = repeat
        val name = title.trim()
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
                        .put("doneAt", JSONObject.NULL),
                )
            } else app.updateNote(id, contentChanged = true) { n, _ ->
                // A new time makes a completed reminder active again.
                if (noteRemindAt(n) != at) n.put("doneAt", JSONObject.NULL)
                n.put("title", name).put("content", doc).put("text", docText(doc))
                    .put("remindAt", at).put("repeat", rep ?: JSONObject.NULL).put("favorite", fav)
            }
        }
        onClose()
    }

    val clear = TextFieldDefaults.colors(
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
    )
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding().imePadding()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.End) {
                if (id != null) IconButton(onClick = { app.scope.launch { app.trashNote(id) }; onClose() }) {
                    Icon(painterResource(R.drawable.ic_trash), "Move reminder to Trash")
                }
                IconButton(onClick = { favorite = !favorite }) {
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
                        placeholder = { Text("Title") },
                        textStyle = MaterialTheme.typography.titleLarge,
                        colors = clear,
                    )
                    todos.forEachIndexed { i, t ->
                        val focus = remember(t.id) { FocusRequester() }
                        LaunchedEffect(focusTodo) { if (focusTodo == t.id) { focus.requestFocus(); focusTodo = null } }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RoundTick(t.done, if (t.done) "Mark to-do not done" else "Mark to-do done") { todos[i] = t.copy(done = !t.done) }
                            TextField(
                                t.text, { todos[i] = t.copy(text = it.replace("\n", "")) },
                                Modifier.weight(1f).focusRequester(focus).onPreviewKeyEvent { e ->
                                    // Backspace in an empty to-do removes it.
                                    (e.type == KeyEventType.KeyDown && e.key == Key.Backspace && t.text.isEmpty()).also { if (it) todos.removeAt(i) }
                                },
                                placeholder = { Text("To-do") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { addTodo() }),
                                colors = clear,
                            )
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        IconButton(onClick = addTodo) { Icon(painterResource(R.drawable.ic_circle_check), "Add to-do") }
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    Option(R.drawable.ic_calendar_days, dueLabel(day), open == "date") { open = if (open == "date") null else "date" }
                    AnimatedVisibility(open == "date") {
                        DatePicker(date, title = null, headline = null, showModeToggle = false, colors = DatePickerDefaults.colors(containerColor = Color.Transparent))
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    Option(R.drawable.ic_clock, LocalTime.of(time.hour, time.minute).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)), open == "time") {
                        open = if (open == "time") null else "time"
                    }
                    AnimatedVisibility(open == "time") {
                        Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { TimePicker(time) }
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 12.dp))
                    Option(R.drawable.ic_repeat, REPEATS.first { it.first == repeat }.second, open == "repeat", dim = repeat == null) {
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
        Surface(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shadowElevation = 6.dp,
        ) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp).height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onClose, Modifier.width(96.dp)) { Text("Cancel", fontWeight = FontWeight.SemiBold) }
                VerticalDivider(Modifier.height(20.dp))
                TextButton(onClick = save, Modifier.width(96.dp), enabled = title.isNotBlank()) { Text("Save", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun Option(icon: Int, label: String, open: Boolean, dim: Boolean = false, onClick: () -> Unit) =
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp, 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(22.dp))
        Text(
            label, Modifier.padding(start = 20.dp).weight(1f),
            style = MaterialTheme.typography.titleMedium,
            color = if (open) MaterialTheme.colorScheme.primary else if (dim) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
