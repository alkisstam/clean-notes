import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown, ChevronUp, Contrast, Download, Lock, Minus, Plus, Search, X,
} from 'lucide-react';
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/db';
import { isPasswordError, loadPdf, pageText, saveBlob } from '../lib/pdf';
import { findRanges } from '../lib/search';
import { useStore, type PdfTarget } from '../lib/store';

type Size = { w: number; h: number };
type Match = { page: number; index: number };

const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;

function applyHighlights() {
  if (!supportsHighlights) return;
  const all = new Highlight();
  const current = new Highlight();
  document.querySelectorAll<HTMLElement>('.pdf-page').forEach((el) => {
    const ranges = (el as HTMLElement & { _ranges?: Range[] })._ranges ?? [];
    const active = Number(el.dataset.activeMatch ?? -1);
    ranges.forEach((r, i) => (i === active ? current : all).add(r));
  });
  CSS.highlights.set('pdf-match', all);
  CSS.highlights.set('pdf-match-current', current);
}

/** Maps a search over the page's text onto DOM ranges in its text layer. */
function rangesFor(layer: HTMLElement, query: string): Range[] {
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        nodes.push({ node: child as Text, start: text.length });
        text += child.textContent ?? '';
      } else if ((child as HTMLElement).tagName === 'BR') {
        text += ' ';
      } else {
        walk(child);
      }
    });
  };
  walk(layer);
  const locate = (offset: number, end: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, start } = nodes[i];
      if (start < offset || (!end && start === offset)) {
        return { node, offset: Math.min(offset - start, node.length) };
      }
    }
    return null;
  };
  return findRanges(text, query).flatMap(([s, e]) => {
    const a = locate(s, false);
    const b = locate(e, true);
    if (!a || !b) return [];
    const r = new Range();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return [r];
  });
}

const PdfPage = memo(function PdfPage({ doc, number, size, scale, root, query, activeMatch }: {
  doc: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  root: HTMLElement | null;
  query: string;
  activeMatch: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [layerReady, setLayerReady] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let text: TextLayer | null = null;
    let page: PDFPageProxy | null = null;
    const c = canvas.current!;
    const l = layer.current!;
    void (async () => {
      try {
        page = await doc.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const off = document.createElement('canvas');
        off.width = Math.floor(viewport.width * dpr);
        off.height = Math.floor(viewport.height * dpr);
        task = page.render({ canvas: off, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        await task.promise;
        if (cancelled) return;
        // Paint only when finished, so zooming never shows a blank page.
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);

        l.replaceChildren();
        text = new TextLayer({ textContentSource: page.streamTextContent(), container: l, viewport });
        await text.render();
        if (!cancelled) setLayerReady((n) => n + 1);
      } catch (e) {
        if ((e as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) console.warn(e);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [near, doc, number, scale]);

  // Free memory for pages far from view.
  useEffect(() => {
    if (near) return;
    const c = canvas.current;
    if (c) {
      c.width = 0;
      c.height = 0;
    }
    layer.current?.replaceChildren();
    setLayerReady(0);
  }, [near]);

  useEffect(() => {
    const el = wrap.current as (HTMLDivElement & { _ranges?: Range[] }) | null;
    if (!el || !layer.current) return;
    el._ranges = query && layerReady ? rangesFor(layer.current, query) : [];
    el.dataset.activeMatch = String(activeMatch);
    applyHighlights();
    if (activeMatch >= 0 && el._ranges[activeMatch]) {
      const rect = el._ranges[activeMatch].getBoundingClientRect();
      const box = root?.getBoundingClientRect();
      if (root && box && (rect.top < box.top + 60 || rect.bottom > box.bottom - 60)) {
        root.scrollBy({ top: rect.top - box.top - box.height / 3 });
      }
    }
  }, [query, activeMatch, layerReady, root]);

  useEffect(
    () => () => {
      if (wrap.current) (wrap.current as HTMLDivElement & { _ranges?: Range[] })._ranges = [];
    },
    [],
  );

  return (
    <div
      ref={wrap}
      className="pdf-page"
      data-page={number}
      style={{ width: size.w * scale, height: size.h * scale, '--total-scale-factor': scale, '--scale-factor': scale } as React.CSSProperties}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} aria-hidden />
      <div ref={layer} className="textLayer" />
    </div>
  );
});

export function PdfViewer({ target }: { target: PdfTarget }) {
  const close = useStore((s) => s.setPdf);
  const file = useLiveQuery(() => db.files.get(target.fileId), [target.fileId], null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState<'ask' | 'wrong' | null>(null);
  const [password, setPassword] = useState('');
  const [attempt, setAttempt] = useState<string | undefined>(undefined);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [dim, setDim] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(target.query));
  const [query, setQuery] = useState(target.query ?? '');
  const [matchIndex, setMatchIndex] = useState(0);
  const [texts, setTexts] = useState<string[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const jumped = useRef(false);

  useEffect(() => {
    let task: ReturnType<typeof loadPdf> | null = null;
    let cancelled = false;
    setError(null);
    void (async () => {
      const rec = await db.blobs.get(target.fileId);
      if (!rec) {
        setError('This file is no longer on this device.');
        return;
      }
      try {
        task = loadPdf(await rec.blob.arrayBuffer(), attempt);
        const d = await task.promise;
        if (cancelled) return;
        const pages = await Promise.all(Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1)));
        if (cancelled) return;
        setSizes(pages.map((p) => {
          const v = p.getViewport({ scale: 1 });
          return { w: v.width, h: v.height };
        }));
        setNeedPassword(null);
        setDoc(d);
      } catch (e) {
        if (cancelled) return;
        if (isPasswordError(e)) setNeedPassword(attempt ? 'wrong' : 'ask');
        else setError('This PDF could not be opened.');
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [target.fileId, attempt]);

  // Unlocked files have no stored text, so read it once they are open.
  useEffect(() => {
    if (!doc || !file) return;
    if (!file.encrypted) {
      setTexts(file.pageTexts);
      return;
    }
    let cancelled = false;
    void (async () => {
      const out: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        out.push(await pageText(await doc.getPage(i)));
        if (cancelled) return;
      }
      setTexts(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, file]);

  // Fit to the column width until the reader picks a zoom.
  useEffect(() => {
    if (!scroller || !sizes.length) return;
    const widest = Math.max(...sizes.map((s) => s.w));
    const ro = new ResizeObserver(() => {
      setFit(Math.max(0.25, Math.min(2.5, (scroller.clientWidth - 40) / widest)));
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller, sizes]);

  const scale = zoom ?? fit ?? 1;

  const goTo = useCallback((n: number) => {
    scroller?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });
  }, [scroller]);

  useEffect(() => {
    if (!scroller || !sizes.length) return;
    const onScroll = () => {
      const box = scroller.getBoundingClientRect();
      const mid = box.top + box.height / 3;
      let page = 1;
      for (const el of scroller.querySelectorAll<HTMLElement>('.pdf-page')) {
        if (el.getBoundingClientRect().top <= mid) page = Number(el.dataset.page);
        else break;
      }
      setCurrent(page);
      setPageInput(String(page));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, sizes]);

  // Open at the page a search result pointed to.
  useEffect(() => {
    if (jumped.current || !target.page || !fit || !sizes.length) return;
    jumped.current = true;
    requestAnimationFrame(() => goTo(target.page!));
  }, [fit, sizes, target.page, goTo]);

  const matches = useMemo<Match[]>(() => {
    if (!query.trim() || !texts) return [];
    return texts.flatMap((t, p) => findRanges(t, query).map((_, index) => ({ page: p + 1, index })));
  }, [query, texts]);

  useEffect(() => setMatchIndex(0), [query]);

  // When the viewer opens from a search hit, start at the first match on that page.
  useEffect(() => {
    if (target.page && matches.length) {
      const i = matches.findIndex((m) => m.page === target.page);
      if (i >= 0) setMatchIndex(i);
    }
  }, [matches, target.page]);

  const active = matches[matchIndex];

  const step = (dir: number) => {
    if (!matches.length) return;
    const next = (matchIndex + dir + matches.length) % matches.length;
    setMatchIndex(next);
    if (matches[next].page !== active?.page) goTo(matches[next].page);
  };

  useEffect(() => {
    if (active && !target.page) goTo(active.page);
    // Only when typing changes the first match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matches.length]);

  const setZoomBy = (factor: number) => setZoom(Math.max(0.25, Math.min(4, Math.round(scale * factor * 100) / 100)));

  // Ctrl+F searches the PDF while the pointer or focus is inside it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.select(), 0);
      }
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    return () => {
      if (supportsHighlights) {
        CSS.highlights.delete('pdf-match');
        CSS.highlights.delete('pdf-match-current');
      }
    };
  }, []);

  return (
    <div className="pdf-viewer" ref={root} tabIndex={-1}>
      <header className="pdf-bar">
        <button type="button" className="icon-btn" aria-label="Close PDF" title="Close PDF" onClick={() => close(null)}><X size={16} /></button>
        <span className="pdf-name" title={file?.name}>{file?.name ?? ''}</span>
        {doc && (
          <>
            <form
              className="pdf-pages"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(pageInput);
                if (n >= 1 && n <= doc.numPages) goTo(n);
                else setPageInput(String(current));
              }}
            >
              <input aria-label="Page number" inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} onBlur={() => setPageInput(String(current))} />
              <span>/ {doc.numPages}</span>
            </form>
            <div className="pdf-zoom">
              <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => setZoomBy(1 / 1.2)}><Minus size={14} /></button>
              <button type="button" className="pdf-zoom-val" title="Fit to width" aria-label={`Zoom ${Math.round(scale * 100)} percent. Fit to width`} onClick={() => setZoom(null)}>{Math.round(scale * 100)}%</button>
              <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => setZoomBy(1.2)}><Plus size={14} /></button>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Search in PDF"
              title="Search in PDF (Ctrl F)"
              aria-pressed={searchOpen}
              onClick={() => {
                setSearchOpen(!searchOpen);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <Search size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Dim pages for dark reading" title="Dim pages" aria-pressed={dim} onClick={() => setDim(!dim)}><Contrast size={15} /></button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Download PDF"
              title="Download"
              onClick={() => void db.blobs.get(target.fileId).then((b) => b && saveBlob(b.blob, file?.name ?? 'document.pdf'))}
            >
              <Download size={15} />
            </button>
          </>
        )}
      </header>

      {searchOpen && doc && (
        <div className="pdf-search">
          <Search size={13} />
          <input
            ref={searchRef}
            autoFocus
            value={query}
            placeholder="Find in this PDF"
            aria-label="Find in this PDF"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
              if (e.key === 'Escape') {
                setQuery('');
                setSearchOpen(false);
              }
            }}
          />
          <span className="pdf-search-count" role="status">
            {query.trim() ? (matches.length ? `${matchIndex + 1} of ${matches.length}` : 'No matches') : ''}
          </span>
          <button type="button" className="icon-btn small" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={14} /></button>
          <button type="button" className="icon-btn small" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={14} /></button>
        </div>
      )}

      {error ? (
        <div className="empty"><strong>{error}</strong></div>
      ) : needPassword ? (
        <form
          className="empty pdf-password"
          onSubmit={(e) => {
            e.preventDefault();
            setAttempt(password);
          }}
        >
          <Lock size={22} />
          <strong>This PDF is password protected</strong>
          {needPassword === 'wrong' && <p role="alert">That password did not work.</p>}
          <input type="password" autoFocus aria-label="PDF password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="btn primary" disabled={!password}>Unlock</button>
        </form>
      ) : !doc ? (
        <div className="pdf-loading">Opening…</div>
      ) : (
        <div className="pdf-scroll" ref={setScroller} data-dim={dim}>
          {fit !== null && doc && sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={doc}
              number={i + 1}
              size={size}
              scale={scale}
              root={scroller}
              query={query.trim()}
              activeMatch={active?.page === i + 1 ? active.index : -1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
