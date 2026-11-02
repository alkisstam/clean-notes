/**
 * Case- and accent-insensitive matching, so "καλημερα" finds "Καλημέρα" and
 * "cafe" finds "Café". Returns the folded string plus a map from each folded
 * character back to its index in the original.
 */
export function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    for (let k = 0; k < base.length; k++) {
      folded += base[k];
      map.push(i);
    }
    i += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

export const foldQuery = (q: string) => fold(q.trim()).folded;

/** All matches as [start, end) ranges in the original text. */
export function findRanges(text: string, query: string): [number, number][] {
  const q = foldQuery(query);
  if (!q) return [];
  const { folded, map } = fold(text);
  const out: [number, number][] = [];
  let at = folded.indexOf(q);
  while (at !== -1) {
    out.push([map[at], map[at + q.length]]);
    at = folded.indexOf(q, at + q.length);
  }
  return out;
}

export const includesFolded = (text: string, query: string) => fold(text).folded.includes(foldQuery(query));

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export function snippet(text: string, query: string, radius = 48): Snippet | null {
  const [range] = findRanges(text, query);
  if (!range) return null;
  const [s, e] = range;
  const start = Math.max(0, s - radius);
  const end = Math.min(text.length, e + radius * 2);
  const clean = (t: string) => t.replace(/\s+/g, ' ');
  return {
    before: (start > 0 ? '…' : '') + clean(text.slice(start, s)),
    match: text.slice(s, e),
    after: clean(text.slice(e, end)) + (end < text.length ? '…' : ''),
  };
}
