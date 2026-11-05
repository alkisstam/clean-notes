package io.cleannotes.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MergeTest {
    @Test fun newRowIsAccepted() = assertTrue(accepts(10, null, null))
    @Test fun newerEditWins() = assertTrue(accepts(20, 10, null))
    @Test fun olderOrEqualEditLoses() {
        assertFalse(accepts(10, 20, null))
        assertFalse(accepts(10, 10, null))
    }
    @Test fun deleteAfterEditWins() {
        assertFalse(accepts(10, null, 15))
        assertFalse(accepts(10, null, 10))
    }
    @Test fun editAfterDeleteRevives() = assertTrue(accepts(20, null, 15))
}
