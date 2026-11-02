const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. Never uses UTC, so it cannot slip a day. */
export const dateKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export const longDate = (key: string) =>
  parseKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const shortDate = (key: string, today = dateKey()) => {
  const d = parseKey(key);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};

export function dueLabel(key: string, today = dateKey()): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return shortDate(key, today);
}

export function relativeTime(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const today = dateKey(new Date(now));
  const key = dateKey(new Date(ts));
  if (key === today) return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (key === addDays(today, -1)) return 'Yesterday';
  return shortDate(key, today);
}

export function firstDayOfWeek(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay ?? 1;
    return first % 7;
  } catch {
    return 1;
  }
}

/** Date keys for a month grid, padded to whole weeks. */
export function monthGrid(year: number, month: number, weekStart: number): string[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => dateKey(new Date(year, month, 1 - offset + i)));
}
