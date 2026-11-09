package io.cleannotes.app

import android.content.Intent
import android.net.Uri
import androidx.activity.SystemBarStyle
import androidx.compose.runtime.MutableState
import androidx.core.content.IntentCompat
import android.graphics.Color
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
    private val shared = mutableStateOf<Intent?>(null)

    private fun receive(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE) shared.value = intent
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receive(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A rotation or a return from Recents replays the original intent, which must not make a second note.
        if (savedInstanceState == null && intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0) receive(intent)
        enableEdgeToEdge()
        val app = application as App
        setContent {
            CleanTheme(app) {
                // Status bar icons follow the app's theme, which Settings can set apart from the system's.
                val dark = LocalDark.current
                LaunchedEffect(dark) {
                    val bars = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark }
                    enableEdgeToEdge(bars, bars)
                }
                NotesApp(app, shared)
            }
        }
    }
}

@Composable
fun NotesApp(app: App, shared: MutableState<Intent?>) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    // Notes left by following a link, so closing a note returns to the one that linked to it.
    var trail by rememberSaveable { mutableStateOf(listOf<String>()) }
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

    LaunchedEffect(shared.value) {
        val intent = shared.value ?: return@LaunchedEffect
        app.sharedFiles = if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        } else listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        val note = app.newNote(title = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty(), body = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty())
        connecting = false
        view = "all"
        trail = emptyList()
        openPdf = null
        openId = note
        // Last, because changing the key cancels this effect.
        shared.value = null
    }

    val id = openId
    if (view == "settings" && !connecting) {
        BackHandler { view = "all" }
        SettingsScreen(app, onBack = { view = "all" }, onConnect = { connecting = true })
    } else if (view == "trash") {
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
                onClose = { openId = trail.lastOrNull(); trail = trail.dropLast(1); openPdf = null },
                onOpenTag = { openId = null; trail = emptyList(); view = "tag:$it" },
                onOpenNote = { openId = it },
                onFollowLink = { trail = trail + id; openId = it; openPdf = null },
            )
        }
    } else {
        NoteList(
            app, syncing, snackbar, view,
            onView = { view = it },
            onSync = { runSync() },
            onOpen = { openId = it },
            onOpenPdf = { note, target -> openPdf = target; openId = note },
            onNew = { nb, tag -> scope.launch { openId = app.newNote(nb, tag) } },
        )
    }
}
