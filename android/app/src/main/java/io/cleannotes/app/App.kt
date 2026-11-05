package io.cleannotes.app

import android.app.Application
import androidx.room.Room

class App : Application() {
    val db by lazy { Room.databaseBuilder(this, AppDb::class.java, "clean-notes").build() }
    val sync by lazy { Sync(this, db) }
}
