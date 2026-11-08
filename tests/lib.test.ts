import { describe, expect, it } from 'vitest';
import { addDays, dateKey, monthGrid } from '../src/lib/dates';
import { HUES, noteBg, noteShades, noteTone, PALETTES } from '../src/lib/colors';
import { docText } from '../src/lib/doc';
import { exportName, exportPage } from '../src/lib/export';
import { findRanges, includesFolded, snippet } from '../src/lib/search';
import { buildTagTree, nestNotes, normalizeTag, noteHasTag, renameTagIn } from '../src/lib/tags';
import { appendTask, extractTasks, groupTasks, patchTask } from '../src/lib/tasks';

describe('tags', () => {
  it('normalizes', () => {
    expect(normalizeTag(' #Work / Client A/ ')).toBe('work/client-a');
    expect(normalizeTag('///')).toBe('');
    expect(normalizeTag('Δουλειά/Πελάτες')).toBe('δουλειά/πελάτες');
  });
  it('counts a note once per ancestor', () => {
    const [work] = buildTagTree([['work/a', 'work/b'], ['work/a/x']]);
    expect(work.count).toBe(2);
    expect(work.children.map((c) => [c.name, c.count])).toEqual([['a', 2], ['b', 1]]);
    expect(work.children[0].children[0].path).toBe('work/a/x');
  });
  it('matches whole path segments only', () => {
    expect(noteHasTag(['work/a'], 'work')).toBe(true);
    expect(noteHasTag(['workshop'], 'work')).toBe(false);
  });
  it('renames and merges subtrees, and deletes', () => {
    expect(renameTagIn(['a/b', 'a/b/c', 'z', 'x/y'], 'a/b', 'x/y')).toEqual(['x/y', 'x/y/c', 'z']);
    expect(renameTagIn(['a/b', 'a/b/c', 'ab'], 'a/b', '')).toEqual(['ab']);
  });
});

describe('search', () => {
  it('ignores case and accents, including Greek', () => {
    expect(includesFolded('Καλημέρα κόσμε', 'καλημερα')).toBe(true);
    expect(includesFolded('Café', 'CAFE')).toBe(true);
    expect(includesFolded('Café', 'tea')).toBe(false);
  });
  it('treats final sigma like sigma, in both search paths', () => {
    expect(includesFolded('ΚΑΛΗΜΕΡΑ ΚΟΣΜΟΣ', 'κόσμος')).toBe(true);
    expect(includesFolded('ο κόσμος', 'ΚΟΣΜΟΣ')).toBe(true);
    const text = 'ΚΑΛΗΜΕΡΑ ΚΟΣΜΟΣ';
    expect(findRanges(text, 'κόσμος').map(([s, e]) => text.slice(s, e))).toEqual(['ΚΟΣΜΟΣ']);
  });
  it('maps ranges back to the original text', () => {
    const text = 'Το Café και το café';
    expect(findRanges(text, 'cafe').map(([s, e]) => text.slice(s, e))).toEqual(['Café', 'café']);
    const decomposed = 'Café ok';
    const [[s, e]] = findRanges(decomposed, 'ok');
    expect(decomposed.slice(s, e)).toBe('ok');
  });
  it('builds a snippet', () => {
    expect(snippet('one two three', 'TWO')).toEqual({ before: 'one ', match: 'two', after: ' three' });
    expect(snippet('one', 'x')).toBeNull();
    expect(findRanges('abc', '   ')).toEqual([]);
  });
});

describe('dates', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('builds whole-week month grids', () => {
    const g = monthGrid(2026, 10, 1); // November 2026 starts on a Sunday
    expect(g[0]).toBe('2026-10-26');
    expect(g[6]).toBe('2026-11-01');
    expect(g.length % 7).toBe(0);
    expect(g).toContain('2026-11-30');
  });
});

describe('tasks', () => {
  const task = (id: string, text: string, checked = false, due: string | null = null, nested?: object) => ({
    type: 'taskItem',
    attrs: { id, checked, due },
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }, ...(nested ? [nested] : [])],
  });
  const doc = {
    type: 'doc',
    content: [{ type: 'taskList', content: [
      task('a', 'Parent', false, '2026-01-01', { type: 'taskList', content: [task('b', 'Child', true)] }),
      task('c', ''),
    ] }],
  };
  const note = { id: 'n', title: 'T', content: doc };

  it('extracts nested tasks with their own text, skipping empty ones', () => {
    expect(extractTasks(note).map((t) => [t.id, t.text, t.done])).toEqual([['a', 'Parent', false], ['b', 'Child', true]]);
  });
  it('patches without touching the original', () => {
    const next = patchTask(doc, 'b', { checked: false });
    expect(extractTasks({ ...note, content: next })[1].done).toBe(false);
    expect(extractTasks(note)[1].done).toBe(true);
  });
  it('appends to a trailing list or creates one, replacing an empty document', () => {
    const joined = appendTask(doc, 'z', 'New', null);
    expect(joined.content).toHaveLength(1);
    expect(extractTasks({ ...note, content: joined }).at(-1)?.text).toBe('New');
    const empty = appendTask({ type: 'doc', content: [{ type: 'paragraph' }] }, 'z', 'New', null);
    expect(empty.content?.[0].type).toBe('taskList');
    const trailing = appendTask({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] }, 'z', 'New', null);
    expect(trailing.content?.map((n) => n.type)).toEqual(['paragraph', 'taskList']);
  });
  it('groups by due date', () => {
    const base = { noteId: 'n', noteTitle: '', text: 'x' };
    const g = groupTasks([
      { ...base, id: '1', done: false, due: '2026-01-01' },
      { ...base, id: '2', done: false, due: '2026-01-02' },
      { ...base, id: '3', done: false, due: '2026-01-03' },
      { ...base, id: '4', done: false, due: null },
      { ...base, id: '5', done: true, due: '2026-01-01' },
    ], '2026-01-02');
    expect([g.overdue, g.today, g.upcoming, g.someday, g.done].map((l) => l.map((t) => t.id))).toEqual([['1'], ['2'], ['3'], ['4'], ['5']]);
  });
  it('docText separates blocks', () => {
    expect(docText({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'pdfAttachment', attrs: { name: 'x.pdf' } },
    ] })).toBe('a\nx.pdf');
  });
});

describe('nestNotes', () => {
  const n = (id: string, parentId?: string) => ({ id, parentId });
  const shape = (rows: ReturnType<typeof nestNotes>) => rows.map((r) => `${r.note.id}:${r.depth}${r.hasKids ? '+' : ''}`);
  const list = [n('c', 'a'), n('a'), n('b'), n('d', 'c'), n('e', 'a'), n('x', 'gone')];
  it('nests under parents and keeps the sort order', () => {
    expect(shape(nestNotes(list, []))).toEqual(['a:0+', 'c:1+', 'd:2', 'e:1', 'b:0', 'x:0']);
  });
  it('hides the whole subtree of a collapsed note', () => {
    expect(shape(nestNotes(list, ['a']))).toEqual(['a:0+', 'b:0', 'x:0']);
    expect(shape(nestNotes(list, ['c']))).toEqual(['a:0+', 'c:1+', 'e:1', 'b:0', 'x:0']);
  });
  it('shows notes caught in a parent loop', () => {
    expect(shape(nestNotes([n('p', 'q'), n('q', 'p'), n('s', 's')], []))).toEqual(['s:0', 'p:0', 'q:0']);
  });
});

describe('note colors', () => {
  it('groups every hue into a tone', () => {
    const tones = Object.fromEntries(HUES.map((h) => [h.id, noteTone(`soft-${h.id}`)]));
    expect(tones).toEqual({
      rose: 'warm', red: 'warm', orange: 'warm', amber: 'warm', gray: 'warm',
      lime: 'green', green: 'green', teal: 'green',
      cyan: 'cool', blue: 'cool', indigo: 'cool', violet: 'cool',
    });
    expect(noteTone(null)).toBeUndefined();
  });

  const luminance = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const channel = (n: number) => {
      const k = (n + h / 30) % 12;
      const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
  };
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const DAY_INK = 0.0131;
  const NIGHT_INK = 0.8;

  it('keeps every shade readable under its theme ink', () => {
    for (const p of PALETTES) {
      for (const h of HUES) {
        const shades = noteShades(`${p.id}-${h.id}`)!;
        expect(contrast(luminance(...shades.light), DAY_INK), `${p.id}-${h.id} light`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(luminance(...shades.dark), NIGHT_INK), `${p.id}-${h.id} dark`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('ignores unknown ids', () => {
    expect(noteBg('soft-nope')).toBeUndefined();
    expect(noteBg('nope-rose')).toBeUndefined();
    expect(noteBg(null)).toBeUndefined();
    expect(noteBg('soft-rose')).toContain('light-dark(');
  });
});

describe('export', () => {
  it('escapes the title in the page', () => {
    const page = exportPage('<img src=x onerror=alert(1)>', '<p>body</p>');
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x');
    expect(page).toContain('<p>body</p>');
  });
  it('strips characters files cannot have', () => {
    expect(exportName('a/b:c?', 'pdf')).toBe('abc.pdf');
    expect(exportName(' / ', 'txt')).toBe('Untitled.txt');
  });
});
