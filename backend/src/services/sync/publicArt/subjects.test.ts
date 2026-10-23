/**
 * What a candidate depicts (#1832): read through the run's door, and on a
 * subset built before its scope kept a seed's subjects, the gaps asked of the
 * live service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../subset/publicArt.js', () => ({ subsetSubjectFacts: vi.fn() }));
vi.mock('../../dumps/wikidata/subsetTables.js', () => ({ latestSubsetCounts: vi.fn() }));
vi.mock('../wikidataUtils.js', async (actual) => ({ ...(await actual<object>()), delay: vi.fn(async () => {}) }));

import { subsetSubjectFacts } from '../subset/publicArt.js';
import { latestSubsetCounts } from '../../dumps/wikidata/subsetTables.js';
import { currentRules } from '../../dumps/wikidata/buildRules.js';
import { subsetDoor } from '../subset/reader.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { loadSubjects } from './subjects.js';

// The Statue of Unity depicts Sardar Vallabhbhai Patel, who has no coordinate;
// Mother Ukraine depicts Ukraine, which has one.
const PATEL = 'Q9455';
const UKRAINE = 'Q212';
const HUMAN = 'Q5';
const COUNTRY = 'Q6256';

const entity = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}` });
const live = vi.fn<SparqlFn>(async () => [{ s: entity(PATEL), cls: entity(HUMAN) }]);
const runOn = (sparql: SparqlFn) => ({ sparql, phase: vi.fn(), step: vi.fn(async () => {}), live: () => live });
const before = '1:{"coordinate":625,"place":[131,276,361,527,195,189]}';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(subsetSubjectFacts).mockResolvedValue(new Map([[UKRAINE, { classes: [COUNTRY], worshipped: false }]]));
});

describe('loadSubjects', () => {
  it('asks the live service about what a subset built before the subject scope lacks, and only that', async () => {
    vi.mocked(latestSubsetCounts).mockResolvedValue({ dumpDate: '2026-10-05', counts: {}, rules: { scope: before, write: 1, derive: 1 } });
    const subjects = await loadSubjects(runOn(subsetDoor(vi.fn<SparqlFn>())), [PATEL, UKRAINE, PATEL]);
    expect(subjects.get(UKRAINE)).toEqual({ classes: [COUNTRY], worshipped: false });
    expect(subjects.get(PATEL)).toEqual({ classes: [HUMAN], worshipped: false });
    expect(live).toHaveBeenCalledTimes(1);
    expect(live.mock.calls[0][0]).toContain(`wd:${PATEL}`);
    expect(live.mock.calls[0][0]).not.toContain(`wd:${UKRAINE}`);
  });

  it('carries on with what the subset answered when the live service fails, and not when the run was cancelled', async () => {
    vi.mocked(latestSubsetCounts).mockResolvedValue({ dumpDate: '2026-10-05', counts: {}, rules: { scope: before, write: 1, derive: 1 } });
    live.mockRejectedValueOnce(new Error('Wikidata wait budget exhausted'));
    const subjects = await loadSubjects(runOn(subsetDoor(vi.fn<SparqlFn>())), [PATEL, UKRAINE]);
    expect([...subjects.keys()]).toEqual([UKRAINE]);
    live.mockRejectedValueOnce(new Error('Sync cancelled'));
    const cancelled = { ...runOn(subsetDoor(vi.fn<SparqlFn>())), cancelled: () => true };
    await expect(loadSubjects(cancelled, [PATEL])).rejects.toThrow('Sync cancelled');
  });

  it('asks nothing live of a subset built under the scope that keeps subjects', async () => {
    vi.mocked(latestSubsetCounts).mockResolvedValue({ dumpDate: '2026-10-19', counts: {}, rules: currentRules() });
    const subjects = await loadSubjects(runOn(subsetDoor(vi.fn<SparqlFn>())), [PATEL, UKRAINE]);
    expect(subjects.has(PATEL)).toBe(false);
    expect(live).not.toHaveBeenCalled();
  });

  it('reads a run on the live service through its own door, worship and all', async () => {
    const door = vi.fn<SparqlFn>(async () => [
      { s: entity('Q9441'), cls: entity(HUMAN) }, { s: entity('Q9441'), worship: entity('Q748') },
    ]);
    const subjects = await loadSubjects(runOn(door), ['Q9441']);
    expect(subjects.get('Q9441')).toEqual({ classes: [HUMAN], worshipped: true });
    expect(subsetSubjectFacts).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
  });
});
