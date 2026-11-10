import { describe, expect, it } from 'vitest';
import { copyDue, type CopyFacts } from './copySchedule.js';

/**
 * When a copy built from a dump brings itself forward (ADR-0195): English
 * Wikipedia's structure built from the dump of 1 Oct and swapped in on 3 Oct,
 * on a weekly schedule, with the host's newest dump of 1 Nov learnt.
 */

const NOW = new Date('2026-11-10T12:00:00Z');
const facts = (over: Partial<CopyFacts> = {}): CopyFacts => ({
  everyDays: 7, kept: { dumpDate: '2026-10-01', swappedAt: new Date('2026-10-03T08:00:00Z') }, newestOnHost: '2026-11-01',
  buildActive: false, lastScheduled: null, ...over,
});

describe('a copy due to bring itself forward', () => {
  it('is due once the host has a newer dump and the copy is older than its interval', () => {
    expect(copyDue(facts(), NOW)).toBe(true);
  });

  it('is not due with the schedule off, no copy built yet, or a build of the dump queued or running', () => {
    expect(copyDue(facts({ everyDays: null }), NOW)).toBe(false);
    // A first build stays an admin's.
    expect(copyDue(facts({ kept: null }), NOW)).toBe(false);
    expect(copyDue(facts({ buildActive: true }), NOW)).toBe(false);
  });

  it('is not due while the host has nothing newer, or nothing it learnt', () => {
    expect(copyDue(facts({ newestOnHost: '2026-10-01' }), NOW)).toBe(false);
    expect(copyDue(facts({ newestOnHost: null }), NOW)).toBe(false);
  });

  it('waits out the interval since the copy was swapped in, and since a self-queued build that failed', () => {
    expect(copyDue(facts({ kept: { dumpDate: '2026-10-01', swappedAt: new Date('2026-11-05T08:00:00Z') } }), NOW)).toBe(false);
    expect(copyDue(facts({ lastScheduled: new Date('2026-11-08T08:00:00Z') }), NOW)).toBe(false);
    expect(copyDue(facts({ lastScheduled: new Date('2026-11-01T08:00:00Z') }), NOW)).toBe(true);
  });

  it('is due without a newer dump once a copy it is built from moved, after a failed try waits out the interval', () => {
    // Readership's months were folded with the redirects of 1 Oct; the redirects copy swapped in those of 1 Nov.
    const stale = { kept: { dumpDate: '2026-10-01', swappedAt: new Date('2026-11-09T08:00:00Z') }, newestOnHost: '2026-10-01', followerStale: true };
    expect(copyDue(facts(stale), NOW)).toBe(true);
    expect(copyDue(facts({ ...stale, lastScheduled: new Date('2026-11-08T08:00:00Z') }), NOW)).toBe(false);
    expect(copyDue(facts({ ...stale, everyDays: null }), NOW)).toBe(false);
    expect(copyDue(facts({ ...stale, buildActive: true }), NOW)).toBe(false);
  });

  it("reads readership's months as dates of their first day", () => {
    expect(copyDue(facts({ kept: { dumpDate: '2026-09-01', swappedAt: new Date('2026-10-20T00:00:00Z') }, newestOnHost: '2026-10-01' }), NOW)).toBe(true);
  });
});
