package io.cleannotes.app

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

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
)

@Entity(tableName = "notebooks")
data class NotebookRow(@PrimaryKey val id: String, val name: String, val time: Long, val raw: String)

@Entity(tableName = "tombstones")
data class TombstoneRow(@PrimaryKey val id: String, val tbl: String, val deletedAt: Long)

/** A PDF (`files`) or image (`images`) record whose bytes are stored at filesDir/blobs/<id>. */
@Entity(tableName = "attachments")
data class AttachmentRow(@PrimaryKey val id: String, val tbl: String, val time: Long, val raw: String)

@Dao
interface NotesDao {
    @Query("SELECT * FROM notes WHERE trashedAt IS NULL AND archivedAt IS NULL ORDER BY pinned DESC, updatedAt DESC")
    fun liveNotes(): Flow<List<NoteRow>>

    @Query("SELECT * FROM notes WHERE id = :id")
    fun note(id: String): Flow<NoteRow?>

    @Query("SELECT updatedAt FROM notes WHERE id = :id")
    suspend fun noteTime(id: String): Long?

    @Query("SELECT time FROM notebooks WHERE id = :id")
    suspend fun notebookTime(id: String): Long?

    @Query("SELECT deletedAt FROM tombstones WHERE id = :id")
    suspend fun diedAt(id: String): Long?

    @Query("SELECT * FROM attachments")
    suspend fun attachments(): List<AttachmentRow>

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

@Database(entities = [NoteRow::class, NotebookRow::class, TombstoneRow::class, AttachmentRow::class], version = 1)
abstract class AppDb : RoomDatabase() {
    abstract fun dao(): NotesDao
}
