package io.cleannotes.app

import java.text.Normalizer

// Port of src/lib/search.ts: case- and accent-insensitive matching, so "καλημερα" finds "Καλημέρα" and "cafe" finds "Café".

private val marks = Regex("\\p{M}")
private val spaces = Regex("[\\s\\p{Z}]+")

private fun foldChar(s: String) = Normalizer.normalize(s, Normalizer.Form.NFD).replace(marks, "").lowercase().replace('ς', 'σ')

/** The folded text plus, for each folded character, its index in the original. */
fun fold(text: String): Pair<String, IntArray> {
    val folded = StringBuilder()
    val map = ArrayList<Int>()
    var i = 0
    while (i < text.length) {
        val n = Character.charCount(text.codePointAt(i))
        // Final sigma: "ΚΟΣΜΟΣ" lowercases letter by letter to σ, but people type ς.
        val base = foldChar(text.substring(i, i + n))
        folded.append(base)
        repeat(base.length) { map += i }
        i += n
    }
    map += text.length
    return folded.toString() to map.toIntArray()
}

fun foldQuery(q: String) = fold(q.trim()).first

/** All matches as [start, end) ranges in the original text. */
fun findRanges(text: String, query: String): List<IntRange> {
    val q = foldQuery(query)
    if (q.isEmpty()) return emptyList()
    val (folded, map) = fold(text)
    val out = mutableListOf<IntRange>()
    var at = folded.indexOf(q)
    while (at != -1) {
        out += map[at] until map[at + q.length]
        at = folded.indexOf(q, at + q.length)
    }
    return out
}

/** Same result as fold(text).first without the position map, and much faster. */
fun includesFolded(text: String, query: String) = foldChar(text).contains(foldQuery(query))

data class Snippet(val before: String, val match: String, val after: String)

fun snippet(text: String, query: String, radius: Int = 48): Snippet? {
    val range = findRanges(text, query).firstOrNull() ?: return null
    val s = range.first
    val e = range.last + 1
    val start = maxOf(0, s - radius)
    val end = minOf(text.length, e + radius * 2)
    fun clean(t: String) = t.replace(spaces, " ")
    return Snippet(
        (if (start > 0) "…" else "") + clean(text.substring(start, s)),
        text.substring(s, e),
        clean(text.substring(e, end)) + if (end < text.length) "…" else "",
    )
}
