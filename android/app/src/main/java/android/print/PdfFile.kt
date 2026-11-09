package android.print

import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

/** The print callbacks' constructors are package-private, so writing a print job straight to a file has to happen from this package. */
object PdfFile {
    fun write(adapter: PrintDocumentAdapter, file: File, attributes: PrintAttributes, done: (Boolean) -> Unit) {
        adapter.onLayout(null, attributes, null, object : PrintDocumentAdapter.LayoutResultCallback() {
            override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
                val output = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_READ_WRITE)
                adapter.onWrite(arrayOf(PageRange.ALL_PAGES), output, CancellationSignal(), object : PrintDocumentAdapter.WriteResultCallback() {
                    override fun onWriteFinished(pages: Array<out PageRange>) {
                        output.close()
                        adapter.onFinish()
                        done(true)
                    }

                    override fun onWriteFailed(error: CharSequence?) {
                        output.close()
                        adapter.onFinish()
                        done(false)
                    }
                })
            }

            override fun onLayoutFailed(error: CharSequence?) = done(false)
        }, null)
    }
}
