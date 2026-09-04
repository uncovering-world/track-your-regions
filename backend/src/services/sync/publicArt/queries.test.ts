/**
 * What the public-art queries make of an answer: one entity per pool row
 * however many times the OPTIONALs repeat it, a coordinate that says which
 * globe it is on, and the facts pass grouped by entity.
 */

import { describe, it, expect } from 'vitest';
import {
  fetchClassPool,
  fetchEntitiesByIds,
  fetchEntityFacts,
  fetchContainerFacts,
  POOL_BANDS,
  POOL_MIN_SITELINKS,
} from './queries.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });

const answer = (rows: SparqlBinding[]): SparqlFn => () => Promise.resolve(rows);

describe('fetchClassPool', () => {
  it('makes one entity of the rows an answer repeats, the first row fixing its fields', async () => {
    const rows: SparqlBinding[] = [
      { e: ref('Q185382'), eLabel: { value: 'Trevi Fountain' }, coord: { value: 'Point(12.4833 41.9009)' },
        sl: { value: '68' }, img: { value: 'a.jpg' }, countryLabel: { value: 'Italy' } },
      { e: ref('Q185382'), eLabel: { value: 'Trevi Fountain' }, coord: { value: 'Point(12.4833 41.9009)' },
        sl: { value: '68' }, img: { value: 'b.jpg' }, countryLabel: { value: 'Italy' } },
    ];
    const pool = await fetchClassPool(answer(rows), ['Q483453']);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({
      qid: 'Q185382', label: 'Trevi Fountain', lat: 41.9009, lon: 12.4833, sitelinks: 68,
      imageUrl: 'a.jpg', countryLabel: 'Italy', onEarth: true,
    });
  });

  it('reads a coordinate on another globe as not on Earth', async () => {
    // Fallen Astronaut: its P625 carries the Moon's IRI in front of the point.
    const rows: SparqlBinding[] = [{
      e: ref('Q1161218'), eLabel: { value: 'Fallen Astronaut' },
      coord: { value: '<http://www.wikidata.org/entity/Q405> Point(-3.6 26.1)' }, sl: { value: '33' },
    }];
    const [entity] = await fetchClassPool(answer(rows), ['Q860861']);
    expect(entity.onEarth).toBe(false);
    expect(entity.lat).toBe(26.1);
  });

  it('drops a row whose coordinate does not parse', async () => {
    const rows: SparqlBinding[] = [{ e: ref('Q1'), eLabel: { value: 'x' }, coord: { value: 'nowhere' }, sl: { value: '30' } }];
    expect(await fetchClassPool(answer(rows), ['Q860861'])).toEqual([]);
  });

  it('asks nothing for an empty class list', async () => {
    let asked = 0;
    const sparql: SparqlFn = () => { asked++; return Promise.resolve([]); };
    expect(await fetchClassPool(sparql, [])).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe('fetchEntitiesByIds', () => {
  it('keeps an admitted row Wikidata still answers for but no longer places', async () => {
    // A row whose coordinate Wikidata removed: the class questions cannot name
    // it, and if the by-id question also demanded a coordinate the row would
    // fall to the sweep's generic reason while the source answers for it
    // perfectly well. It comes back placeless, for the rule to refuse by name.
    const rows: SparqlBinding[] = [
      { e: ref('Q1'), eLabel: { value: 'A lost pin' }, sl: { value: '30' } },
    ];
    const [entity] = await fetchEntitiesByIds(answer(rows), ['Q1']);
    expect(entity).toMatchObject({ qid: 'Q1', label: 'A lost pin', lat: null, lon: null, sitelinks: 30 });
  });

  it('asks for the coordinate as optional, unlike the pool', async () => {
    let sent = '';
    const sparql: SparqlFn = (q) => { sent = q; return Promise.resolve([]); };
    await fetchEntitiesByIds(sparql, ['Q1']);
    expect(sent).toMatch(/OPTIONAL \{ \?e wdt:P625 \?coord \}/);
  });
});

describe('POOL_BANDS', () => {
  it('tile the range from the pool floor upward with no gap and no overlap', () => {
    expect(POOL_BANDS[0].max).toBeNull();
    expect(POOL_BANDS[POOL_BANDS.length - 1].min).toBe(POOL_MIN_SITELINKS);
    // Below the stay line, so an admitted row that slipped to 17 is named with
    // its number rather than swept with the generic reason.
    expect(POOL_MIN_SITELINKS).toBe(15);
    for (let i = 1; i < POOL_BANDS.length; i++) {
      expect(POOL_BANDS[i].max).toBe(POOL_BANDS[i - 1].min);
    }
  });
});

describe('fetchEntityFacts', () => {
  it('groups every class, container and maker by entity', async () => {
    const rows: SparqlBinding[] = [
      { e: ref('Q235242'), cls: ref('Q860861') },
      { e: ref('Q235242'), cls: ref('Q2065736') },
      { e: ref('Q235242'), loc: ref('Q12512') },
      { e: ref('Q235242'), creator: ref('Q5592'), creatorLabel: { value: 'Michelangelo' } },
      { e: ref('Q79961'), cls: ref('Q1779653') },
      { e: ref('Q79961'), creator: ref('Q451797'), creatorLabel: { value: 'Paul Landowski' } },
      { e: ref('Q79961'), creator: ref('Q5041289'), creatorLabel: { value: 'Carlos Oswald' } },
      { e: ref('Q79961'), parent: ref('Q2') },
      { e: ref('Q79961'), coll: ref('Q5710459') },
    ];
    const facts = await fetchEntityFacts(answer(rows), ['Q235242', 'Q79961']);
    expect(facts.get('Q235242')).toEqual({
      classes: ['Q860861', 'Q2065736'], locations: ['Q12512'], parents: [], collections: [],
      creators: ['Michelangelo'],
    });
    expect(facts.get('Q79961')).toMatchObject({
      classes: ['Q1779653'], parents: ['Q2'], collections: ['Q5710459'],
      creators: ['Paul Landowski', 'Carlos Oswald'],
    });
  });

  it('reads where a work stands, what it is part of and whose it is as what still holds', async () => {
    // Ownership is not a place, and the rule reads it only when nothing says
    // where the work stands (#804) — but the question is asked once, with the
    // facts, and all three are read the way the museum import reads a work's
    // location: statement by statement, best-ranked, an end time dropping
    // that statement alone. The Horses of Saint Mark carry nine ended
    // locations and one collection that stands; a value that has both an
    // ended and a standing statement keeps the standing one.
    let sent = '';
    const sparql: SparqlFn = (q) => { sent = q; return Promise.resolve([]); };
    await fetchEntityFacts(sparql, ['Q1994701']);
    const flat = sent.replace(/\s+/g, ' ');
    expect(flat).toContain('?e p:P276 ?st276 . ?st276 a wikibase:BestRank ; ps:P276 ?loc . FILTER NOT EXISTS { ?st276 pq:P582 ?ended }');
    expect(flat).toContain('?e p:P361 ?st361 . ?st361 a wikibase:BestRank ; ps:P361 ?parent . FILTER NOT EXISTS { ?st361 pq:P582 ?ended }');
    expect(flat).toContain('?e p:P195 ?st195 . ?st195 a wikibase:BestRank ; ps:P195 ?coll . FILTER NOT EXISTS { ?st195 pq:P582 ?ended }');
    expect(flat).not.toMatch(/wdt:P(276|361|195)/);
  });

  it('counts a maker once, and never a bare QID the label service answered with', async () => {
    const rows: SparqlBinding[] = [
      { e: ref('Q1'), creator: ref('Q5592'), creatorLabel: { value: 'Michelangelo' } },
      { e: ref('Q1'), creator: ref('Q5592'), creatorLabel: { value: 'Michelangelo' } },
      { e: ref('Q1'), creator: ref('Q999'), creatorLabel: { value: 'Q999' } },
    ];
    const facts = await fetchEntityFacts(answer(rows), ['Q1']);
    expect(facts.get('Q1')?.creators).toEqual(['Michelangelo']);
  });

  it('answers for every entity asked about, facts or none', async () => {
    const facts = await fetchEntityFacts(answer([]), ['Q1']);
    expect(facts.get('Q1')).toEqual({ classes: [], locations: [], parents: [], collections: [], creators: [] });
  });
});

describe('fetchContainerFacts', () => {
  it('reads a container as a label, its classes and what it is in turn inside', async () => {
    // Room 325 of the Louvre is a room, located in the Sully Wing: the walk
    // up to the museum needs the next step from every container.
    const rows: SparqlBinding[] = [
      { c: ref('Q12512'), cLabel: { value: "St. Peter's Basilica" }, cls: ref('Q120560') },
      { c: ref('Q12512'), cLabel: { value: "St. Peter's Basilica" }, cls: ref('Q16970') },
      { c: ref('Q19119449'), cLabel: { value: 'Room 325' }, cls: ref('Q180516') },
      { c: ref('Q19119449'), cLabel: { value: 'Room 325' }, up: ref('Q3491580') },
    ];
    const containers = await fetchContainerFacts(answer(rows), ['Q12512', 'Q19119449']);
    expect(containers.get('Q12512')).toEqual({ label: "St. Peter's Basilica", classes: ['Q120560', 'Q16970'], parents: [] });
    expect(containers.get('Q19119449')).toEqual({ label: 'Room 325', classes: ['Q180516'], parents: ['Q3491580'] });
  });

  it('does not follow a location or a whole the container has left', async () => {
    // A statement carrying an end time is a place the container was in, by the
    // rule the entity facts read a work's own under; a museum a chapel was
    // once inside must not make the chapel's work the museum's.
    let sent = '';
    const sparql: SparqlFn = (q) => { sent = q; return Promise.resolve([]); };
    await fetchContainerFacts(sparql, ['Q1']);
    const flat = sent.replace(/\s+/g, ' ');
    expect(flat).toContain('?c p:P276 ?st276 . ?st276 a wikibase:BestRank ; ps:P276 ?up . FILTER NOT EXISTS { ?st276 pq:P582 ?ended }');
    expect(flat).toContain('?c p:P361 ?st361 . ?st361 a wikibase:BestRank ; ps:P361 ?up . FILTER NOT EXISTS { ?st361 pq:P582 ?ended }');
    expect(flat).not.toMatch(/wdt:P(276|361)/);
  });

  it('names a container by its QID when the label service has no name for it', async () => {
    const rows: SparqlBinding[] = [{ c: ref('Q7'), cLabel: { value: 'Q7' }, cls: ref('Q33506') }];
    const containers = await fetchContainerFacts(answer(rows), ['Q7']);
    expect(containers.get('Q7')?.label).toBe('Q7');
  });
});
