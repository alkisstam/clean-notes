package io.cleannotes.app

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// Port of the parts of src/lib/dates.ts the app needs. Keys are local calendar dates as YYYY-MM-DD.

fun dateKey(date: LocalDate = LocalDate.now()): String = date.toString()

fun addDays(key: String, days: Long): String = LocalDate.parse(key).plusDays(days).toString()

/** Like the web's longDate(): "Thursday, November 5, 2026", in the phone's language. */
fun longDate(key: String): String = LocalDate.parse(key).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL))
