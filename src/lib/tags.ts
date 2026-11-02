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
