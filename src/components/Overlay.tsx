import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** A small action menu that opens from a button and stays inside the viewport. */
export function Menu({ items, label, trigger, className }: { items: MenuItem[]; label: string; trigger?: ReactNode; className?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className ?? 'icon-btn'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(rect)}
        onClick={(e) => {
          e.stopPropagation();
          setRect(rect ? null : e.currentTarget.getBoundingClientRect());
        }}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      <MenuPopup
        items={items}
        rect={rect}
        anchor={btn.current}
        onClose={(refocus) => {
          setRect(null);
          if (refocus) btn.current?.focus();
        }}
      />
    </>
  );
}

/** The menu itself, placed below `rect` (or above when there is no room). Also used for right-click menus. */
/** `keepFocus` leaves focus (and the selection) where it was, for menus that act on a text field. */
export function MenuPopup({ items, rect, anchor, keepFocus, onClose }: { items: MenuItem[]; rect: DOMRect | null; anchor?: HTMLElement | null; keepFocus?: boolean; onClose: (refocus?: boolean) => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!rect) {
      setPos(null);
      return;
    }
    const el = pop.current!;
    const left = Math.max(8, Math.min(rect.left, innerWidth - el.offsetWidth - 8));
    const below = rect.bottom + 4;
    const top = below + el.offsetHeight > innerHeight - 8 ? Math.max(8, rect.top - el.offsetHeight - 4) : below;
    setPos({ left, top });
    if (!keepFocus) el.querySelector('button')?.focus();
    const close = (e: Event) => {
      if (!el.contains(e.target as Node) && !anchor?.contains(e.target as Node)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(true);
      if (!keepFocus && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const all = [...el.querySelectorAll('button')];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [rect, anchor, keepFocus]);

  return (
    rect &&
    createPortal(
      <div ref={pop} className="menu" role="menu" style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-danger={item.danger}
            data-checked={item.checked}
            disabled={item.disabled}
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              item.run();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>,
      document.body,
    )
  );
}
