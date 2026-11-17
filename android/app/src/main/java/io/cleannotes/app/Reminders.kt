package io.cleannotes.app

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/** When a task's reminder fires, in epoch millis; null for done tasks and ones without a due date and time. */
fun remindAt(t: TaskRef, zone: ZoneId = ZoneId.systemDefault()): Long? =
    if (t.done) null else taskAt(t)?.atZone(zone)?.toInstant()?.toEpochMilli()

/** A task's local reminder time, done or not; null without a due date and time. */
fun taskAt(t: TaskRef): LocalDateTime? =
    if (t.due == null || t.remind == null) null else runCatching { LocalDate.parse(t.due).atTime(LocalTime.parse(t.remind)) }.getOrNull()

/** The note's own reminder, local "YYYY-MM-DDTHH:MM", or null. */
fun noteRemindAt(note: JSONObject): String? = if (note.isNull("remindAt")) null else note.optString("remindAt").ifEmpty { null }

fun noteRepeat(note: JSONObject): String? = if (note.isNull("repeat")) null else note.optString("repeat").ifEmpty { null }

fun noteDone(note: JSONObject) = !note.isNull("doneAt")

/** The note a reminder made with Add reminder is attached to, or null. */
fun noteRef(note: JSONObject): String? = if (note.isNull("noteRef")) null else note.optString("noteRef").ifEmpty { null }

/** The open reminder attached to [noteId], so a second Add reminder edits it instead of making another. */
fun linkedReminder(notes: List<NoteRow>, noteId: String): NoteRow? = notes.firstOrNull {
    it.kind == "reminder" && it.trashedAt == null && it.archivedAt == null && JSONObject(it.raw).let { n -> noteRef(n) == noteId && !noteDone(n) }
}

/**
 * Reminders used to sit on the note itself; each becomes a reminder note attached to it. The id comes from the note's,
 * so two devices converting the same one make the same record.
 */
fun migratedReminder(note: JSONObject, now: Long): JSONObject? {
    if (note.optString("kind") == "reminder") return null
    val at = noteRemindAt(note) ?: return null
    val id = note.getString("id")
    val content = JSONObject().put("type", "doc").put("content", JSONArray().put(JSONObject().put("type", "paragraph")))
    return JSONObject()
        .put("id", java.util.UUID.nameUUIDFromBytes("reminder:$id".toByteArray()).toString())
        .put("title", note.optString("title").ifBlank { "Untitled" })
        .put("content", content)
        .put("text", "")
        .put("notebookId", JSONObject.NULL)
        .put("tags", JSONArray())
        .put("kind", "reminder")
        .put("pinned", false)
        .put("createdAt", now)
        .put("updatedAt", now)
        .put("trashedAt", JSONObject.NULL)
        .put("remindAt", at)
        .put("repeat", noteRepeat(note) ?: JSONObject.NULL)
        .put("favorite", note.optBoolean("favorite"))
        .put("doneAt", if (noteDone(note)) note.get("doneAt") else JSONObject.NULL)
        .put("noteRef", id)
}

/** The first time after [now] that a reminder repeating from [at] falls on; counted from [at] so Jan 31 stays the 31st where it can. */
fun nextRepeat(at: LocalDateTime, repeat: String, now: LocalDateTime): LocalDateTime {
    val step: (Long) -> LocalDateTime = when (repeat) {
        "daily" -> at::plusDays
        "weekly" -> at::plusWeeks
        "monthly" -> at::plusMonths
        else -> at::plusYears
    }
    var k = 1L
    while (!step(k).isAfter(now)) k++
    return step(k)
}

/** A repeating note reminder whose time has passed moves to its next time; null when it stays, as a completed one does. */
fun advancedRemindAt(note: JSONObject, now: LocalDateTime): String? {
    val repeat = noteRepeat(note) ?: return null
    if (noteDone(note)) return null
    val at = noteRemindAt(note)?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() } ?: return null
    return if (at.isAfter(now)) null else nextRepeat(at, repeat, now).toString().take(16)
}

/** One line on the Reminders page: a note's own reminder (taskId null) or a to-do's. */
/** [ref] is the note shown as a card under it: the attached note, or a to-do's own note; null when there is none or it is in the Trash. */
data class ReminderItem(val key: String, val noteId: String, val taskId: String?, val title: String, val at: LocalDateTime, val repeat: String?, val favorite: Boolean, val done: Boolean, val kind: String, val ref: NoteRow? = null)

fun reminderItems(notes: List<NoteRow>): List<ReminderItem> {
    val live = notes.filter { it.trashedAt == null && it.archivedAt == null }
    val byId = live.associateBy { it.id }
    return live.flatMap { row ->
        val note = JSONObject(row.raw)
        val title = row.title.ifBlank { "Untitled" }
        val own = noteRemindAt(note)?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }?.let {
            ReminderItem(row.id, row.id, null, title, it, noteRepeat(note), note.optBoolean("favorite"), noteDone(note), row.kind, noteRef(note)?.let(byId::get))
        }
        val tasks = extractTasks(row.id, title, note.getJSONObject("content")).mapNotNull { t ->
            taskAt(t)?.let { ReminderItem(row.id + t.id, row.id, t.id, t.text, it, null, false, t.done, row.kind, row.takeIf { row.kind != "reminder" }) }
        }
        listOfNotNull(own) + tasks
    }
}

data class ReminderGroups(val today: List<ReminderItem>, val scheduled: List<ReminderItem>, val completed: List<ReminderItem>)

fun groupReminders(items: List<ReminderItem>, today: LocalDate): ReminderGroups {
    val order = compareByDescending<ReminderItem> { it.favorite }.thenBy { it.at }
    val open = items.filter { !it.done }
    return ReminderGroups(
        open.filter { !it.at.toLocalDate().isAfter(today) }.sortedWith(order),
        open.filter { it.at.toLocalDate().isAfter(today) }.sortedWith(order),
        items.filter { it.done }.sortedWith(compareByDescending { it.at }),
    )
}

/** One notification to show: a to-do's or a whole note's. `key` keeps their notifications apart. */
data class Due(val key: String, val noteId: String, val title: String, val text: String, val at: Long)

/** Every reminder in a note's JSON: its to-dos' and its own. */
fun reminders(note: JSONObject, zone: ZoneId = ZoneId.systemDefault()): List<Due> {
    val id = note.getString("id")
    val title = note.optString("title").ifBlank { "Untitled" }
    val tasks = extractTasks(id, title, note.getJSONObject("content")).mapNotNull { t -> remindAt(t, zone)?.let { Due(t.id, id, t.text, title, it) } }
    val own = noteRemindAt(note)?.takeIf { !noteDone(note) }?.let { runCatching { LocalDateTime.parse(it).atZone(zone).toInstant().toEpochMilli() }.getOrNull() }
    // Tapping it opens the attached note, if there is one.
    return tasks + listOfNotNull(own?.let { Due(id, noteRef(note) ?: id, title, "Reminder", it) })
}

/** The earliest reminder after [after]. */
fun nextReminder(due: List<Due>, after: Long): Long? = due.map { it.at }.filter { it > after }.minOrNull()

/**
 * One alarm, for the next reminder after the last time reminders were shown; the receiver shows every one due since,
 * then sets the next. So there is no per-task alarm to cancel when a task changes.
 */
object Reminders {
    private const val CHANNEL = "reminders"
    const val OPEN_NOTE = "io.cleannotes.app.OPEN_NOTE"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)

    /** Starts at the first run, so reminders set before this version don't all fire at once. */
    private fun lastFired(ctx: Context): Long {
        val p = prefs(ctx)
        if (!p.contains("lastFired")) p.edit { putLong("lastFired", System.currentTimeMillis()) }
        return p.getLong("lastFired", 0)
    }

    private fun due(notes: List<NoteRow>) = notes.filter { it.trashedAt == null && it.archivedAt == null }.flatMap { reminders(JSONObject(it.raw)) }

    fun schedule(ctx: Context, notes: List<NoteRow>) {
        val alarms = ctx.getSystemService(AlarmManager::class.java)
        val intent = PendingIntent.getBroadcast(ctx, 0, Intent(ctx, ReminderReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val at = nextReminder(due(notes), lastFired(ctx))
        if (at == null) return alarms.cancel(intent)
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }

    suspend fun fire(app: App) {
        val notes = app.db.dao().allNotes()
        val now = System.currentTimeMillis()
        val since = lastFired(app)
        val due = due(notes).filter { it.at in (since + 1)..now }
        prefs(app).edit { putLong("lastFired", now) }
        if (due.isNotEmpty() && (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)) {
            val nm = app.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
            due.forEach { t ->
                val open = Intent(app, MainActivity::class.java).setAction(OPEN_NOTE).putExtra("noteId", t.noteId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val tap = PendingIntent.getActivity(app, t.key.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                nm.notify(t.key.hashCode(), NotificationCompat.Builder(app, CHANNEL)
                    .setSmallIcon(R.drawable.ic_bell)
                    .setContentTitle(t.title)
                    .setContentText(t.text)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .build())
            }
        }
        // Repeating reminders that have come round move on to their next time; the notes collector then reschedules.
        val nowLocal = LocalDateTime.now()
        notes.filter { it.trashedAt == null && it.archivedAt == null }.forEach { row ->
            val next = advancedRemindAt(JSONObject(row.raw), nowLocal) ?: return@forEach
            app.updateNote(row.id) { j, _ -> j.put("remindAt", next) }
        }
        schedule(app, notes)
    }
}

/** The reminder alarm, and boot and app updates, which clear alarms. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as App
        val done = goAsync()
        app.scope.launch {
            try {
                Reminders.fire(app)
            } finally {
                done.finish()
            }
        }
    }
}
