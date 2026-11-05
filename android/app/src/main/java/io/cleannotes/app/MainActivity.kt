package io.cleannotes.app

import androidx.compose.runtime.key
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.os.Bundle
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch

fun ago(time: Long): CharSequence =
    if (System.currentTimeMillis() - time < 60_000) "just now"
    else DateUtils.getRelativeTimeSpanString(time, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as App
        setContent {
            CleanTheme { NotesApp(app) }
        }
    }
}

@Composable
fun NotesApp(app: App) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var connecting by rememberSaveable { mutableStateOf(false) }
    // One key per view, matching View in src/lib/types.ts: "all", "trash", "nb:<id>", ...
    var view by rememberSaveable { mutableStateOf("all") }
    // A PDF to open with the note, when the note was opened from the PDFs list.
    var openPdf by rememberSaveable { mutableStateOf<String?>(null) }
    val paired by app.sync.paired.collectAsState()
    val runSync = {
        if (!syncing && paired) scope.launch {
            syncing = true
            try {
                app.sync.run()
            } catch (e: Exception) {
                snackbar.showSnackbar(if (e is SyncError) e.message!! else "Sync failed. Check your connection.")
            } finally {
                syncing = false
            }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { runSync() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { app.sync.runInBackground() }

    LaunchedEffect(paired) {
        if (paired) {
            connecting = false
            runSync()
        }
    }

    val id = openId
    if (view == "trash") {
        BackHandler { view = "all" }
        TrashScreen(app, onBack = { view = "all" })
    } else if (connecting) {
        BackHandler { connecting = false }
        PairScreen(app.sync, onBack = { connecting = false })
    } else if (id != null) {
        // Keyed, so switching to another note (a new sub-note) builds a fresh editor for it.
        key(id) {
            NoteScreen(
                app, id, view.removePrefix("tag:").takeIf { view.startsWith("tag:") }, openPdf,
                onClose = { openId = null; openPdf = null },
                onOpenTag = { openId = null; view = "tag:$it" },
                onOpenNote = { openId = it },
            )
        }
    } else {
        NoteList(
            app, syncing, snackbar, view,
            onView = { view = it },
            onSync = { runSync() },
            onOpen = { openId = it },
            onOpenPdf = { note, file -> openPdf = file; openId = note },
            onNew = { nb, tag -> scope.launch { openId = app.newNote(nb, tag) } },
            onConnect = { connecting = true },
            onToday = { view = "daily"; scope.launch { openId = app.dailyNote(dateKey()) } },
        )
    }
}
