package io.cleannotes.app

// Port of src/lib/tags.ts. Tags are paths like "work/client-a"; a note tagged "work/a" also counts under "work".

class TagNode(val name: String, val path: String) {
    /** Notes tagged with this tag or any tag below it. */
    var count = 0
    val children = mutableListOf<TagNode>()
}

// \p{Z} catches Unicode spaces; Android's regex engine rejects the (?U) flag a desktop JVM allows.
private val spaces = Regex("[\\s\\p{Z}]+")

/** "#Work / Client A/" becomes "work/client-a". Returns "" if nothing is left. */
fun normalizeTag(raw: String): String =
    raw.trim().trimStart('#').split('/')
        .map { it.trim().lowercase().replace(spaces, "-").replace(Regex("[#,]"), "") }
        .filter { it.isNotEmpty() }
        .joinToString("/")

fun tagMatches(tag: String, path: String) = tag == path || tag.startsWith("$path/")

fun noteHasTag(tags: List<String>, path: String) = tags.any { tagMatches(it, path) }

fun buildTagTree(noteTags: List<List<String>>): List<TagNode> {
    val root = TagNode("", "")
    for (tags in noteTags) {
        val seen = mutableSetOf<TagNode>()
        for (tag in tags) {
            var node = root
            var path = ""
            for (part in tag.split('/')) {
                path = if (path.isEmpty()) part else "$path/$part"
                val child = node.children.find { it.name == part } ?: TagNode(part, path).also { node.children += it }
                seen += child
                node = child
            }
        }
        seen.forEach { it.count++ }
    }
    fun sort(nodes: MutableList<TagNode>) {
        nodes.sortBy { it.name }
        nodes.forEach { sort(it.children) }
    }
    sort(root.children)
    return root.children
}

/** Every tag and every ancestor, for autocomplete. */
fun allTagPaths(noteTags: List<List<String>>): List<String> =
    noteTags.flatten().flatMap { tag ->
        val parts = tag.split('/')
        (1..parts.size).map { parts.take(it).joinToString("/") }
    }.toSortedSet().toList()

/** Moves a tag and its subtree. An empty `to` deletes them. Duplicates collapse. */
fun renameTagIn(tags: List<String>, from: String, to: String): List<String> =
    tags.flatMap { t ->
        when {
            !tagMatches(t, from) -> listOf(t)
            to.isEmpty() -> emptyList()
            else -> listOf(to + t.substring(from.length))
        }
    }.distinct()
