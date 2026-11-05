package io.cleannotes.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Syncs while the app is closed. Waits for a network, so edits made offline go up once there is one. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val sync = (applicationContext as App).sync
        if (!sync.paired.value) return Result.success()
        return try {
            sync.run()
            Result.success()
        } catch (e: SyncError) {
            // A rejected token or a wrong address will not fix itself; the list shows the error on next open.
            Result.failure()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) = WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build(),
        )

        // Appended, so a change made while a sync runs is sent by the next one instead of being dropped.
        fun now(context: Context) = WorkManager.getInstance(context).enqueueUniqueWork(
            "sync-now", ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build(),
        )

        // Kept, not replaced, so the delay counts from the first change and steady typing cannot put the sync off forever.
        fun soon(context: Context) = WorkManager.getInstance(context).enqueueUniqueWork(
            "sync-soon", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>().setInitialDelay(60, TimeUnit.SECONDS).setConstraints(online).build(),
        )

        fun cancel(context: Context) = WorkManager.getInstance(context).cancelAllWork()
    }
}
