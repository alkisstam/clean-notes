import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dateKey, firstDayOfWeek, longDate, monthGrid, parseKey } from '../lib/dates';

export function Calendar({ selected, marked, onPick }: { selected: string; marked?: Set<string>; onPick: (key: string) => void }) {
  const today = dateKey();
  const [cursor, setCursor] = useState(() => {
    const d = parseKey(selected);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  useEffect(() => {
    const d = parseKey(selected);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }, [selected]);
  const weekStart = useMemo(firstDayOfWeek, []);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m, weekStart), [cursor, weekStart]);
  const heads = useMemo(
    () => grid.slice(0, 7).map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' })),
    [grid],
  );
  const shift = (by: number) => {
    const d = new Date(cursor.y, cursor.m + by, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <div className="calendar">
      <div className="calendar-head">
        <strong>{monthName}</strong>
        <button type="button" className="icon-btn small" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={14} /></button>
        <button type="button" className="link-btn" onClick={() => onPick(today)}>Today</button>
        <button type="button" className="icon-btn small" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={14} /></button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={monthName}>
        {heads.map((h, i) => <span key={i} className="calendar-dow" aria-hidden>{h}</span>)}
        {grid.map((key) => (
          <button
            key={key}
            type="button"
            data-outside={parseKey(key).getMonth() !== cursor.m}
            data-today={key === today}
            data-selected={key === selected}
            data-has={marked?.has(key)}
            aria-label={`${longDate(key)}${marked?.has(key) ? ', has a note' : ''}`}
            aria-pressed={key === selected}
            onClick={() => onPick(key)}
          >
            {parseKey(key).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}
