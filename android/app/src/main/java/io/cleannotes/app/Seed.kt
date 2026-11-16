package io.cleannotes.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// Same ids and edit time as src/lib/seed.ts, so a paired phone and the web keep one copy and any real edit or delete wins a sync.
const val SEED_TIME = 1767225600000L // Date.UTC(2026, 0, 1)
const val SEED_NOTEBOOK = "getting-started"

private fun t(text: String, vararg marks: String) = JSONObject().put("type", "text").put("text", text).apply {
    if (marks.isNotEmpty()) put("marks", JSONArray(marks.map { JSONObject().put("type", it) }))
}
private fun node(type: String, vararg content: JSONObject) = JSONObject().put("type", type).put("content", JSONArray(content.toList()))
private fun p(vararg content: JSONObject) = node("paragraph", *content)
private fun h(text: String) = node("heading", t(text)).put("attrs", JSONObject().put("level", 2))
private fun bullet(vararg content: JSONObject) = node("listItem", p(*content))
private fun task(text: String, due: String? = null) = node("taskItem", p(t(text)))
    .put("attrs", JSONObject().put("id", UUID.randomUUID().toString()).put("checked", false).put("due", due ?: JSONObject.NULL))

fun welcomeNote(today: String = dateKey()): JSONObject {
    val content = node(
        "doc",
        p(t("Everything here is stored on this phone and works offline. Delete this note whenever you like.")),
        h("Write"),
        p(t("Type "), t("/", "code"), t(" on an empty line for headings, lists, to-dos, tables, code, images and PDFs. Select text to format it.")),
        h("Organise"),
        node(
            "bulletList",
            bullet(t("Notebooks", "bold"), t(" hold notes. Use Move to notebook in a note's menu.")),
            bullet(t("Tags", "bold"), t(" nest with a slash: "), t("work/clients/acme", "code"), t(" appears under work and clients.")),
            bullet(t("Today", "bold"), t(" opens the daily note for the date.")),
            bullet(t("Sub-notes", "bold"), t(" sit under a parent note. Use New sub-note in a note's menu.")),
            bullet(t("Background color", "bold"), t(" is in the menu at the top of a note.")),
            bullet(t("Select", "bold"), t(" in the list menu picks several notes at once, to share, export or move them together.")),
        ),
        h("Get things done"),
        p(t("To-dos in any note also appear in Tasks, grouped by due date. Tap a to-do's date to change it or add a reminder.")),
        node(
            "taskList",
            task("Tick this one off", today),
            task("Attach a PDF: type /pdf in a note", addDays(today, 1)),
            task("Connect a sync server in Settings to use your notes on other devices"),
        ),
        h("Keep it safe"),
        p(t("Notes live on this phone, so export a backup from Settings now and then.")),
    )
    return JSONObject()
        .put("id", "welcome")
        .put("title", "Welcome to Sheaf Notes")
        .put("content", content)
        .put("text", docText(content))
        .put("notebookId", SEED_NOTEBOOK)
        .put("tags", JSONArray(listOf("guide/basics")))
        .put("kind", "note")
        .put("pinned", true)
        .put("createdAt", System.currentTimeMillis())
        .put("updatedAt", SEED_TIME)
        .put("trashedAt", JSONObject.NULL)
}
