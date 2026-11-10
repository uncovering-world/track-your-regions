import { describe, expect, it, vi } from 'vitest';

/**
 * The dump worker's look for scheduled builds (ADR-0195), with the catalogue,
 * the keepers and the schedule stood in: a copy whose schedule makes a build
 * due is queued from its newest dump, the OpenStreetMap layer on its own
 * trigger, and a build an admin queued meanwhile is no error.
 */

vi.mock('./catalog.js', () => ({ DUMPS: [{ key: 'enwiki-page' }, { key: 'enwiki-page-props' }, { key: 'osm-planet' }, { key: 'pageviews-user' }] }));
vi.mock('./buildQueue.js', () => ({ dumpsDir: () => '/dumps' }));
const keepers = vi.hoisted(() => ({
  structure: { schedule: { read: vi.fn(async () => ({ everyDays: 7, chosen: false })) }, latest: vi.fn(async () => ({ dumpDate: '2026-10-01', swappedAt: new Date('2026-10-03') })) },
  readership: { schedule: { read: vi.fn(async () => ({ everyDays: 7, chosen: false })) }, latest: vi.fn(async () => ({ dumpDate: '2026-09-01', swappedAt: new Date('2026-10-20') })) },
  layer: { update: vi.fn(), schedule: { read: vi.fn() }, latest: vi.fn() },
}));
vi.mock('./keepers.js', () => ({
  keeperOf: (key: string) => ({ 'enwiki-page': keepers.structure, 'pageviews-user': keepers.readership, 'osm-planet': keepers.layer })[key] ?? null,
}));
const schedule = vi.hoisted(() => ({
  copyFacts: vi.fn(async (dump: string) => ({ dump })),
  copyDue: vi.fn((facts: { dump: string }) => facts.dump === 'enwiki-page' || facts.dump === 'pageviews-user'),
  queueScheduledBuild: vi.fn(async (dump: string) => (dump === 'enwiki-page' ? 7 : 8)),
}));
vi.mock('./copySchedule.js', () => schedule);
const layer = vi.hoisted(() => ({ queueScheduledUpdate: vi.fn(async () => 9) }));
vi.mock('./osm/layerSchedule.js', () => layer);
vi.mock('./ledger.js', () => ({ BuildAlreadyRunning: class BuildAlreadyRunning extends Error {} }));

const { queueDueCopies } = await import('./scheduledCopies.js');
const { BuildAlreadyRunning } = await import('./ledger.js');

describe('the builds the schedules make due (ADR-0195)', () => {
  it('queues each copy due from its newest dump, the layer on its own trigger, and no input of a copy', async () => {
    expect(await queueDueCopies(new AbortController().signal)).toEqual([
      { dump: 'enwiki-page', id: 7 }, { dump: 'osm-planet', id: 9 }, { dump: 'pageviews-user', id: 8 },
    ]);
    expect(schedule.queueScheduledBuild).toHaveBeenCalledWith('enwiki-page', 'local', expect.any(Date));
    expect(schedule.copyFacts).not.toHaveBeenCalledWith('enwiki-page-props', expect.anything(), expect.anything());
  });

  it('takes a build an admin queued meanwhile as no error, and goes on to the next copy', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    schedule.queueScheduledBuild.mockRejectedValueOnce(new BuildAlreadyRunning('A build of enwiki-page is already queued or running'));
    expect(await queueDueCopies(new AbortController().signal)).toEqual([{ dump: 'osm-planet', id: 9 }, { dump: 'pageviews-user', id: 8 }]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
