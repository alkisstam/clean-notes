package io.cleannotes.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

// Same cases as the "tasks" block in tests/lib.test.ts.
class TasksTest {
    private fun task(id: String, text: String, checked: Boolean = false, due: String? = null, nested: JSONObject? = null): JSONObject {
        val para = JSONObject().put("type", "paragraph").put("content", if (text.isEmpty()) JSONArray() else JSONArray().put(JSONObject().put("type", "text").put("text", text)))
        return JSONObject().put("type", "taskItem")
            .put("attrs", JSONObject().put("id", id).put("checked", checked).put("due", due ?: JSONObject.NULL))
            .put("content", JSONArray().put(para).apply { if (nested != null) put(nested) })
    }
    private fun list(vararg items: JSONObject) = JSONObject().put("type", "taskList").put("content", JSONArray(items.toList()))
    private val doc = JSONObject().put("type", "doc").put("content", JSONArray().put(
        list(task("a", "Parent", false, "2026-01-01", list(task("b", "Child", true))), task("c", "")),
    ))
    private fun tasks(d: JSONObject) = extractTasks("n", "T", d)

    @Test fun extractsNestedTasksWithTheirOwnTextSkippingEmptyOnes() =
        assertEquals(listOf(Triple("a", "Parent", false), Triple("b", "Child", true)), tasks(doc).map { Triple(it.id, it.text, it.done) })

    @Test fun patchesWithoutTouchingTheOriginal() {
        val next = patchTask(doc, "b", mapOf("checked" to false))
        assertEquals(false, tasks(next)[1].done)
        assertEquals(true, tasks(doc)[1].done)
    }

    @Test fun appendsToATrailingListOrCreatesOneReplacingAnEmptyDocument() {
        val joined = appendTask(doc, "z", "New", null)
        assertEquals(1, joined.getJSONArray("content").length())
        assertEquals("New", tasks(joined).last().text)
        val empty = appendTask(JSONObject("""{"type":"doc","content":[{"type":"paragraph"}]}"""), "z", "New", null)
        assertEquals("taskList", empty.getJSONArray("content").getJSONObject(0).getString("type"))
        val trailing = appendTask(JSONObject("""{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi"}]}]}"""), "z", "New", null)
        val types = trailing.getJSONArray("content").let { a -> List(a.length()) { a.getJSONObject(it).getString("type") } }
        assertEquals(listOf("paragraph", "taskList"), types)
    }

    @Test fun groupsByDueDate() {
        fun t(id: String, done: Boolean, due: String?) = TaskRef(id, "n", "", "x", done, due)
        val g = groupTasks(listOf(t("1", false, "2026-01-01"), t("2", false, "2026-01-02"), t("3", false, "2026-01-03"), t("4", false, null), t("5", true, "2026-01-01")), "2026-01-02")
        assertEquals(listOf(listOf("1"), listOf("2"), listOf("3"), listOf("4"), listOf("5")), listOf(g.overdue, g.today, g.upcoming, g.someday, g.done).map { l -> l.map { it.id } })
    }

    @Test fun docTextSeparatesBlocks() = assertEquals(
        "a\nx.pdf",
        docText(JSONObject("""{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"pdfAttachment","attrs":{"name":"x.pdf"}}]}""")),
    )
}
