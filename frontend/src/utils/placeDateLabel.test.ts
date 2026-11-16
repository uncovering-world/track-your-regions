import { describe, expect, it } from 'vitest';
import type { PlaceDate } from '@tyr/shared/lifetime';
import { monthNames } from './dateFormat';
import { placeDateLabel } from './placeDateLabel';

const date = (year: number | null, rest: Partial<PlaceDate> = {}): PlaceDate => ({
  year, month: null, day: null, span: null, circa: false, ...rest,
});

/** A place's dates as a person reads them (#1719), on the places the plan was measured on. */
describe('placeDateLabel', () => {
  it('reads a coarse date as about its year, rounded to its span', () => {
    // Göbekli Tepe, 9999 BC to the millennium; Stonehenge, 3000 BC to the century.
    expect(placeDateLabel(date(-9999, { span: 'millennium', circa: true }))).toBe('c. 10,000 BC');
    expect(placeDateLabel(date(-3000, { span: 'century', circa: true }))).toBe('c. 3,000 BC');
    expect(placeDateLabel(date(1501, { span: 'century' }))).toBe('c. 1500');
  });

  it('never rounds a year to nought', () => {
    expect(placeDateLabel(date(40, { span: 'century' }))).toBe('c. AD 40');
  });

  it('reads a decade as one', () => {
    expect(placeDateLabel(date(1883, { span: 'decade' }))).toBe('1880s');
    expect(placeDateLabel(date(-250, { span: 'decade' }))).toBe('250s BC');
    expect(placeDateLabel(date(1883, { span: 'decade', circa: true }))).toBe('c. 1880s');
  });

  it('reads a year, a month and a day with the year always', () => {
    expect(placeDateLabel(date(1883))).toBe('1883');
    expect(placeDateLabel(date(1883, { circa: true }))).toBe('c. 1883');
    expect(placeDateLabel(date(2024, { month: 1 }))).toBe(`${monthNames()[0]} 2024`);
    const day = placeDateLabel(date(1931, { month: 12, day: 5 }));
    expect(day).toMatch(/1931$/);
    expect(day).toContain('5');
  });

  it('says nothing of a date with no year', () => {
    expect(placeDateLabel(date(null))).toBeNull();
  });
});
