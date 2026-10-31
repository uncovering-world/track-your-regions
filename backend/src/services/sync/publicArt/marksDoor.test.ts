/**
 * The marks door's answers (ADR-0169): what it says of a candidate the line
 * did not keep, open or shut, the sentences a curator reads, and how the share
 * is read with the door — the gate, the year, the works under the floor, the
 * marks and the readers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const gate = vi.hoisted(() => ({ curatorGateOn: vi.fn() }));
const readership = vi.hoisted(() => ({ readershipYear: vi.fn() }));
const usage = vi.hoisted(() => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));
const candidates = vi.hoisted(() => ({ yearlyReaders: vi.fn() }));
const streetArt = vi.hoisted(() => ({ fetchStreetArtMarks: vi.fn() }));
const under = vi.hoisted(() => ({ collectWorksUnderFloor: vi.fn() }));
vi.mock('../readershipDoor.js', () => gate);
vi.mock('../../dumps/readership/workReadership.js', () => readership);
vi.mock('../../dumps/wikivoyage/usageTables.js', () => usage);
vi.mock('../places/candidates.js', () => candidates);
vi.mock('./streetArtQueries.js', () => streetArt);
vi.mock('./underFloor.js', () => under);

import {
  belowLineUnmarkedReason, keptMarksNote, marksDoorCandidates, marksDoorEntry, marksDoorNote, marksOf,
  PUBLIC_ART_MARKS_DOOR, shareWithMarksDoor, type MarksRead,
} from './marksDoor.js';
import { belowLineReason } from '../sourceLine.js';
import { emptyContainment } from '../places/containment.js';
import type { KindShare } from '../places/gather.js';
import type { PublicArtTrees } from './classes.js';
import type { PoolEntity } from './queries.js';

const LINE = { enterSitelinks: 22, staySitelinks: 18 };
// Cadillac Ranch: 10 editions, Atlas Obscura and a guide, 61,000 readers. Salvation
// Mountain: 10 editions, Atlas Obscura, 28,000. A statue a guide uses read by 9,000. A held work
// no mark names.
const door: MarksRead = {
  guided: new Set(['Q254602', 'Q3']),
  atlas: new Set(['Q254602', 'Q1549866']),
  readers: new Map([['Q254602', 61_000], ['Q1549866', 28_000], ['Q3', 9_000], ['Q4', 17_000], ['Q5', 30_000]]),
};

describe('marksDoorEntry', () => {
  it('admits a marked candidate the year reads over the bar, whatever its editions, with the question', () => {
    expect(marksDoorEntry(door, 'Q254602', 10, 'out', LINE))
      .toEqual({ readershipNote: marksDoorNote(10, 61_000, ['a Wikivoyage guide uses it', 'Atlas Obscura lists it'], LINE) });
    expect(marksDoorEntry(door, 'Q1549866', 10, 'out', LINE))
      .toEqual({ readershipNote: marksDoorNote(10, 28_000, ['Atlas Obscura lists it'], LINE) });
    expect(marksDoorNote(10, 61_000, marksOf(door, 'Q254602'), LINE)).toBe(
      'Admitted below the sitelinks line (10 Wikipedia editions, 22 to enter; 61,000 readers a year): '
      + "a Wikivoyage guide uses it and Atlas Obscura lists it, and the year reads it over the marks door's bar of 20,000. "
      + 'Can a visitor see it there now?',
    );
  });

  it('says nothing of a candidate never in that is unmarked or read under the bar', () => {
    expect(marksDoorEntry(door, 'Q3', 14, 'out', LINE)).toBeNull();
    expect(marksDoorEntry(door, 'Q5', 14, 'out', LINE)).toBeNull();
  });

  it('keeps a held work over the exit while a mark stands, and lets it fall with the marks named', () => {
    expect(marksDoorEntry({ ...door, guided: new Set(['Q4']) }, 'Q4', 17, 'fell', LINE))
      .toEqual({ readershipNote: marksDoorNote(17, 17_000, ['a Wikivoyage guide uses it'], LINE) });
    expect(marksDoorNote(17, 17_000, ['a Wikivoyage guide uses it'], LINE)).toContain("over the marks door's exit of 16,400");
    expect(marksDoorEntry(door, 'Q3', 17, 'fell', LINE))
      .toEqual({ fell: belowLineUnmarkedReason(17, 9_000, ['a Wikivoyage guide uses it'], LINE) });
    expect(marksDoorEntry(door, 'Q5', 17, 'fell', LINE))
      .toEqual({ fell: belowLineUnmarkedReason(17, 30_000, [], LINE) });
    expect(belowLineUnmarkedReason(17, 9_000, ['a Wikivoyage guide uses it'], LINE))
      .toBe(`${belowLineReason(17, LINE)}, and a Wikivoyage guide uses it, but 9,000 readers a year is under the marks door's exit of 16,400`);
    expect(belowLineUnmarkedReason(17, 30_000, [], LINE))
      .toBe(`${belowLineReason(17, LINE)}, and no Wikivoyage guide uses it and Atlas Obscura does not list it (30,000 readers a year)`);
  });

  it('shut, lets nothing in and keeps the held where they are', () => {
    expect(marksDoorEntry(null, 'Q254602', 10, 'out', LINE)).toBeNull();
    expect(marksDoorEntry(null, 'Q4', 17, 'fell', LINE)).toEqual({ readershipNote: keptMarksNote(17, null, LINE) });
    expect(keptMarksNote(17, null, LINE)).toBe(
      'Kept below the sitelinks line (17 Wikipedia editions, 18 to stay; no year of readers read): '
      + "the marks door is shut (the source's curator gate is off, or no year of readers is read)",
    );
  });

  it('states its bars once', () => {
    expect(PUBLIC_ART_MARKS_DOOR).toEqual({ enterReaders: 20_000, stayReaders: 16_400 });
  });
});

describe('shareWithMarksDoor', () => {
  const entity = (qid: string, sitelinks: number): PoolEntity => ({
    qid, label: qid, description: null, lat: 35.19, lon: -101.99, onEarth: true, imageUrl: null, itemPictures: [],
    sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
  });
  const share = (): KindShare<PublicArtTrees> => ({
    trees: { admitting: new Set(['Q860861']) } as unknown as PublicArtTrees,
    pool: new Map([['Q1', entity('Q1', 30)], ['Q2', entity('Q2', 16)]]),
    byId: new Set(), facts: new Map(), containers: emptyContainment(), subjects: new Map(), entered: new Set(), enteredOnly: new Set(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    gate.curatorGateOn.mockResolvedValue(true);
    readership.readershipYear.mockResolvedValue({ editions: ['en'], months: ['2026-09-01'] });
    usage.latestUsage.mockResolvedValue({ dumpDate: '2026-10-19' });
    usage.usedByAGuide.mockResolvedValue(new Set(['Q2']));
    candidates.yearlyReaders.mockResolvedValue(new Map([['Q2', 25_000], ['Q254602', 61_000]]));
    streetArt.fetchStreetArtMarks.mockResolvedValue(new Map([['Q254602', { atlasObscura: true, ended: false }]]));
    under.collectWorksUnderFloor.mockResolvedValue({
      entities: [entity('Q254602', 10)], facts: new Map([['Q254602', { classes: ['Q860861'] }]]),
      containers: emptyContainment(), subjects: new Map(),
    });
  });

  it('joins the works under the floor to the share and reads the marks and the readers over every candidate under the line', async () => {
    const { share: joined, marks } = await shareWithMarksDoor(3, share(), vi.fn(), LINE, '[test]');
    expect([...joined.pool.keys()]).toEqual(['Q1', 'Q2', 'Q254602']);
    expect(joined.facts.get('Q254602')).toEqual({ classes: ['Q860861'] });
    // The pool's candidates under the line, the under-floor rows among them; a row at the line is not asked.
    expect(marksDoorCandidates(joined, LINE)).toEqual(['Q2', 'Q254602']);
    expect(usage.usedByAGuide).toHaveBeenCalledWith(['Q2', 'Q254602']);
    expect(marks).toEqual({ guided: new Set(['Q2']), atlas: new Set(['Q254602']), readers: new Map([['Q2', 25_000], ['Q254602', 61_000]]) });
    expect(under.collectWorksUnderFloor).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 20_000, true, '[test]');
  });

  it('is shut while the source\'s curator gate is off, reading nothing under the floor', async () => {
    gate.curatorGateOn.mockResolvedValue(false);
    const { share: same, marks } = await shareWithMarksDoor(3, share(), vi.fn(), LINE, '[test]');
    expect(marks).toBeNull();
    expect([...same.pool.keys()]).toEqual(['Q1', 'Q2']);
    expect(under.collectWorksUnderFloor).not.toHaveBeenCalled();
  });

  it('is shut while no year of readership is folded', async () => {
    readership.readershipYear.mockResolvedValue(null);
    expect((await shareWithMarksDoor(3, share(), vi.fn(), LINE, '[test]')).marks).toBeNull();
    expect(under.collectWorksUnderFloor).not.toHaveBeenCalled();
  });

  it('reads Atlas Obscura alone while no Wikivoyage usage build is in place', async () => {
    usage.latestUsage.mockResolvedValue(null);
    const { marks } = await shareWithMarksDoor(3, share(), vi.fn(), LINE, '[test]');
    expect(marks?.guided).toEqual(new Set());
    expect(marks?.atlas).toEqual(new Set(['Q254602']));
    expect(usage.usedByAGuide).not.toHaveBeenCalled();
    expect(under.collectWorksUnderFloor).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 20_000, false, '[test]');
  });
});
