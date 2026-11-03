export interface TagNode {
  name: string;
  path: string;
  /** Notes tagged with this tag or any tag below it. */
  count: number;
  children: TagNode[];
}

/** "#Work / Client A/" becomes "work/client-a". Returns '' if nothing is left. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .split('/')
    .map((part) => part.trim().toLocaleLowerCase().replace(/\s+/g, '-').replace(/[#,]/g, ''))
    .filter(Boolean)
    .join('/');
}

export const tagMatches = (tag: string, path: string) => tag === path || tag.startsWith(path + '/');

export const noteHasTag = (tags: string[], path: string) => tags.some((t) => tagMatches(t, path));

export function buildTagTree(noteTags: string[][]): TagNode[] {
  const root: TagNode = { name: '', path: '', count: 0, children: [] };
  for (const tags of noteTags) {
    const seen = new Set<TagNode>();
    for (const tag of tags) {
      let node = root;
      let path = '';
      for (const part of tag.split('/')) {
        path = path ? `${path}/${part}` : part;
        let child = node.children.find((c) => c.name === part);
        if (!child) {
          child = { name: part, path, count: 0, children: [] };
          node.children.push(child);
        }
        seen.add(child);
        node = child;
      }
    }
    seen.forEach((n) => n.count++);
  }
  const sort = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

/**
 * Orders an already sorted list as a tree of sub-notes, keeping the sort within each sibling group.
 * A note whose parent is not in the list (trashed, deleted, other notebook) shows at the top level.
 */
export function nestNotes<T extends { id: string; parentId?: string | null }>(sorted: T[], collapsed: string[]) {
  const ids = new Set(sorted.map((n) => n.id));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const n of sorted) {
    if (n.parentId && n.parentId !== n.id && ids.has(n.parentId)) {
      const list = kids.get(n.parentId) ?? [];
      list.push(n);
      kids.set(n.parentId, list);
    } else roots.push(n);
  }
  const out: { note: T; depth: number; hasKids: boolean }[] = [];
  const reached = new Set<string>();
  const walk = (list: T[], depth: number, hidden: boolean) => {
    for (const note of list) {
      reached.add(note.id);
      const children = kids.get(note.id);
      if (!hidden) out.push({ note, depth, hasKids: Boolean(children) });
      if (children) walk(children, depth + 1, hidden || collapsed.includes(note.id));
    }
  };
  walk(roots, 0, false);
  // A parent loop (only possible from bad synced or imported data) would otherwise hide those notes.
  for (const n of sorted) if (!reached.has(n.id)) out.push({ note: n, depth: 0, hasKids: false });
  return out;
}

/** Every tag and every ancestor, for autocomplete. */
export function allTagPaths(noteTags: string[][]): string[] {
  const set = new Set<string>();
  for (const tags of noteTags) {
    for (const tag of tags) {
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Moves a tag and its subtree. An empty `to` deletes them. Duplicates collapse. */
export function renameTagIn(tags: string[], from: string, to: string): string[] {
  const out = tags.flatMap((t) => {
    if (!tagMatches(t, from)) return [t];
    if (!to) return [];
    return [to + t.slice(from.length)];
  });
  return [...new Set(out)];
}
