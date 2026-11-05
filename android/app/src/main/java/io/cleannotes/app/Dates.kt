package io.cleannotes.app

import android.text.format.DateFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// Port of the parts of src/lib/dates.ts the app needs. Keys are local calendar dates as YYYY-MM-DD.

fun dateKey(date: LocalDate = LocalDate.now()): String = date.toString()

fun addDays(key: String, days: Long): String = LocalDate.parse(key).plusDays(days).toString()

/** Like the web's longDate(): "Thursday, November 5, 2026", in the phone's language. */
fun longDate(key: String): String = LocalDate.parse(key).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL))

/** Like the web's shortDate(): "Nov 5", with the year only when it differs from today's. */
fun shortDate(key: String, today: String = dateKey()): String {
    val skeleton = if (key.take(4) == today.take(4)) "MMMd" else "MMMdyyyy"
    return LocalDate.parse(key).format(DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(Locale.getDefault(), skeleton)))
}

fun dueLabel(key: String, today: String = dateKey()) = when (key) {
    today -> "Today"
    addDays(today, 1) -> "Tomorrow"
    addDays(today, -1) -> "Yesterday"
    else -> shortDate(key, today)
}

// The date picker works in UTC milliseconds; date keys are plain calendar dates.
fun keyToMillis(key: String) = LocalDate.parse(key).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

fun millisToKey(ms: Long) = java.time.Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()
