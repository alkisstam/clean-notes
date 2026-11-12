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
import java.time.LocalTime
import java.time.ZoneId

/** When a task's reminder fires, in epoch millis; null for done tasks and ones without a due date and time. */
fun remindAt(t: TaskRef, zone: ZoneId = ZoneId.systemDefault()): Long? {
    if (t.done || t.due == null || t.remind == null) return null
    return runCatching { LocalDate.parse(t.due).atTime(LocalTime.parse(t.remind)).atZone(zone).toInstant().toEpochMilli() }.getOrNull()
}

/** The earliest reminder after [after]. */
fun nextReminder(tasks: List<TaskRef>, after: Long, zone: ZoneId = ZoneId.systemDefault()): Long? =
    tasks.mapNotNull { remindAt(it, zone) }.filter { it > after }.minOrNull()

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

    private fun tasks(notes: List<NoteRow>) = notes.filter { it.trashedAt == null && it.archivedAt == null }
        .flatMap { extractTasks(it.id, it.title, JSONObject(it.raw).getJSONObject("content")) }

    fun schedule(ctx: Context, notes: List<NoteRow>) {
        val alarms = ctx.getSystemService(AlarmManager::class.java)
        val intent = PendingIntent.getBroadcast(ctx, 0, Intent(ctx, ReminderReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val at = nextReminder(tasks(notes), lastFired(ctx))
        if (at == null) return alarms.cancel(intent)
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
    }

    suspend fun fire(app: App) {
        val notes = app.db.dao().allNotes()
        val now = System.currentTimeMillis()
        val since = lastFired(app)
        val due = tasks(notes).filter { t -> remindAt(t)?.let { it in (since + 1)..now } == true }
        prefs(app).edit { putLong("lastFired", now) }
        if (due.isNotEmpty() && (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)) {
            val nm = app.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
            due.forEach { t ->
                val open = Intent(app, MainActivity::class.java).setAction(OPEN_NOTE).putExtra("noteId", t.noteId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val tap = PendingIntent.getActivity(app, t.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                nm.notify(t.id.hashCode(), NotificationCompat.Builder(app, CHANNEL)
                    .setSmallIcon(R.drawable.ic_bell)
                    .setContentTitle(t.text)
                    .setContentText(t.noteTitle.ifBlank { "Untitled" })
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
