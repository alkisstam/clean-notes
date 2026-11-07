package io.cleannotes.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Port of TasksBody in ListColumn.tsx: every task from notes that are not trashed or archived, grouped by due date. */
@Composable
fun TasksBody(app: App, groups: TaskGroups, onOpen: (String) -> Unit) {
    val today = dateKey()
    var text by remember { mutableStateOf("") }
    var due by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var showDone by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<TaskRef?>(null) }
    val add = {
        val value = text.trim()
        if (value.isNotEmpty()) {
            val d = due
            app.scope.launch { app.quickAddTask(value, d) }
            text = ""
            due = null
        }
    }
    val sections = listOf("Overdue" to groups.overdue, "Today" to groups.today, "Upcoming" to groups.upcoming, "No date" to groups.someday)
    val open = sections.sumOf { it.second.size }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp, 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    text, { text = it }, Modifier.weight(1f),
                    placeholder = { Text("Add a task to today's note") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { add() }),
                    supportingText = due?.let { { Text("Due ${dueLabel(it, today)}") } },
                )
                IconButton(onClick = { picking = true }) { Icon(Icons.Default.DateRange, "Due date for new task") }
            }
        }
        if (open == 0) {
            item {
                Text(
                    if (groups.done.isEmpty()) "No tasks yet. Add one above, or type /todo in any note." else "All caught up",
                    Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        sections.filter { it.second.isNotEmpty() }.forEach { (name, list) ->
            item(key = name) { Header(name, list.size, late = name == "Overdue") }
            items(list, key = { it.noteId + it.id }) { t -> TaskLine(app, t, today, onOpen) { editing = t } }
        }
        if (groups.done.isNotEmpty()) {
            item(key = "done") {
                Row(Modifier.fillMaxWidth().clickable { showDone = !showDone }.padding(16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (showDone) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight, null, Modifier.size(18.dp))
                    Text("Completed  ${groups.done.size}", style = MaterialTheme.typography.labelLarge)
                }
            }
            if (showDone) items(groups.done, key = { "done" + it.noteId + it.id }) { t -> TaskLine(app, t, today, onOpen) { editing = t } }
        }
    }

    if (picking) DueDialog(due, onDone = { due = it; picking = false }, onDismiss = { picking = false })
    editing?.let { t ->
        DueDialog(
            t.due,
            onDone = { d -> editing = null; app.scope.launch { app.setTaskAttrs(t.noteId, t.id, mapOf("due" to d)) } },
            onDismiss = { editing = null },
        )
    }
}

@Composable
private fun Header(name: String, count: Int, late: Boolean) = Text(
    "$name  $count",
    Modifier.padding(16.dp, 16.dp, 16.dp, 4.dp),
    style = MaterialTheme.typography.labelLarge,
    color = if (late) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
)

@Composable
private fun TaskLine(app: App, t: TaskRef, today: String, onOpen: (String) -> Unit, onDate: () -> Unit) {
    val late = t.due != null && t.due < today && !t.done
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(t.done, { checked -> app.scope.launch { app.setTaskAttrs(t.noteId, t.id, mapOf("checked" to checked)) } })
        Column(Modifier.weight(1f).clickable { onOpen(t.noteId) }.padding(vertical = 10.dp)) {
            Text(
                t.text,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textDecoration = if (t.done) TextDecoration.LineThrough else null,
                color = if (t.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                t.due?.let {
                    Text(dueLabel(it, today), style = MaterialTheme.typography.labelMedium,
                        color = if (late) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(t.noteTitle.ifBlank { "Untitled" }, style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        IconButton(onClick = onDate) { Icon(Icons.Default.DateRange, "Due date for ${t.text}") }
    }
}

/** Picks a due date; Clear removes it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DueDialog(initial: String?, onDone: (String?) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial?.let(::keyToMillis))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onDone(state.selectedDateMillis?.let(::millisToKey)) }) { Text("Set") } },
        dismissButton = {
            Row {
                TextButton(onClick = { onDone(null) }) { Text("Clear") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    ) { DatePicker(state) }
}
