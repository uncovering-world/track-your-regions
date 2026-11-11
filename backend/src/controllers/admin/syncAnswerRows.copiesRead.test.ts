import { describe, expect, it } from 'vitest';
import { copiesReadOf } from './syncAnswerRows.js';

/** The copies a run read, with readership's fold apart from its dump date (#2415). */
describe("a run's copies read", () => {
  it('answers a dump date alone, and a revision where the run recorded one', () => {
    const copies = copiesReadOf({ 'wikipedia-redirects': '2026-11-01', 'pageviews-user': '2026-10-01#59@2026-10-01×8,64@2026-11-01×4' })!;
    expect(copies.find(copy => copy.dump === 'wikipedia-redirects')).toMatchObject({ dumpDate: '2026-11-01', revision: null });
    expect(copies.find(copy => copy.dump === 'pageviews-user')).toMatchObject({ dumpDate: '2026-10-01', revision: '59@2026-10-01×8,64@2026-11-01×4' });
  });

  it('answers nothing for a run from before copies were recorded', () => {
    expect(copiesReadOf(null)).toBeNull();
  });
});
