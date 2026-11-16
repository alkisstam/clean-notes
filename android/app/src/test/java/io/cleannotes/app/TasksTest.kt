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

    @Test fun checksEveryTaskIncludingNestedOnes() {
        assertEquals(listOf(true, true), tasks(checkAllTasks(doc, true)).map { it.done })
        assertEquals(listOf(false, false), tasks(checkAllTasks(doc, false)).map { it.done })
        assertEquals(listOf(false, true), tasks(doc).map { it.done })
    }

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

    @Test fun duplicateGetsNewTaskIdsAndResets() {
        val src = JSONObject().put("title", "A").put("content", doc).put("notebookId", "nb").put("tags", JSONArray().put("x")).put("pinned", true).put("parentId", JSONObject.NULL).put("color", "soft-rose")
        var n = 0
        val copy = duplicated(src, "new", 5L) { "t${n++}" }
        assertEquals("A copy", copy.getString("title"))
        assertEquals(listOf("t0", "t1"), tasksOf(copy).map { it.id })
        assertEquals(3, n)
        assertEquals("a", tasks(doc)[0].id)
        assertEquals(false, copy.getBoolean("pinned"))
        assertEquals("soft-rose", copy.getString("color"))
        assertEquals(false, copy.has("parentId"))
    }
    private fun tasksOf(n: JSONObject) = tasks(n.getJSONObject("content"))

    @Test fun readsAndWritesReminders() {
        val added = appendTask(doc, "z", "Call", "2026-11-12", "09:30")
        assertEquals("09:30", tasks(added).last().remind)
        assertEquals(null, tasks(doc).first().remind)
    }

    @Test fun nextReminderIsTheEarliestOpenOneAfterTheGivenTime() {
        val utc = java.time.ZoneOffset.UTC
        val at = { d: String, t: String -> java.time.LocalDateTime.parse("${d}T$t").toInstant(utc).toEpochMilli() }
        var content = doc
        content = appendTask(content, "late", "Late", "2026-11-12", "10:00")
        content = appendTask(content, "soon", "Soon", "2026-11-12", "09:00")
        content = appendTask(content, "past", "Past", "2026-11-11", "09:00")
        content = appendTask(content, "notime", "No time", "2026-11-12")
        content = patchTask(appendTask(content, "done", "Done", "2026-11-12", "08:00"), "done", mapOf("checked" to true))
        val note = JSONObject().put("id", "n").put("title", "").put("content", content)
        val due = reminders(note, utc)
        assertEquals(listOf("late", "soon", "past"), due.map { it.key })
        assertEquals("Untitled", due.first().text)
        assertEquals(at("2026-11-12", "09:00"), nextReminder(due, at("2026-11-12", "07:00")))
        assertEquals(null, nextReminder(due, at("2026-11-12", "10:00")))
    }

    @Test fun aNoteHasItsOwnReminder() {
        val utc = java.time.ZoneOffset.UTC
        val note = JSONObject().put("id", "n").put("title", "Rent").put("content", doc).put("remindAt", "2026-11-20T18:30")
        val own = reminders(note, utc).single()
        assertEquals(Due("n", "n", "Rent", "Reminder", java.time.LocalDateTime.parse("2026-11-20T18:30").toInstant(utc).toEpochMilli()), own)
        assertEquals(emptyList<Due>(), reminders(note.put("remindAt", JSONObject.NULL), utc))
        assertEquals(null, noteRemindAt(JSONObject()))
    }

    private fun dt(s: String) = java.time.LocalDateTime.parse(s)

    @Test fun repeatsCountFromTheFirstTimeAndCatchUp() {
        assertEquals(dt("2026-02-28T09:00"), nextRepeat(dt("2026-01-31T09:00"), "monthly", dt("2026-02-01T00:00")))
        assertEquals(dt("2026-03-31T09:00"), nextRepeat(dt("2026-01-31T09:00"), "monthly", dt("2026-03-01T00:00")))
        assertEquals(dt("2026-02-28T08:00"), nextRepeat(dt("2024-02-29T08:00"), "yearly", dt("2026-01-01T00:00")))
        assertEquals(dt("2028-02-29T08:00"), nextRepeat(dt("2024-02-29T08:00"), "yearly", dt("2027-03-01T00:00")))
        assertEquals(dt("2026-11-20T18:30"), nextRepeat(dt("2026-11-10T18:30"), "daily", dt("2026-11-20T10:00")))
        assertEquals(dt("2026-11-24T18:30"), nextRepeat(dt("2026-11-10T18:30"), "weekly", dt("2026-11-17T18:30")))
    }

    @Test fun groupsRemindersByDayAndDoneWithFavoritesFirst() {
        fun row(id: String, raw: JSONObject) = noteRow(raw.put("id", id).put("title", id).put("content", JSONObject().put("type", "doc")).put("kind", "reminder")
            .put("pinned", false).put("updatedAt", 1).put("trashedAt", JSONObject.NULL).put("notebookId", JSONObject.NULL).put("tags", JSONArray()))
        val notes = listOf(
            row("late", JSONObject().put("remindAt", "2026-11-15T09:00")),
            row("fav", JSONObject().put("remindAt", "2026-11-16T20:00").put("favorite", true)),
            row("later", JSONObject().put("remindAt", "2026-11-18T09:00")),
            row("done", JSONObject().put("remindAt", "2026-11-16T07:00").put("doneAt", 5)),
            row("none", JSONObject()),
        )
        val g = groupReminders(reminderItems(notes), java.time.LocalDate.parse("2026-11-16"))
        assertEquals(listOf("fav", "late"), g.today.map { it.noteId })
        assertEquals(listOf("later"), g.scheduled.map { it.noteId })
        assertEquals(listOf("done"), g.completed.map { it.noteId })
    }

    @Test fun aDoneNoteReminderNoLongerFires() {
        val note = JSONObject().put("id", "n").put("title", "Rent").put("content", doc).put("remindAt", "2026-11-20T18:30").put("doneAt", 1)
        assertEquals(emptyList<Due>(), reminders(note, java.time.ZoneOffset.UTC).filter { it.key == "n" })
    }
}
