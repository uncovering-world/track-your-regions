import { describe, expect, it } from 'vitest';
import type { SparqlBinding } from '../wikidataUtils.js';
import { attachCasts, fetchCastItems } from './castGroups.js';
import { emptyFacts, type PoolEntity } from './queries.js';
import { medoidOf } from '../anchorPoint.js';

/**
 * The casts of a group of casts (#880, ADR-0145 decision 2b): the Burghers of
 * Calais as Wikidata keeps them — a group with casts as parts, each standing
 * somewhere, and a study of one figure among the parts with no coordinate.
 */
const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });
const BURGHERS = 'Q978987';

const cast = (qid: string, label: string, coord: string, extra: Partial<Record<string, { value: string }>> = {}): SparqlBinding => ({
  g: ref(BURGHERS), cast: ref(qid), castLabel: { value: label }, coord: { value: coord }, cls: ref('Q2293362'), ...extra,
});

const rows: SparqlBinding[] = [
  // Calais: one placement that holds, in France.
  cast('Q29273401', 'The Burghers of Calais', 'Point(1.8535 50.9523)', { at: ref('Q6454'), atLabel: { value: 'Calais' }, countryLabel: { value: 'France' } }),
  // London: two rows for one cast — a second class and the same placement — fold to one.
  cast('Q25338408', 'The Burghers of Calais', 'Point(-0.1249 51.4975)', { at: ref('Q2485117'), atLabel: { value: 'Victoria Tower Gardens' }, countryLabel: { value: 'United Kingdom' } }),
  { ...cast('Q25338408', 'The Burghers of Calais', 'Point(-0.1249 51.4975)', { at: ref('Q2485117'), atLabel: { value: 'Victoria Tower Gardens' }, countryLabel: { value: 'United Kingdom' } }), cls: ref('Q3331189') },
  // Stanford: named by the group through P361 rather than P527 — the same rows.
  cast('Q47522991', 'The Burghers of Calais, Stanford', 'Point(-122.1699 37.428)', { at: ref('Q41506'), atLabel: { value: 'Stanford University' }, countryLabel: { value: 'United States' } }),
  // A cast whose one placement ended has left.
  cast('Q900001', 'The Burghers of Calais (loan)', 'Point(2.3 48.8)', { at: ref('Q19675'), atLabel: { value: 'Louvre' }, ended: { value: '2001-01-01T00:00:00Z' } }),
  // A cast placed nowhere stands where its point is, called by its own label.
  cast('Q900002', 'The Burghers of Calais (Tokyo)', 'Point(139.76 35.71)'),
];

describe('fetchCastItems', () => {
  it('reads the casts of a group with their classes, named by where each stands', async () => {
    const casts = await fetchCastItems(async () => rows, [BURGHERS]);
    expect([...casts.keys()]).toEqual([BURGHERS]);
    expect(casts.get(BURGHERS)).toEqual([
      { qid: 'Q29273401', lat: 50.9523, lon: 1.8535, name: 'Calais', countryLabel: 'France', classes: ['Q2293362'] },
      { qid: 'Q25338408', lat: 51.4975, lon: -0.1249, name: 'Victoria Tower Gardens', countryLabel: 'United Kingdom', classes: ['Q2293362', 'Q3331189'] },
      { qid: 'Q47522991', lat: 37.428, lon: -122.1699, name: 'Stanford University', countryLabel: 'United States', classes: ['Q2293362'] },
      { qid: 'Q900002', lat: 35.71, lon: 139.76, name: 'The Burghers of Calais (Tokyo)', countryLabel: null, classes: ['Q2293362'] },
    ]);
  });

  it('asks nothing for no group, and answers no entry for a group with no casts', async () => {
    let asked = 0;
    expect(await fetchCastItems(async () => { asked++; return []; }, [])).toEqual(new Map());
    expect(asked).toBe(0);
    expect(await fetchCastItems(async () => [], [BURGHERS])).toEqual(new Map());
  });

  it.each([false, true])('keeps a cast that returned to the same placement, regardless of statement order (%s)', async (reversed) => {
    const standing = cast('Q29273401', 'The Burghers of Calais', 'Point(1.8535 50.9523)', {
      at: ref('Q6454'), atLabel: { value: 'Calais' }, countryLabel: { value: 'France' },
    });
    const ended = { ...standing, ended: { value: '2001-01-01T00:00:00Z' } };
    const casts = await fetchCastItems(async () => reversed ? [standing, ended] : [ended, standing], [BURGHERS]);
    expect(casts.get(BURGHERS)).toEqual([
      { qid: 'Q29273401', lat: 50.9523, lon: 1.8535, name: 'Calais', countryLabel: 'France', classes: ['Q2293362'] },
    ]);
  });

  it('ignores label-service QID fallbacks for countries and uses the cast name for an unlabelled placement', async () => {
    const unlabelled = cast('Q47522991', 'The Burghers of Calais, Stanford', 'Point(-122.1699 37.428)', {
      at: ref('Q41506'), atLabel: { value: 'Q41506' }, country: ref('Q900999'), countryLabel: { value: 'Q900999' },
    });
    const labelledCountry = { ...unlabelled, country: ref('Q30'), countryLabel: { value: 'United States' } };
    const casts = await fetchCastItems(async () => [unlabelled, labelledCountry], [BURGHERS]);
    expect(casts.get(BURGHERS)).toEqual([
      { qid: 'Q47522991', lat: 37.428, lon: -122.1699, name: 'The Burghers of Calais, Stanford', countryLabel: 'United States', classes: ['Q2293362'] },
    ]);
  });

  it.each([undefined, { type: 'bnode', value: 'unknown-placement' }])('keeps the coordinate when the placement names no item (%j)', async (at) => {
    const casts = await fetchCastItems(async () => [
      cast('Q900120', 'Cast with no named placement', 'Point(2 1)', { at }),
    ], [BURGHERS]);
    expect(casts.get(BURGHERS)).toEqual([
      { qid: 'Q900120', lat: 1, lon: 2, name: 'Cast with no named placement', countryLabel: null, classes: ['Q2293362'] },
    ]);
  });
});

describe('attachCasts', () => {
  const entity = (over: Partial<PoolEntity> = {}): PoolEntity => ({
    qid: BURGHERS, label: 'The Burghers of Calais', description: null, lat: 50.9524, lon: 1.8533, onEarth: true,
    imageUrl: null, itemPictures: [], sitelinks: 30, countryLabel: 'France', articleUrl: null, website: null, year: 1889, ...over,
  });
  const casts = [
    { qid: 'Q29273401', lat: 50.9523, lon: 1.8535, name: 'Calais', countryLabel: 'France', classes: ['Q2293362'] },
    { qid: 'Q47522991', lat: 37.428, lon: -122.1699, name: 'Stanford University', countryLabel: 'United States', classes: ['Q2293362', 'Q1232589'] },
  ];

  it("writes the casts onto the group and the casts' classes onto its facts, keeping the group's own point", () => {
    const group = entity();
    const facts = { ...emptyFacts(), classes: ['Q28890616'] };
    attachCasts(group, facts, casts);
    expect(group.casts).toEqual([
      { lat: 50.9523, lon: 1.8535, placeQid: 'Q29273401', placeLabel: 'Calais', countryLabel: 'France' },
      { lat: 37.428, lon: -122.1699, placeQid: 'Q47522991', placeLabel: 'Stanford University', countryLabel: 'United States' },
    ]);
    expect([group.lat, group.lon]).toEqual([50.9524, 1.8533]);
    expect(facts.classes).toEqual(['Q28890616', 'Q2293362', 'Q1232589']);
  });

  it("gives a group with no point of its own its first cast's, on Earth", () => {
    const thinker = entity({
      qid: 'Q18003128', label: 'The Thinker', lat: null, lon: null, onEarth: false,
      countryLabel: 'United States', countryOptions: { candidates: [], noneStands: true },
    });
    attachCasts(thinker, undefined, casts.slice(0, 1));
    expect([thinker.lat, thinker.lon, thinker.onEarth]).toEqual([50.9523, 1.8535, true]);
    expect(thinker.countryLabel).toBe('France');
    expect(thinker.countryOptions).toBeNull();
  });

  it('keeps a two-cast anchor and its country when the reader returns the casts in reverse order', () => {
    const first = entity();
    const second = entity();
    const pair = casts.map((cast, index) => ({ ...cast, lat: 0, lon: index === 0 ? -1 : 1 }));
    attachCasts(first, undefined, pair);
    attachCasts(second, undefined, [...pair].reverse());
    for (const group of [first, second]) {
      expect(medoidOf(group.casts!)).toMatchObject({ lat: 0, lon: -1, countryLabel: 'France' });
    }
  });

  it('changes nothing for a group with no casts', () => {
    const group = entity();
    attachCasts(group, undefined, []);
    expect(group.casts).toBeUndefined();
  });
});
