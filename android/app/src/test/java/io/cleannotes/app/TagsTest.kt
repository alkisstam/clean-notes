package io.cleannotes.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Same cases as the "tags" block in tests/lib.test.ts.
class TagsTest {
    @Test fun normalizes() {
        assertEquals("work/client-a", normalizeTag(" #Work / Client A/ "))
        assertEquals("", normalizeTag("///"))
        assertEquals("δουλειά/πελάτες", normalizeTag("Δουλειά/Πελάτες"))
    }

    @Test fun countsANoteOncePerAncestor() {
        val (work) = buildTagTree(listOf(listOf("work/a", "work/b"), listOf("work/a/x")))
        assertEquals(2, work.count)
        assertEquals(listOf("a" to 2, "b" to 1), work.children.map { it.name to it.count })
        assertEquals("work/a/x", work.children[0].children[0].path)
    }

    @Test fun matchesWholePathSegmentsOnly() {
        assertTrue(noteHasTag(listOf("work/a"), "work"))
        assertFalse(noteHasTag(listOf("workshop"), "work"))
    }

    @Test fun renamesAndMergesSubtreesAndDeletes() {
        assertEquals(listOf("x/y", "x/y/c", "z"), renameTagIn(listOf("a/b", "a/b/c", "z", "x/y"), "a/b", "x/y"))
        assertEquals(listOf("ab"), renameTagIn(listOf("a/b", "a/b/c", "ab"), "a/b", ""))
    }

    @Test fun listsEveryAncestorForAutocomplete() {
        assertEquals(listOf("a", "a/b", "a/b/c", "z"), allTagPaths(listOf(listOf("a/b/c"), listOf("z", "a/b"))))
    }
}
