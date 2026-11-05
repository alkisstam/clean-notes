package io.cleannotes.app

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** The Daily notes page: the web's calendar on top, then daily notes newest first. A tapped day opens its note. */
@Composable
fun DailyBody(app: App, all: List<NoteRow>, onOpen: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val today = dateKey()
    val open = { key: String -> scope.launch { onOpen(app.dailyNote(key)) } }
    val withNotes = remember(all) { all.filter { it.kind == "daily" && it.text.isNotBlank() }.mapNotNull { it.date }.toSet() }
    val notes = listFor("daily", all, today)
    LazyColumn(Modifier.fillMaxSize()) {
        item { Calendar(today, withNotes) { open(it) } }
        items(notes, key = { it.id }) { note ->
            Column(Modifier.fillMaxWidth().clickable { onOpen(note.id) }.padding(16.dp, 12.dp)) {
                Text(note.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    note.text.replace('\n', ' ').take(170).ifBlank { "No content yet" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            HorizontalDivider()
        }
    }
}

/** Port of Calendar in ListColumn.tsx: today in the accent color and boxed, a dot on days with a note. */
@Composable
private fun Calendar(today: String, withNotes: Set<String>, onPick: (String) -> Unit) {
    var month by rememberSaveable { mutableStateOf(today.take(7)) }
    val ym = YearMonth.parse(month)
    val weekStart = remember { firstDayOfWeek() }
    val grid = monthGrid(ym.year, ym.monthValue, weekStart)
    val locale = Locale.getDefault()
    val title = ym.atDay(1).format(DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMMyyyy")))
    val colors = MaterialTheme.colorScheme
    Column(Modifier.padding(12.dp, 4.dp, 12.dp, 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f).padding(start = 4.dp), fontWeight = FontWeight.SemiBold)
            IconButton(onClick = { month = ym.minusMonths(1).toString() }) { Icon(painterResource(R.drawable.ic_chevron_left), "Previous month", Modifier.size(18.dp)) }
            TextButton(onClick = { month = today.take(7); onPick(today) }) { Text("Today") }
            IconButton(onClick = { month = ym.plusMonths(1).toString() }) { Icon(painterResource(R.drawable.ic_chevron_right), "Next month", Modifier.size(18.dp)) }
        }
        Row {
            grid.take(7).forEach { key ->
                Text(
                    LocalDate.parse(key).dayOfWeek.getDisplayName(TextStyle.NARROW, locale),
                    Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant,
                )
            }
        }
        grid.chunked(7).forEach { week ->
            Row {
                week.forEach { key ->
                    val outside = key.take(7) != month
                    val isToday = key == today
                    val has = key in withNotes
                    Box(
                        Modifier.weight(1f).aspectRatio(1f).heightIn(max = 44.dp).padding(1.dp).clip(RoundedCornerShape(7.dp))
                            .then(if (isToday) Modifier.background(colors.onSurface) else Modifier)
                            .clickable { onPick(key) }
                            .alpha(if (outside && !isToday) 0.6f else 1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            LocalDate.parse(key).dayOfMonth.toString(),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                            color = when {
                                isToday -> colors.surface
                                outside -> colors.onSurfaceVariant
                                else -> colors.onSurface
                            },
                        )
                        if (has) {
                            Box(
                                Modifier.align(Alignment.BottomCenter).offset(y = (-5).dp).size(4.dp).clip(CircleShape)
                                    .background(if (isToday) colors.surface else colors.primary),
                            )
                        }
                    }
                }
            }
        }
    }
    HorizontalDivider()
}
