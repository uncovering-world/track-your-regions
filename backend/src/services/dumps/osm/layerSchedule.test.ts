import { describe, expect, it, vi } from 'vitest';

/** When the OpenStreetMap layer's update is due (ADR-0134 decision 6), judged from the facts alone. */

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./layerBuild.js', () => ({ hasCurrentPlanet: vi.fn() }));
vi.mock('../ledger.js', () => ({ activeBuildOf: vi.fn(), enqueueBuild: vi.fn() }));
vi.mock('../fetch.js', () => ({ fetchText: vi.fn() }));

const { DEFAULT_EVERY_DAYS, LAYER_FRESH_FOR_DAYS, updateDue } = await import('./layerSchedule.js');

const NOW = new Date('2026-10-30T09:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const facts = {
  everyDays: 7, layerCurrentTo: daysAgo(8), planetKept: true, buildActive: false, lastScheduled: null as Date | null,
  newestDiffEnds: daysAgo(0) as Date | null,
};

describe('the layer schedule', () => {
  it('defaults to the planet\'s weekly release, and reads a miss as a fact for a day longer', () => {
    expect(DEFAULT_EVERY_DAYS).toBe(7);
    expect(LAYER_FRESH_FOR_DAYS).toBe(8);
  });

  it('is due once the layer is older than the interval', () => {
    expect(updateDue(facts, NOW)).toBe(true);
    expect(updateDue({ ...facts, layerCurrentTo: daysAgo(6) }, NOW)).toBe(false);
    expect(updateDue({ ...facts, everyDays: 1, layerCurrentTo: daysAgo(1) }, NOW)).toBe(true);
  });

  it('is never due with the schedule off, before a first build, or with no current planet kept', () => {
    expect(updateDue({ ...facts, everyDays: null }, NOW)).toBe(false);
    expect(updateDue({ ...facts, layerCurrentTo: null }, NOW)).toBe(false);
    expect(updateDue({ ...facts, planetKept: false }, NOW)).toBe(false);
  });

  it('waits while a build of the planet is queued or running', () => {
    expect(updateDue({ ...facts, buildActive: true }, NOW)).toBe(false);
  });

  it('is not due while the host publishes nothing newer than the layer, however old it is', () => {
    expect(updateDue({ ...facts, newestDiffEnds: daysAgo(8) }, NOW)).toBe(false);
    expect(updateDue({ ...facts, newestDiffEnds: null }, NOW)).toBe(false);
  });

  it('does not try a failed scheduled update again before the next interval', () => {
    expect(updateDue({ ...facts, lastScheduled: daysAgo(2) }, NOW)).toBe(false);
    expect(updateDue({ ...facts, lastScheduled: daysAgo(7) }, NOW)).toBe(true);
  });
});
