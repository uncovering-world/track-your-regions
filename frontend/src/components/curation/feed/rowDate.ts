/**
 * The day a row was asked, in a curator's own time zone and a curator's own words.
 *
 * The feed groups rows under day headings (ADR-0051 decision 2), and a boundary drawn in
 * UTC would put a curator's own 11pm question under tomorrow's heading. `dayOf` reads a
 * `Date`'s local getters, never `toISOString` — that is UTC's own string, not the reader's
 * day. `today` is a parameter everywhere rather than read here from `Date.now()`, so a test
 * can fix it and the page computes its one real "now" once per render instead of every row
 * asking its own.
 *
 * `dateFormat.ts` has no counterpart to compose: `formatDateTime` is a full date+time
 * string, `formatRelativeTime` counts minutes/hours/days rather than naming a day, and
 * `formatDuration` measures a span between two timestamps. None of the three groups a
 * timestamp under "Today" / "Yesterday" / a weekday, which is the whole job here.
 */

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** A `day` string parsed as a plain UTC calendar date, purely so two of them can be diffed by whole days without a local clock's DST jumps in the way. */
function asUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `YYYY-MM-DD`, read from the instant's local calendar day — never UTC's. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * A day heading against the curator's own `today`: `Today`, `Yesterday`, or a short
 * weekday, day and month (`Sat 5 Sep`) for anything older. Both `day` and `today` are
 * `dayOf`'s own output — a local calendar date, not an instant — so this never touches a
 * time zone itself.
 */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (Math.round((asUtcMs(today) - asUtcMs(day)) / 86_400_000) === 1) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/** A row's own short date: `today` for the current day, else `5 Sep`. `''` for a `null` timestamp — an open question always has one, an answered one this reads may not. */
export function dateShort(iso: string | null, today: string): string {
  if (!iso) return '';
  if (dayOf(iso) === today) return 'today';
  const date = new Date(iso);
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}
