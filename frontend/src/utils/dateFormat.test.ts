import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelativeTime, formatTimeLeft } from './dateFormat';

/** A time left said the way a person says it (#1467). */
describe('formatTimeLeft', () => {
  it('rounds to what an estimate can claim', () => {
    expect(formatTimeLeft(20)).toBe('under a minute');
    expect(formatTimeLeft(25 * 60 + 10)).toBe('about 25 min');
    expect(formatTimeLeft(70 * 60)).toBe('about 1 h 10 min');
    expect(formatTimeLeft(2 * 3600 + 2 * 60)).toBe('about 2 h');
    expect(formatTimeLeft(3 * 3600 - 60)).toBe('about 3 h');
  });
});

/** A date is a day and a month in words, never numbers or seconds (interface-writing.md, rule 5). */
describe('a date on screen', () => {
  const lastYear = new Date().getFullYear() - 1;
  // The month as the host's locale words it, which is the locale the screen writes in.
  const month = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
    .formatToParts(new Date(iso)).find(part => part.type === 'month')?.value ?? '';

  it('writes the month in words and the time to the minute', () => {
    const text = formatDateTime(`${lastYear}-11-02T21:54:54Z`);
    expect(text).toContain(month(`${lastYear}-11-02T21:54:54Z`));
    expect(text).not.toMatch(/\d{1,4}\/\d{1,2}\/\d{1,4}/);
    expect(text).not.toMatch(/:54:54/);
  });

  it('names the year only where it is not this one', () => {
    expect(formatDateTime(`${lastYear}-11-02T12:00:00Z`)).toContain(String(lastYear));
    const thisYear = new Date(Date.UTC(new Date().getFullYear(), 0, 2, 12)).toISOString();
    expect(formatDateTime(thisYear)).not.toContain(String(new Date().getFullYear()));
  });

  it('falls back from a relative time to the day in words', () => {
    expect(formatRelativeTime(`${lastYear}-03-01T12:00:00Z`)).toContain(month(`${lastYear}-03-01T12:00:00Z`));
  });
});
