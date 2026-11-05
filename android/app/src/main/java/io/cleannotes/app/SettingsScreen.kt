package io.cleannotes.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(app: App, onBack: () -> Unit, onConnect: () -> Unit) {
    val theme by app.theme.collectAsState()
    val webFonts by app.webFonts.collectAsState()
    val paired by app.sync.paired.collectAsState()
    val syncedAt by app.sync.syncedAt.collectAsState()
    val scope = rememberCoroutineScope()
    var syncing by remember { mutableStateOf(false) }
    var syncNote by remember { mutableStateOf<String?>(null) }
    var backupNote by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var storage by remember { mutableStateOf("") }

    LaunchedEffect(busy) {
        storage = withContext(Dispatchers.IO) {
            val db = listOf("", "-wal", "-shm").sumOf { app.getDatabasePath("clean-notes$it").length() }
            val blobs = File(app.filesDir, "blobs").listFiles().orEmpty().sumOf { it.length() }
            "Notes ${formatBytes(db)} · PDFs and images ${formatBytes(blobs)}"
        }
    }
    val backupJob = { what: String, job: suspend () -> String ->
        busy = true
        backupNote = "$what…"
        scope.launch {
            backupNote = try {
                job()
            } catch (e: Throwable) {
                // OutOfMemoryError included: a huge file should fail with a message, not close the app.
                e.message ?: "That did not work."
            } finally {
                busy = false
            }
        }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) backupJob("Exporting") { app.backup.export(uri); "Backup saved." }
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) backupJob("Importing") {
            val r = app.backup.import(uri)
            // Same summary as the web's import.
            if (r.added + r.updated + r.deleted == 0) "Nothing new: this device already has everything in that backup."
            else listOfNotNull(
                r.added.takeIf { it > 0 }?.let { "$it added" },
                r.updated.takeIf { it > 0 }?.let { "$it updated" },
                r.deleted.takeIf { it > 0 }?.let { "$it deleted" },
            ).joinToString(", ").replaceFirstChar { it.uppercase() } + "."
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Settings") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Section("Appearance") {
                Text("Theme", style = MaterialTheme.typography.labelLarge)
                listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (key, label) ->
                    Choice(label, theme == key) { app.setTheme(key) }
                }
                Text("Fonts", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelLarge)
                Choice("Web fonts, as on the web app", webFonts) { app.setWebFonts(true) }
                Choice("This phone's fonts", !webFonts) { app.setWebFonts(false) }
            }
            Section("Sync") {
                if (paired) {
                    Text(app.sync.address().orEmpty(), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        if (syncedAt == 0L) "Not synced yet" else "Last synced ${ago(syncedAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !syncing, onClick = {
                            syncing = true
                            syncNote = null
                            scope.launch {
                                syncNote = try {
                                    app.sync.run()
                                    null
                                } catch (e: Exception) {
                                    if (e is SyncError) e.message else "Sync failed. Check your connection."
                                } finally {
                                    syncing = false
                                }
                            }
                        }) { Text(if (syncing) "Syncing…" else "Sync now") }
                        OutlinedButton(onClick = { app.sync.unpair() }) { Text("Disconnect") }
                    }
                    syncNote?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                } else {
                    Text("Notes stay on this phone. Connect to a Clean Notes server to keep your devices in step.")
                    Button(onClick = onConnect) { Text("Connect to server") }
                }
            }
            Section("Backup") {
                Text("One file with every note, notebook, PDF and image, in the web app's backup format. Importing merges: the newer edit of each note wins.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy, onClick = { exporter.launch("clean-notes-backup-${dateKey()}.json") }) { Text("Export") }
                    OutlinedButton(enabled = !busy, onClick = { importer.launch(arrayOf("application/json", "application/octet-stream", "*/*")) }) { Text("Import") }
                }
                backupNote?.let { Text(it) }
            }
            Section("Storage") {
                Text(storage, style = MaterialTheme.typography.bodyMedium)
                val version = remember { app.packageManager.getPackageInfo(app.packageName, 0).versionName }
                Text("Clean Notes $version", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp, 16.dp, 16.dp, 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        content()
    }
    HorizontalDivider()
}

@Composable
private fun Choice(label: String, selected: Boolean, onSelect: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected, role = Role.RadioButton, onClick = onSelect).padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected, onClick = null)
        Text(label, Modifier.padding(start = 8.dp))
    }
}
