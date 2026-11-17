package io.cleannotes.app

import androidx.compose.foundation.BorderStroke
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import android.content.Context
import androidx.core.content.edit
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Today, Scheduled and Completed as three cards in one row, and the picked group's reminders as cards below. */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun RemindersBody(
    app: App, groups: ReminderGroups, colors: Map<String, String>, onOpen: (String) -> Unit, onEdit: (String) -> Unit, onEditTask: (noteId: String, taskId: String) -> Unit,
    onSelecting: (Boolean) -> Unit,
) {
    // Kept like the list's sort, so it survives the reminder editor replacing this screen.
    val ui = remember { app.getSharedPreferences("ui", Context.MODE_PRIVATE) }
    var tab by remember { mutableStateOf(ui.getString("reminderTab", "today")!!) }
    val list = when (tab) {
        "scheduled" -> groups.scheduled
        "completed" -> groups.completed
        else -> groups.today
    }
    val now = LocalDateTime.now()
    val dark = LocalDark.current
    val haptic = LocalHapticFeedback.current
    val from = LocalOpenFrom.current
    // Keys of the picked reminders; null outside select mode.
    var selected by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val toggle = { key: String -> selected = selected.orEmpty().let { if (key in it) it - key else it + key } }
    LaunchedEffect(tab) { selected = null }
    LaunchedEffect(selected != null) { onSelecting(selected != null) }
    BackHandler(selected != null) { selected = null }
    Box(Modifier.fillMaxSize()) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp, 12.dp, 12.dp, 96.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    Triple("today", "Today", R.drawable.ic_calendar_days) to groups.today.size,
                    Triple("scheduled", "Scheduled", R.drawable.ic_clock) to groups.scheduled.size,
                    Triple("completed", "Completed", R.drawable.ic_circle_check) to groups.completed.size,
                ).forEach { (t, count) ->
                    val (key, label, icon) = t
                    val on = tab == key
                    Surface(
                        onClick = { tab = key; ui.edit { putString("reminderTab", key) } },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(20.dp),
                        color = if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Icon(painterResource(icon), null, Modifier.size(20.dp))
                            Text("$count", Modifier.padding(top = 10.dp), style = MaterialTheme.typography.headlineSmall)
                            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        if (list.isEmpty()) item {
            Text(
                when (tab) {
                    "scheduled" -> "Nothing scheduled"
                    "completed" -> "No completed reminders"
                    else -> "Nothing due today"
                },
                Modifier.padding(16.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        items(list, key = { it.key }) { r ->
            val late = !r.done && r.at.isBefore(now)
            val picked = r.key in selected.orEmpty()
            val shape = RoundedCornerShape(16.dp)
            Surface(
                modifier = Modifier.fillMaxWidth().animateItem().noteBounds("rem:${r.key}|reminders", 16.dp).clip(shape).combinedClickable(
                    onClick = {
                        if (selected != null) toggle(r.key)
                        else if (r.kind != "reminder" && r.taskId == null) onOpen(r.noteId)
                        else {
                            from.value = "rem:${r.key}|reminders"
                            if (r.taskId != null) onEditTask(r.noteId, r.taskId) else onEdit(r.noteId)
                        }
                    },
                    onLongClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        if (selected == null) selected = listOf(r.key) else toggle(r.key)
                    },
                ),
                shape = shape,
                color = noteColor(colors[r.noteId], dark) ?: MaterialTheme.colorScheme.surfaceContainer,
                border = if (picked) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
            ) {
                Row(Modifier.padding(start = 4.dp, end = 16.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    // In select mode the circle picks the card instead of ticking it.
                    if (selected != null) RoundTick(picked, if (picked) "Deselect ${r.title}" else "Select ${r.title}") { toggle(r.key) }
                    else RoundTick(r.done, if (r.done) "Mark ${r.title} not done" else "Mark ${r.title} done") { app.scope.launch { tick(app, r) } }
                    Column(Modifier.weight(1f)) {
                        Text(
                            r.title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium,
                            textDecoration = if (r.done) TextDecoration.LineThrough else null,
                            color = if (r.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                        Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${dueLabel(r.at.toLocalDate().toString())} ${r.at.toLocalTime().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))}",
                                style = MaterialTheme.typography.labelMedium,
                                color = if (late) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (r.repeat != null) Icon(painterResource(R.drawable.ic_repeat), "Repeats ${r.repeat}", Modifier.padding(start = 6.dp).size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        r.ref?.let { n -> NoteCard(n, Modifier.padding(top = 8.dp), compact = true) { if (selected != null) toggle(r.key) else onOpen(n.id) } }
                    }
                    if (r.favorite) Box(Modifier.padding(start = 8.dp)) {
                        Icon(painterResource(R.drawable.ic_star_filled), "Favorite", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
    selected?.let { keys ->
        val picked = list.filter { it.key in keys }
        val allDone = picked.isNotEmpty() && picked.all { it.done }
        // To-dos have no favorite flag of their own.
        val favable = picked.filter { it.taskId == null }
        val allFav = favable.isNotEmpty() && favable.all { it.favorite }
        val done = { selected = null }
        Surface(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp),
            shape = RoundedCornerShape(36.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shadowElevation = 6.dp,
        ) {
            Row(Modifier.padding(horizontal = 8.dp, vertical = 10.dp)) {
                PillAction(if (allDone) "Restore" else "Complete", R.drawable.ic_circle_check, picked.isNotEmpty()) {
                    app.scope.launch {
                        picked.forEach { r ->
                            if (r.taskId != null) app.setTaskAttrs(r.noteId, r.taskId, mapOf("checked" to !allDone))
                            else setDone(app, r, !allDone)
                        }
                    }
                    done()
                }
                PillAction(if (allFav) "Unfavorite" else "Favorite", if (allFav) R.drawable.ic_star_filled else R.drawable.ic_star, favable.isNotEmpty()) {
                    app.scope.launch { favable.forEach { r -> app.updateNote(r.noteId) { n, _ -> n.put("favorite", !allFav) } } }
                    done()
                }
                PillAction("Delete", R.drawable.ic_trash, picked.isNotEmpty()) {
                    app.scope.launch { picked.forEach { deleteReminder(app, it) } }
                    done()
                }
            }
        }
    }
    }
}

/** A circle, ticked when [on]. */
@Composable
fun RoundTick(on: Boolean, label: String, onClick: () -> Unit) = IconButton(onClick = onClick) {
    if (on) Icon(painterResource(R.drawable.ic_circle_check), label, tint = MaterialTheme.colorScheme.primary)
    else Surface(
        Modifier.size(20.dp).semantics { contentDescription = label }, shape = CircleShape, color = Color.Transparent,
        border = BorderStroke(2.dp, MaterialTheme.colorScheme.outline),
    ) {}
}

/** A note made with Add reminder goes to the Trash; other notes and to-dos only lose their reminder. */
private suspend fun deleteReminder(app: App, r: ReminderItem) = when {
    r.taskId != null -> app.setTaskAttrs(r.noteId, r.taskId, mapOf("remind" to null))
    r.kind == "reminder" -> app.trashNote(r.noteId)
    else -> app.updateNote(r.noteId) { n, _ -> n.put("remindAt", JSONObject.NULL).put("repeat", JSONObject.NULL) }
}

/** A to-do ticks in its note; a repeating reminder moves to its next time; any other reminder is marked done, or undone. */
private suspend fun tick(app: App, r: ReminderItem) {
    if (r.taskId != null) return app.setTaskAttrs(r.noteId, r.taskId, mapOf("checked" to !r.done))
    if (r.repeat != null && !r.done) app.updateNote(r.noteId) { n, _ -> n.put("remindAt", nextRepeat(r.at, r.repeat, maxOf(r.at, LocalDateTime.now())).toString().take(16)) }
    else setDone(app, r, !r.done)
}

/** Completes or restores a note's own reminder; one made with Add reminder ticks or unticks its to-dos along with it. */
private suspend fun setDone(app: App, r: ReminderItem, done: Boolean) {
    val own = r.kind == "reminder"
    app.updateNote(r.noteId, contentChanged = own) { n, now ->
        n.put("doneAt", if (done) now else JSONObject.NULL)
        if (own) n.put("content", checkAllTasks(n.getJSONObject("content"), done))
    }
}
