import { describe, expect, it } from 'vitest';
import { automated, isBurst, type MonthSeries } from './workReadership.js';

const steady = (views: number): MonthSeries => ({ views, daily: Array.from({ length: 30 }, () => views / 30) });

describe('a pair read by machines (ADR-0055 decision 3)', () => {
  it('sets aside a pair whose phone share strays 2.5 or more in log-odds from its edition', () => {
    // An edition read half on phones; a pair read 1 % on phones is about 4.6 off.
    expect(automated(10_000, 100, 0.5)).toBe(true);
    // 40 % against 50 % is 0.4 off.
    expect(automated(10_000, 4_000, 0.5)).toBe(false);
  });

  it('judges nothing under 5,000 views, nor a pair whose edition has no share', () => {
    expect(automated(4_999, 0, 0.5)).toBe(false);
    expect(automated(10_000, 0, undefined)).toBe(false);
  });
});

describe('a burst (ADR-0055 decision 4)', () => {
  it('reads a steady year as none', () => {
    expect(isBurst(Array.from({ length: 12 }, () => steady(3_000)))).toBe(false);
  });

  it('flags a quarter of the year in one week, where the months alone do not swing', () => {
    // Two months of 3,000 views, the first read 1,600 times in its first week:
    // over a quarter of 6,000, while the monthly variation is nil.
    const front = Array.from({ length: 30 }, (_, day) => (day < 7 ? 1_600 / 7 : 1_400 / 23));
    expect(isBurst([{ views: 3_000, daily: front }, steady(3_000)])).toBe(true);
    const even = Array.from({ length: 30 }, (_, day) => (day < 7 ? 1_400 / 7 : 1_600 / 23));
    expect(isBurst([{ views: 3_000, daily: even }, steady(3_000)])).toBe(false);
  });

  it('flags months that swing, with no daily series to read', () => {
    const months: MonthSeries[] = Array.from({ length: 12 }, (_, i) => ({ views: i % 2 === 0 ? 500 : 5_000, daily: null }));
    expect(isBurst(months)).toBe(true);
  });

  it('reads nothing into a work no one read', () => {
    expect(isBurst(Array.from({ length: 12 }, () => ({ views: 0, daily: null })))).toBe(false);
  });
});
