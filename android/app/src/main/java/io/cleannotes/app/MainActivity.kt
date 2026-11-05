package io.cleannotes.app

import android.os.Bundle
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as App
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                val paired by app.sync.paired.collectAsState()
                if (paired) NotesApp(app) else PairScreen(app.sync)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PairScreen(sync: Sync) {
    val context = LocalContext.current
    var url by rememberSaveable { mutableStateOf("https://") }
    var token by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val pair = { block: () -> Unit ->
        error = try {
            block()
            null
        } catch (e: Exception) {
            e.message ?: "That pairing code could not be read."
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text("Connect to server") }) }) { pad ->
        Column(
            Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("On the web app, open Settings → Sync → Pair a phone and scan the code. Or enter the server address and sync token.")
            Button(onClick = {
                GmsBarcodeScanning.getClient(context).startScan()
                    .addOnSuccessListener { code -> pair { sync.pair(code.rawValue ?: "") } }
                    .addOnFailureListener { error = "The scanner is not available on this phone. Enter the details instead." }
            }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
            OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth(), label = { Text("Server address") }, singleLine = true)
            OutlinedTextField(
                token, { token = it }, Modifier.fillMaxWidth(),
                label = { Text("Sync token") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
            )
            OutlinedButton(onClick = { pair { sync.pair(url, token) } }, Modifier.fillMaxWidth()) { Text("Connect") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun NotesApp(app: App) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var syncing by remember { mutableStateOf(false) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val runSync = {
        if (!syncing) scope.launch {
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

    val id = openId
    if (id != null) {
        BackHandler { openId = null }
        NoteScreen(app, id, onBack = { openId = null })
    } else {
        NoteList(app, syncing, snackbar, onSync = { runSync() }, onOpen = { openId = it })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoteList(app: App, syncing: Boolean, snackbar: SnackbarHostState, onSync: () -> Unit, onOpen: (String) -> Unit) {
    val notes by app.db.dao().liveNotes().collectAsStateWithLifecycle(emptyList())
    val syncedAt by app.sync.syncedAt.collectAsState()
    var menu by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Notes")
                        Text(
                            if (syncedAt == 0L) "Not synced yet" else "Synced ${DateUtils.getRelativeTimeSpanString(syncedAt)}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Disconnect") }, onClick = { menu = false; app.sync.unpair() })
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { pad ->
        PullToRefreshBox(syncing, onSync, Modifier.padding(pad).fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize()) {
                items(notes, key = { it.id }) { note ->
                    Column(Modifier.fillMaxWidth().clickable { onOpen(note.id) }.padding(16.dp, 12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (note.pinned) Text("Pinned", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            Text(note.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
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
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoteScreen(app: App, id: String, onBack: () -> Unit) {
    val note by app.db.dao().note(id).collectAsStateWithLifecycle(null)
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(note?.title?.ifBlank { "Untitled" } ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
    ) { pad ->
        // shortcut: plain text only; the Tiptap WebView viewer replaces this next.
        Text(
            note?.text ?: "",
            Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState()),
        )
    }
}
