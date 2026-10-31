/**
 * The works under the pool's floor the marks door may open for (ADR-0169):
 * the readership names them, the marks narrow them, Wikidata is asked about
 * those alone — rows, facts, what holds them, what they depict — and the
 * pool's own rows are never asked about again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const readership = vi.hoisted(() => ({ readershipYear: vi.fn(), readAtLeast: vi.fn() }));
const usage = vi.hoisted(() => ({ usedByAGuide: vi.fn() }));
const placed = vi.hoisted(() => ({ fetchPlacedAmong: vi.fn() }));
const queries = vi.hoisted(() => ({ fetchEntitiesByIds: vi.fn(), fetchEntityFacts: vi.fn(), POOL_MIN_SITELINKS: 15 }));
const containment = vi.hoisted(() => ({
  loadContainment: vi.fn(), emptyContainment: () => ({ nodes: new Map(), unknown: new Set() }),
}));
const subjects = vi.hoisted(() => ({ loadSubjects: vi.fn() }));
const streetArt = vi.hoisted(() => ({ fetchStreetArtMarks: vi.fn() }));
vi.mock('../../dumps/readership/workReadership.js', () => readership);
vi.mock('../../dumps/wikivoyage/usageTables.js', () => usage);
vi.mock('../archaeology/queries.js', () => placed);
vi.mock('./queries.js', () => queries);
vi.mock('../places/containment.js', () => containment);
vi.mock('./subjects.js', () => subjects);
vi.mock('./streetArtQueries.js', () => streetArt);

import { collectWorksUnderFloor } from './underFloor.js';
import type { KindShare } from '../places/gather.js';
import { PUBLIC_CLOCK_CLASSES, type PublicArtTrees } from './classes.js';
import type { PoolEntity } from './queries.js';

const SCULPTURE = 'Q860861';
const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
  qid, label, description: null, lat: 35.19, lon: -101.99, onEarth: true, imageUrl: null, itemPictures: [],
  sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
});
const share = (pool: PoolEntity[]): KindShare<PublicArtTrees> => ({
  trees: { sculptural: new Set([SCULPTURE]), fountain: new Set(['Q483453']) } as unknown as PublicArtTrees,
  pool: new Map(pool.map((e) => [e.qid, e])),
  byId: new Set(), facts: new Map(), containers: { nodes: new Map(), unknown: new Set() }, subjects: new Map(),
  entered: new Set(), enteredOnly: new Set(),
});
const sparql = vi.fn();

describe('collectWorksUnderFloor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readership.readershipYear.mockResolvedValue({ editions: ['en'], months: ['2026-09-01'] });
    // The year reads four items over the bar in fewer than 15 editions: a work
    // the pool holds, Cadillac Ranch (a guide and Atlas Obscura), Salvation
    // Mountain (Atlas Obscura alone) and an unmarked statue.
    readership.readAtLeast.mockResolvedValue(['Q1', 'Q254602', 'Q1549866', 'Q3']);
    usage.usedByAGuide.mockResolvedValue(new Set(['Q254602']));
    streetArt.fetchStreetArtMarks.mockResolvedValue(new Map([
      ['Q254602', { atlasObscura: true, ended: false }], ['Q1549866', { atlasObscura: true, ended: false }],
    ]));
    placed.fetchPlacedAmong.mockResolvedValue(['Q254602', 'Q1549866']);
    queries.fetchEntitiesByIds.mockResolvedValue([entity('Q254602', 'Cadillac Ranch', 10), entity('Q1549866', 'Salvation Mountain', 10)]);
    queries.fetchEntityFacts.mockResolvedValue(new Map([
      ['Q254602', { classes: [SCULPTURE], locations: [], parents: [], depicts: [] }],
      ['Q1549866', { classes: [SCULPTURE], locations: ['Q5'], parents: [], depicts: ['Q6'] }],
    ]));
    containment.loadContainment.mockResolvedValue({ nodes: new Map([['Q5', { label: 'Minneapolis Sculpture Garden' }]]), unknown: new Set() });
    subjects.loadSubjects.mockResolvedValue(new Map([['Q6', { classes: [] }]]));
  });

  it('names the marked works the year reads at the bar and asks Wikidata about those alone, with their containers and subjects', async () => {
    const out = await collectWorksUnderFloor(sparql, share([entity('Q1', 'Already in the pool', 14)]), 20_000, true, '[test]');
    expect(readership.readAtLeast).toHaveBeenCalledWith({ editions: ['en'], months: ['2026-09-01'] }, 20_000, 15);
    // The pool's own row is never asked about again.
    expect(usage.usedByAGuide).toHaveBeenCalledWith(['Q254602', 'Q1549866', 'Q3']);
    expect(placed.fetchPlacedAmong).toHaveBeenCalledWith(sparql, ['Q254602', 'Q1549866'], new Set([SCULPTURE, 'Q483453', ...Object.keys(PUBLIC_CLOCK_CLASSES)]));
    expect(queries.fetchEntitiesByIds).toHaveBeenCalledWith(sparql, ['Q254602', 'Q1549866'], 'works the world reads under the pool floor');
    expect(out.entities.map((e) => e.qid)).toEqual(['Q254602', 'Q1549866']);
    expect(out.facts.get('Q1549866')?.locations).toEqual(['Q5']);
    expect(subjects.loadSubjects).toHaveBeenCalledWith(expect.objectContaining({ sparql }), ['Q6']);
    expect(out.containers.nodes.has('Q5')).toBe(true);
    expect(out.subjects.has('Q6')).toBe(true);
  });

  it('reads Atlas Obscura alone while the guide is silent', async () => {
    const out = await collectWorksUnderFloor(sparql, share([]), 20_000, false, '[test]');
    expect(usage.usedByAGuide).not.toHaveBeenCalled();
    expect(placed.fetchPlacedAmong).toHaveBeenCalledWith(sparql, ['Q254602', 'Q1549866'], new Set([SCULPTURE, 'Q483453', ...Object.keys(PUBLIC_CLOCK_CLASSES)]));
    expect(out.entities.map((e) => e.qid)).toEqual(['Q254602', 'Q1549866']);
  });

  it('reads nothing while no year of readership is folded, and asks Wikidata nothing when no marked item is read', async () => {
    readership.readershipYear.mockResolvedValue(null);
    expect((await collectWorksUnderFloor(sparql, share([]), 20_000, true, '[test]')).entities).toEqual([]);
    expect(readership.readAtLeast).not.toHaveBeenCalled();
    readership.readershipYear.mockResolvedValue({ editions: ['en'], months: ['2026-09-01'] });
    usage.usedByAGuide.mockResolvedValue(new Set());
    streetArt.fetchStreetArtMarks.mockResolvedValue(new Map());
    expect((await collectWorksUnderFloor(sparql, share([]), 20_000, true, '[test]')).entities).toEqual([]);
    expect(placed.fetchPlacedAmong).not.toHaveBeenCalled();
  });
});
