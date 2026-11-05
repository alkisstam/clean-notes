package io.cleannotes.app

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import org.json.JSONObject

// Each row keeps the server's JSON in `raw`, so fields this app doesn't know yet survive a round-trip.
@Entity(tableName = "notes")
data class NoteRow(
    @PrimaryKey val id: String,
    val title: String,
    val text: String,
    val notebookId: String?,
    val kind: String,
    val date: String?,
    val pinned: Boolean,
    val updatedAt: Long,
    val trashedAt: Long?,
    val archivedAt: Long?,
    val raw: String,
    /** When this device last wrote the row; 0 for rows that came from the server. Push picks rows by this. */
    val savedAt: Long = 0,
    /** Copied out of `raw` so lists can filter without parsing it: tags joined by newlines, which tags never contain. */
    val tags: String = "",
    val parentId: String? = null,
)

val NoteRow.tagList get() = if (tags.isEmpty()) emptyList() else tags.split('\n')

@Entity(tableName = "notebooks")
data class NotebookRow(@PrimaryKey val id: String, val name: String, val time: Long, val raw: String)

@Entity(tableName = "tombstones")
data class TombstoneRow(@PrimaryKey val id: String, val tbl: String, val deletedAt: Long)

/** A PDF (`files`) or image (`images`) record whose bytes are stored at filesDir/blobs/<id>. */
@Entity(tableName = "attachments")
data class AttachmentRow(@PrimaryKey val id: String, val tbl: String, val time: Long, val raw: String, val savedAt: Long = 0)

@Dao
interface NotesDao {
    @Query("SELECT * FROM notes WHERE trashedAt IS NULL ORDER BY pinned DESC, updatedAt DESC")
    fun liveNotes(): Flow<List<NoteRow>>

    @Query("SELECT * FROM notes WHERE id = :id")
    fun note(id: String): Flow<NoteRow?>

    @Query("SELECT * FROM notebooks ORDER BY name COLLATE NOCASE")
    fun liveNotebooks(): Flow<List<NotebookRow>>

    @Query("SELECT * FROM notebooks WHERE id = :id")
    suspend fun notebookOnce(id: String): NotebookRow?

    @Query("SELECT * FROM notebooks WHERE time > :since")
    suspend fun notebooksSince(since: Long): List<NotebookRow>

    @Query("SELECT * FROM notes WHERE notebookId = :id")
    suspend fun notesIn(id: String): List<NoteRow>

    @Query("DELETE FROM notebooks WHERE id = :id")
    suspend fun deleteNotebookNow(id: String)

    @Query("SELECT * FROM notes WHERE trashedAt IS NOT NULL ORDER BY trashedAt DESC")
    fun liveTrash(): Flow<List<NoteRow>>

    // An empty id finds any daily note for the date.
    @Query("SELECT * FROM notes WHERE kind = 'daily' AND date = :date AND trashedAt IS NULL AND id != :id LIMIT 1")
    suspend fun liveDaily(date: String, id: String): NoteRow?

    @Query("SELECT * FROM notes")
    suspend fun allNotes(): List<NoteRow>

    @Query("SELECT * FROM notebooks")
    suspend fun allNotebooks(): List<NotebookRow>

    @Query("SELECT * FROM tombstones")
    suspend fun allTombstones(): List<TombstoneRow>

    @Query("SELECT raw FROM notes")
    suspend fun allRaw(): List<String>

    @Query("SELECT * FROM tombstones WHERE deletedAt > :since")
    suspend fun tombstonesSince(since: Long): List<TombstoneRow>

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteNoteNow(id: String)

    @Query("DELETE FROM attachments WHERE id IN (:ids)")
    suspend fun deleteAttachments(ids: List<String>)

    @Query("SELECT updatedAt FROM notes WHERE id = :id")
    suspend fun noteTime(id: String): Long?

    @Query("SELECT time FROM notebooks WHERE id = :id")
    suspend fun notebookTime(id: String): Long?

    @Query("SELECT deletedAt FROM tombstones WHERE id = :id")
    suspend fun diedAt(id: String): Long?

    @Query("SELECT * FROM notes WHERE savedAt > :since")
    suspend fun notesSince(since: Long): List<NoteRow>

    @Query("SELECT * FROM notes WHERE id = :id")
    suspend fun noteOnce(id: String): NoteRow?

    @Query("SELECT * FROM attachments")
    suspend fun attachments(): List<AttachmentRow>

    @Query("SELECT * FROM attachments WHERE tbl = 'files' ORDER BY time DESC")
    fun livePdfs(): Flow<List<AttachmentRow>>

    @Query("SELECT id FROM attachments")
    suspend fun attachmentIds(): List<String>

    @Upsert suspend fun put(row: NoteRow)
    @Upsert suspend fun put(row: NotebookRow)
    @Upsert suspend fun put(row: TombstoneRow)
    @Upsert suspend fun put(row: AttachmentRow)

    @Query("DELETE FROM notes WHERE id = :id AND updatedAt <= :deletedAt")
    suspend fun deleteNote(id: String, deletedAt: Long): Int

    @Query("DELETE FROM notebooks WHERE id = :id AND time <= :deletedAt")
    suspend fun deleteNotebook(id: String, deletedAt: Long): Int
}

@Database(entities = [NoteRow::class, NotebookRow::class, TombstoneRow::class, AttachmentRow::class], version = 3)
abstract class AppDb : RoomDatabase() {
    abstract fun dao(): NotesDao
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE notes ADD COLUMN savedAt INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE attachments ADD COLUMN savedAt INTEGER NOT NULL DEFAULT 0")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE notes ADD COLUMN parentId TEXT")
        // Filled from the stored JSON; SQLite's JSON functions are not on every Android version this app supports.
        db.query("SELECT id, raw FROM notes").use { c ->
            while (c.moveToNext()) {
                val row = noteRow(JSONObject(c.getString(1)))
                db.execSQL("UPDATE notes SET tags = ?, parentId = ? WHERE id = ?", arrayOf(row.tags, row.parentId, c.getString(0)))
            }
        }
    }
}
