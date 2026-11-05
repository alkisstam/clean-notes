package io.cleannotes.app

import org.junit.Assert.assertEquals
import org.junit.Test

// Same cases as the "nestNotes" block in tests/lib.test.ts.
class NestTest {
    private val list = listOf("c" to "a", "a" to null, "b" to null, "d" to "c", "e" to "a", "x" to "gone")
    private fun shape(sorted: List<Pair<String, String?>>, collapsed: Set<String>) =
        nestNotes(sorted, collapsed, { it.first }, { it.second }).map { "${it.note.first}:${it.depth}${if (it.hasKids) "+" else ""}" }

    @Test fun nestsUnderParentsAndKeepsTheSortOrder() =
        assertEquals(listOf("a:0+", "c:1+", "d:2", "e:1", "b:0", "x:0"), shape(list, emptySet()))

    @Test fun hidesTheWholeSubtreeOfACollapsedNote() {
        assertEquals(listOf("a:0+", "b:0", "x:0"), shape(list, setOf("a")))
        assertEquals(listOf("a:0+", "c:1+", "e:1", "b:0", "x:0"), shape(list, setOf("c")))
    }

    @Test fun showsNotesCaughtInAParentLoop() =
        assertEquals(listOf("s:0", "p:0", "q:0"), shape(listOf("p" to "q", "q" to "p", "s" to "s"), emptySet()))
}
