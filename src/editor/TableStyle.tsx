import { Extension, type Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Strikethrough, Type, Underline } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HUES, noteBg } from '../lib/colors';

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];
/** Marks a live preview transaction, which must not be saved or added to history. */
export const PREVIEW = 'tableStylePreview';

const FILLS = ['soft-amber', 'soft-orange', 'soft-rose', 'soft-violet', 'soft-blue', 'soft-green'];
const INKS = FILLS.map((f) => f.slice('soft-'.length));
const BORDERS = ['rounded', 'grid', 'lines', 'outer', 'none'];
const ALIGNS = ['left', 'center', 'right'];
const HEX = /^#[0-9a-f]{6}$/i;
const FLAGS = ['bold', 'italic', 'underline', 'strike', 'header', 'firstCol'] as const;
const TEXT_KEYS = ['size', 'bold', 'italic', 'underline', 'strike', 'ink', 'align'] as const;

export type TableLook = {
  fill?: string; size?: string; ink?: string; align?: string; borders?: string;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; header?: boolean; firstCol?: boolean;
};

type Target = { pos: number; attr: 'tableStyle' | 'cellStyle'; original: TableLook | null };

export type Styling = { kind: 'table' | 'cell'; table: TableLook | null; targets: Target[] };

// These values end up in a style attribute, and arrive from synced notes and pasted HTML.
export function sanitizeStyle(raw: unknown): TableLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const isIn = (list: string[], v: unknown): v is string => typeof v === 'string' && list.includes(v);
  const isColor = (list: string[], v: unknown): v is string => isIn(list, v) || (typeof v === 'string' && HEX.test(v));
  const out: TableLook = {};
  if (isColor(FILLS, r.fill)) out.fill = r.fill;
  if (isColor(INKS, r.ink)) out.ink = r.ink;
  if (isIn(FONT_SIZES, r.size)) out.size = r.size;
  if (isIn(ALIGNS, r.align)) out.align = r.align;
  if (isIn(BORDERS, r.borders)) out.borders = r.borders;
  for (const flag of FLAGS) if (typeof r[flag] === 'boolean') out[flag] = r[flag];
  return Object.keys(out).length ? out : null;
}

const fillCss = (fill: string) =>
  fill.startsWith('#') ? `light-dark(${fill}, color-mix(in srgb, ${fill} 35%, #1c1a17))` : noteBg(fill)!;

const inkCss = (ink: string) => {
  if (ink.startsWith('#')) return `light-dark(${ink}, color-mix(in srgb, ${ink} 55%, white))`;
  const h = HUES.find((hue) => hue.id === ink)!.h;
  return `light-dark(hsl(${h} 70% 32%), hsl(${h} 75% 78%))`;
};

const textCss = (look: TableLook) => [
  look.size && `font-size:${look.size}`,
  look.bold !== undefined && `font-weight:${look.bold ? 700 : 400}`,
  look.italic !== undefined && `font-style:${look.italic ? 'italic' : 'normal'}`,
  look.ink && `color:${inkCss(look.ink)}`,
  look.align && `text-align:${look.align}`,
];

const decoration = (look: TableLook) =>
  [look.underline && 'underline', look.strike && 'line-through'].filter(Boolean).join(' ') || 'none';

export function styleAttrs(look: TableLook | null, kind: Styling['kind']): Record<string, string> {
  if (!look) return {};
  const attrs: Record<string, string> = { [`data-${kind}-style`]: JSON.stringify(look) };
  const css = textCss(look);
  if (kind === 'table') {
    if (look.fill) css.push(`--table-bg:${fillCss(look.fill)}`);
    if (look.underline || look.strike) css.push(`--table-deco:${decoration(look)}`);
    if (look.header) attrs['data-header'] = '';
    if (look.firstCol) attrs['data-first-col'] = '';
    if (look.borders) attrs['data-borders'] = look.borders;
  } else {
    if (look.fill) css.push(`background:${fillCss(look.fill)}`);
    if (look.underline !== undefined || look.strike !== undefined) css.push(`text-decoration-line:${decoration(look)}`);
  }
  const style = css.filter(Boolean).join(';');
  return style ? { ...attrs, style } : attrs;
}

/** Only what a cell changes from its table, so later table edits still reach the rest. */
export function cellOverrides(look: TableLook, table: TableLook | null): TableLook | null {
  const out: TableLook = { ...look };
  for (const key of TEXT_KEYS) if ((out[key] || undefined) === (table?.[key] || undefined)) delete out[key];
  // A cell's text-decoration replaces the table's whole value, so it needs both lines.
  if ('underline' in out || 'strike' in out) {
    out.underline = !!look.underline;
    out.strike = !!look.strike;
  }
  return sanitizeStyle(out);
}

/** A cell without the options just set on the whole table, so those reach it too. */
export function clearKeys(cell: TableLook | null, keys: Set<string>): TableLook | null {
  const out: Record<string, unknown> = { ...cell };
  for (const key of keys) delete out[key];
  // The two lines are one value on a cell: see cellOverrides.
  if (keys.has('underline') || keys.has('strike')) {
    delete out.underline;
    delete out.strike;
  }
  return sanitizeStyle(out);
}

const styleAttribute = (kind: Styling['kind']) => {
  const name = `${kind}Style`;
  return {
    [name]: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        try {
          return sanitizeStyle(JSON.parse(el.getAttribute(`data-${kind}-style`) ?? 'null'));
        } catch {
          return null;
        }
      },
      renderHTML: (attrs: Record<string, unknown>) => styleAttrs(sanitizeStyle(attrs[name]), kind),
    },
  };
};

export const TableStyle = Extension.create({
  name: 'tableStyleAttrs',
  addGlobalAttributes: () => [
    { types: ['table'], attributes: styleAttribute('table') },
    { types: ['tableCell', 'tableHeader'], attributes: styleAttribute('cell') },
  ],
});

export function styleTargets(editor: Editor, kind: Styling['kind'], tablePos: number): Styling {
  const { doc, selection } = editor.state;
  const node = doc.nodeAt(tablePos);
  const table = (node?.attrs.tableStyle ?? null) as TableLook | null;
  if (kind === 'table') {
    const targets: Target[] = [{ pos: tablePos, attr: 'tableStyle', original: table }];
    node?.descendants((n, offset) => {
      if (n.attrs.cellStyle) targets.push({ pos: tablePos + 1 + offset, attr: 'cellStyle', original: n.attrs.cellStyle as TableLook });
      return n.type.name === 'tableRow';
    });
    return { kind, table, targets };
  }
  const targets: Target[] = [];
  if (selection instanceof CellSelection) {
    selection.forEachCell((n, pos) => targets.push({ pos, attr: 'cellStyle', original: (n.attrs.cellStyle ?? null) as TableLook | null }));
  }
  return { kind, table, targets };
}

const BORDER_ICONS: Record<string, ReactNode> = {
  rounded: <><rect x="2.5" y="2.5" width="15" height="15" rx="4" /><path d="M2.5 10h15M10 2.5v15" /></>,
  grid: <><rect x="2.5" y="2.5" width="15" height="15" /><path d="M2.5 10h15M10 2.5v15" /></>,
  lines: <path d="M2 4h16M2 10h16M2 16h16" />,
  outer: <path d="M2 4h16M2 16h16" />,
  none: <rect x="2.5" y="2.5" width="15" height="15" rx="2" strokeDasharray="2.5 2.5" />,
};

const hueLabel = (id: string) => HUES.find((h) => id.endsWith(h.id))?.label ?? id;

function Swatches({ label, ids, value, css, onPick }: {
  label: string; ids: string[]; value?: string; css: (id: string) => string; onPick: (id?: string) => void;
}) {
  const custom = value?.startsWith('#') ? value : undefined;
  return (
    <div className="color-swatches table-style-swatches" role="group" aria-label={label}>
      <button type="button" className="swatch-none" aria-label="No color" title="No color" aria-pressed={!value} onClick={() => onPick(undefined)} />
      {ids.map((id) => (
        <button key={id} type="button" aria-label={hueLabel(id)} title={hueLabel(id)} aria-pressed={value === id} style={{ background: css(id) }} onClick={() => onPick(id)} />
      ))}
      <label className="swatch-custom" title="Custom color" data-on={!!custom}>
        <input type="color" aria-label="Custom color" value={custom ?? '#808080'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

export function TableStyleSheet({ editor, styling, onClose }: { editor: Editor; styling: Styling; onClose: () => void }) {
  const { kind, table, targets } = styling;
  const [look, setLook] = useState<TableLook>(() => {
    if (kind === 'table') return table ?? {};
    const inherited: Record<string, unknown> = {};
    for (const key of TEXT_KEYS) inherited[key] = table?.[key];
    return { ...inherited, ...targets[0]?.original } as TableLook;
  });
  const [inking, setInking] = useState(false);
  const touched = useRef(new Set<string>());
  const resolve = (l: TableLook, t: Target) => {
    if (kind === 'cell') return cellOverrides(l, table);
    return t.attr === 'tableStyle' ? sanitizeStyle(l) : clearKeys(t.original, touched.current);
  };

  const write = (value: (t: Target) => TableLook | null, preview: boolean) => {
    const tr = editor.state.tr;
    for (const t of targets) tr.setNodeAttribute(t.pos, t.attr, value(t));
    if (preview) tr.setMeta(PREVIEW, true).setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  };
  const update = (patch: TableLook) => {
    const next = { ...look, ...patch };
    setLook(next);
    for (const key of Object.keys(patch)) touched.current.add(key);
    write((t) => resolve(next, t), true);
  };
  // Not the focus command: it scrolls to the selection's last cell.
  const cancel = () => {
    if (touched.current.size) write((t) => t.original, true);
    onClose();
    editor.view.focus();
  };
  const done = () => {
    if (touched.current.size) {
      // Back to the originals first, so undo returns to them in one step.
      write((t) => t.original, true);
      write((t) => resolve(look, t), false);
    }
    onClose();
    editor.view.focus();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    // Anything else changing the note could move the positions held here.
    const changed = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (transaction.docChanged && !transaction.getMeta(PREVIEW)) onClose();
    };
    document.addEventListener('keydown', key);
    editor.on('transaction', changed);
    return () => {
      document.removeEventListener('keydown', key);
      editor.off('transaction', changed);
    };
  });

  const title = kind === 'table' ? 'Table style' : 'Cell style';
  const toggle = (name: 'header' | 'firstCol', label: string) => (
    <label className="table-style-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={!!look[name]} onChange={(e) => update({ [name]: e.target.checked })} />
    </label>
  );
  const flag = (name: 'bold' | 'italic' | 'underline' | 'strike', label: string, Icon: typeof Bold) => (
    <button type="button" aria-label={label} title={label} aria-pressed={!!look[name]} onClick={() => update({ [name]: !look[name] })}>
      <Icon size={18} />
    </button>
  );
  const align = look.align ?? 'left';
  const AlignIcon = align === 'center' ? AlignCenter : align === 'right' ? AlignRight : AlignLeft;

  return createPortal(
    <div className="sheet-backdrop" data-clear="" onClick={cancel}>
      <div className="sheet table-style" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {kind === 'table' && (
          <>
            {toggle('header', 'Highlight header row')}
            {toggle('firstCol', 'Highlight first column')}
            <hr />
            <div className="table-style-group" role="group" aria-label="Borders">
              {BORDERS.map((b) => (
                <button key={b} type="button" aria-label={`Borders: ${b}`} title={b} aria-pressed={(look.borders ?? 'grid') === b} onClick={() => update({ borders: b })}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">{BORDER_ICONS[b]}</svg>
                </button>
              ))}
            </div>
          </>
        )}
        <Swatches label="Fill color" ids={FILLS} value={look.fill} css={(id) => noteBg(id)!} onPick={(fill) => update({ fill })} />
        <hr />
        <div className="table-style-text">
          <select aria-label="Font size" value={look.size ?? ''} onChange={(e) => update({ size: e.target.value || undefined })}>
            <option value="">Size</option>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{parseInt(s)}</option>)}
          </select>
          <div className="table-style-group" role="group" aria-label="Text format">
            {flag('bold', 'Bold', Bold)}
            {flag('italic', 'Italic', Italic)}
            {flag('underline', 'Underline', Underline)}
            {flag('strike', 'Strikethrough', Strikethrough)}
            <button type="button" aria-label="Text color" title="Text color" aria-expanded={inking} aria-pressed={!!look.ink} onClick={() => setInking(!inking)}>
              <Type size={18} style={{ color: look.ink && inkCss(look.ink) }} />
            </button>
            <button
              type="button" aria-label={`Align ${align}`} title={`Align ${align}`}
              onClick={() => update({ align: ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length] })}
            ><AlignIcon size={18} /></button>
          </div>
        </div>
        {inking && <Swatches label="Text color" ids={INKS} value={look.ink} css={inkCss} onPick={(ink) => update({ ink })} />}
        <div className="sheet-actions">
          <button type="button" onClick={cancel}>Cancel</button>
          <button type="button" onClick={done}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
