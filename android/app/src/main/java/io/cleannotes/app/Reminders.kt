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
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/** When a task's reminder fires, in epoch millis; null for done tasks and ones without a due date and time. */
fun remindAt(t: TaskRef, zone: ZoneId = ZoneId.systemDefault()): Long? {
    if (t.done || t.due == null || t.remind == null) return null
    return runCatching { LocalDate.parse(t.due).atTime(LocalTime.parse(t.remind)).atZone(zone).toInstant().toEpochMilli() }.getOrNull()
}

/** The note's own reminder, local "YYYY-MM-DDTHH:MM", or null. */
fun noteRemindAt(note: JSONObject): String? = if (note.isNull("remindAt")) null else note.optString("remindAt").ifEmpty { null }

/** One notification to show: a to-do's or a whole note's. `key` keeps their notifications apart. */
data class Due(val key: String, val noteId: String, val title: String, val text: String, val at: Long)

/** Every reminder in a note's JSON: its to-dos' and its own. */
fun reminders(note: JSONObject, zone: ZoneId = ZoneId.systemDefault()): List<Due> {
    val id = note.getString("id")
    val title = note.optString("title").ifBlank { "Untitled" }
    val tasks = extractTasks(id, title, note.getJSONObject("content")).mapNotNull { t -> remindAt(t, zone)?.let { Due(t.id, id, t.text, title, it) } }
    val own = noteRemindAt(note)?.let { runCatching { LocalDateTime.parse(it).atZone(zone).toInstant().toEpochMilli() }.getOrNull() }
    return tasks + listOfNotNull(own?.let { Due(id, id, title, "Reminder", it) })
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
