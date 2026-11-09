package io.cleannotes.app

import org.json.JSONArray
import org.json.JSONObject

// Ports of src/lib/doc.ts and src/lib/tasks.ts over the editor's JSON documents.

data class TaskRef(val id: String, val noteId: String, val noteTitle: String, val text: String, val done: Boolean, val due: String?)

private fun JSONObject.text(key: String) = if (isNull(key)) "" else optString(key)

private fun JSONObject.children() = optJSONArray("content")?.let { a -> List(a.length()) { a.optJSONObject(it) }.filterNotNull() }.orEmpty()

fun walkDoc(node: JSONObject, visit: (JSONObject) -> Unit) {
    visit(node)
    node.children().forEach { walkDoc(it, visit) }
}

private val blocks = setOf("paragraph", "heading", "codeBlock", "tableCell", "tableHeader", "pdfAttachment", "noteImage")

/** Plain text of a document. Blocks are separated by newlines. */
fun docText(node: JSONObject?): String {
    val out = StringBuilder()
    fun walk(n: JSONObject) {
        when (n.optString("type")) {
            "text" -> out.append(n.text("text"))
            "hardBreak" -> out.append(' ')
            "pdfAttachment" -> out.append(n.optJSONObject("attrs")?.text("name").orEmpty())
            "noteImage" -> out.append(n.optJSONObject("attrs")?.text("alt").orEmpty())
        }
        n.children().forEach(::walk)
        if (n.optString("type") in blocks) out.append('\n')
    }
    node?.let(::walk)
    return out.toString().replace(Regex("\n{2,}"), "\n").trim()
}

/** Text of a node's own inline content, leaving nested blocks out. */
fun ownText(node: JSONObject) = node.children().find { it.optString("type") == "paragraph" }?.let(::docText).orEmpty()

fun extractTasks(noteId: String, noteTitle: String, content: JSONObject): List<TaskRef> {
    val tasks = mutableListOf<TaskRef>()
    walkDoc(content) { n ->
        val attrs = n.optJSONObject("attrs")
        val id = attrs?.text("id").orEmpty()
        if (n.optString("type") != "taskItem" || id.isEmpty()) return@walkDoc
        val text = ownText(n).trim()
        if (text.isEmpty()) return@walkDoc
        tasks += TaskRef(id, noteId, noteTitle, text, attrs!!.optBoolean("checked"), attrs.text("due").ifEmpty { null })
    }
    return tasks
}

/** A copy of the document with one task's attributes changed; a null value clears the attribute. */
fun patchTask(doc: JSONObject, id: String, attrs: Map<String, Any?>): JSONObject {
    val copy = JSONObject(doc.toString())
    walkDoc(copy) { n ->
        val a = n.optJSONObject("attrs")
        if (n.optString("type") == "taskItem" && a?.text("id") == id) attrs.forEach { (k, v) -> a.put(k, v ?: JSONObject.NULL) }
    }
    return copy
}

fun appendTask(doc: JSONObject, id: String, text: String, due: String?): JSONObject {
    val copy = JSONObject(doc.toString())
    val item = JSONObject()
        .put("type", "taskItem")
        .put("attrs", JSONObject().put("id", id).put("checked", false).put("due", due ?: JSONObject.NULL))
        .put("content", JSONArray().put(JSONObject().put("type", "paragraph").put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text)))))
    val content = copy.children().toMutableList()
    // Join the last task list if the document ends with one.
    var idx = content.size - 1
    val lastIsEmpty = content.getOrNull(idx)?.let { it.optString("type") == "paragraph" && it.children().isEmpty() } == true
    if (lastIsEmpty) idx--
    val last = content.getOrNull(idx)
    if (last?.optString("type") == "taskList") {
        last.put("content", JSONArray(last.children() + item))
    } else {
        if (idx < 0) content.clear()
        content.add(idx + 1, JSONObject().put("type", "taskList").put("content", JSONArray().put(item)))
    }
    return copy.put("content", JSONArray(content))
}

data class TaskGroups(
    val overdue: List<TaskRef>,
    val today: List<TaskRef>,
    val upcoming: List<TaskRef>,
    val someday: List<TaskRef>,
    val done: List<TaskRef>,
)

fun groupTasks(tasks: List<TaskRef>, today: String): TaskGroups {
    val open = tasks.filter { !it.done }
    return TaskGroups(
        overdue = open.filter { it.due != null && it.due < today }.sortedBy { it.due },
        today = open.filter { it.due == today },
        upcoming = open.filter { it.due != null && it.due > today }.sortedBy { it.due },
        someday = open.filter { it.due == null },
        done = tasks.filter { it.done },
    )
}

/** Port of duplicateNote(): copies are separate tasks, so they get ids of their own. */
fun duplicated(src: JSONObject, id: String, now: Long, uid: () -> String): JSONObject {
    val content = JSONObject(src.getJSONObject("content").toString())
    walkDoc(content) { n -> if (n.optString("type") == "taskItem") n.getJSONObject("attrs").put("id", uid()) }
    val title = src.text("title")
    return JSONObject()
        .put("id", id)
        .put("title", if (title.isNotEmpty()) "$title copy" else "")
        .put("content", content)
        .put("text", docText(content))
        .put("notebookId", src.opt("notebookId") ?: JSONObject.NULL)
        .put("tags", src.optJSONArray("tags") ?: JSONArray())
        .put("kind", "note")
        .put("pinned", false)
        .put("createdAt", now)
        .put("updatedAt", now)
        .put("trashedAt", JSONObject.NULL)
        .apply {
            if (!src.isNull("parentId")) put("parentId", src.getString("parentId"))
            if (!src.isNull("color")) put("color", src.getString("color"))
        }
}
