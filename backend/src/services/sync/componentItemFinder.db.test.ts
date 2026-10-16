import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateItem } from './componentItemMatching.js';
import type { StandingPlace } from './componentItemQueries.js';

/**
 * Finding a World Heritage component's Wikidata item and proposing it (#1272),
 * against PostgreSQL, with Wikidata's answers stood in. A serial site of four
 * components: Villa Mairea, which an item says is part of the site; the fort
 * at Bologa, which an item of the site's kind stands beside; a component whose
 * only candidate a curator already refused; and one already resolved by its
 * reference, which teaches the site's kind and is never proposed again.
 */

const SITE_ITEM = 'Q98400';
const MAIREA_ITEM = 'Q98401';
const BOLOGA_ITEM = 'Q98402';
const REFUSED_ITEM = 'Q98403';
const STALE_ITEM = 'Q98404';
const RESOLVED_ITEM = 'Q98409';
const CASTRUM = 'Q88205';
/** The castrum at Gresia, whose label holds the component's place name and little else of its (#1340). */
const GRESIA_ITEM = 'Q98405';

const OTHER_SITES_PART = 'Q98410';
const parts: CandidateItem[] = [
  // A part of the site item that is another property's component: not this
  // site's candidate, however well it matches — first in the list and closest
  // to the point, so it would win the tie if the finder did not leave it out.
  { item: OTHER_SITES_PART, labels: ['Villa Mairea'], coords: [[61.5948, 21.8729]], references: ['9999-001'] },
  // The site's own component, filed on Wikidata under the inscription's
  // earlier numbering: the point says 09840bis-001, the item 9840-001 (#1344).
  // The point's number is zero-padded the way the list pads Thebes' (087-001),
  // which is still this property's number (#1393).
  { item: MAIREA_ITEM, labels: ['Villa Mairea'], coords: [[61.5949, 21.8731]], references: ['9840-001'] },
  { item: RESOLVED_ITEM, labels: ['Resolved'], coords: [[61.6, 21.9]] },
];
/** Buciumi's fort under the inscription's later numbering, which the list does not use (#1394). */
const NUMBERED_ITEM = 'Q98411';
const numbered: CandidateItem[] = [
  { item: NUMBERED_ITEM, labels: ['Buciumi'], coords: [[47.039, 23.059]], references: ['9840ter-003'] },
];
const nearby: CandidateItem[] = [
  { item: BOLOGA_ITEM, labels: ['Castra of Bologa'], coords: [[46.8851, 22.8754]], classes: [CASTRUM] },
  { item: REFUSED_ITEM, labels: ['Castra of Buciumi'], coords: [[47.0381, 23.0583]], classes: [CASTRUM] },
];

vi.mock('./componentItemQueries.js', async (importOriginal) => ({
  // The rule that tells a heavy question from a refusal is the real one.
  ...await importOriginal<typeof import('./componentItemQueries.js')>(),
  classesOfItems: vi.fn(async (items: string[]) => new Map(items.map(item => [item, item === RESOLVED_ITEM ? [CASTRUM] : []]))),
  partsOfSites: vi.fn(async () => ({ parts: new Map([[SITE_ITEM, parts.map(c => ({ ...c, labels: [] }))]]), unread: [] })),
  itemsInBoxes: vi.fn(async () => nearby.map(c => ({ ...c, labels: [] }))),
  // The class tree is QLever's to walk, not the spec's: nothing here is a settlement unless a test says so.
  settlementsAmong: vi.fn(async () => new Set<string>()),
  // Where a candidate stands is QLever's answer too: no place, unless a test names one.
  placesOf: vi.fn(async () => new Map<string, StandingPlace[]>()),
  // The items carrying a component's number: none, unless a test names them.
  componentNumbers: vi.fn(async () => [] as CandidateItem[]),
  // The register codes the proposed items carry: none, unless a test names them.
  registerCodesOf: vi.fn(async () => new Map()),
  // The labels come from Wikidata's API, read only for the items the distance leaves.
  labelsOf: vi.fn(async (items: string[]) => new Map(items.map(item => {
    const all = [...parts, ...nearby, ...numbered].find(c => c.item === item)?.labels ?? [];
    return [item, { all, english: all[0] ?? null }];
  }))),
}));

const { pool } = await import('../../db/index.js');
const queries = await import('./componentItemQueries.js');
const { SparqlUnanswered } = await import('./wikidataUtils.js');
const { findComponentItems } = await import('./componentItemFinder.js');
const { WaitBudget } = await import('./sourceRetry.js');

const SITE = 9840;
let points: Record<string, number> = {};

/** Five other sites with a resolved castrum each: the floor the catalogue-wide classes need. */
const OTHER_SITES = [9841, 9842, 9843, 9844, 9845];
const otherSiteItem = (site: number) => `Q${site}9`;
/** The place the item near Bologa stands in. */
const PLACE_ITEM = 'Q98420';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [[SITE, ...OTHER_SITES]]);
}

/** Leaves the fixture site with no resolved component, so it falls back on the classes the other sites teach. */
async function fallBack(): Promise<void> {
  await pool.query(`UPDATE experience_locations SET wikidata_item = NULL WHERE id = $1`, [points.resolved]);
  for (const site of OTHER_SITES) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, 1, $2, 'Another fixture site', ST_SetSRID(ST_MakePoint(10, 50), 4326))`,
      [site, `${site}-fixture`],
    );
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, location, wikidata_item)
       VALUES ($1, 'A resolved castrum', $2, ST_SetSRID(ST_MakePoint(10, 50), 4326), $3)`,
      [site, `${site}-001`, otherSiteItem(site)],
    );
  }
  vi.mocked(queries.classesOfItems).mockImplementation(async (items: readonly string[]) =>
    new Map(items.map(item => [item, OTHER_SITES.map(otherSiteItem).includes(item) ? [CASTRUM] : []])));
}

async function point(ref: string, name: string, lat: number, lon: number, item: string | null): Promise<number> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, wikidata_item)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6) RETURNING id`,
    [SITE, name, ref, lon, lat, item],
  );
  return row.rows[0].id;
}

const proposals = async () => (await pool.query<{
  location_id: number; wikidata_item: string; basis: string; exact: boolean; answer: string | null;
}>(
  `SELECT location_id, wikidata_item, basis, exact, answer FROM experience_component_item_proposals
    WHERE location_id = ANY($1) ORDER BY location_id, wikidata_item`,
  [Object.values(points)],
)).rows;

const run = () => findComponentItems({ write: true, hooks: { budget: new WaitBudget(1000) } });

beforeEach(async () => {
  vi.mocked(queries.itemsInBoxes).mockImplementation(async () => nearby.map(c => ({ ...c, labels: [] })));
  vi.mocked(queries.placesOf).mockReset().mockImplementation(async () => new Map<string, StandingPlace[]>());
  vi.mocked(queries.componentNumbers).mockReset().mockImplementation(async () => []);
  vi.mocked(queries.registerCodesOf).mockReset().mockImplementation(async () => new Map());
  // A test that names its own labels must not leave them to the next one.
  vi.mocked(queries.labelsOf).mockImplementation(async (items: readonly string[]) => new Map(items.map(item => {
    const all = [...parts, ...nearby, ...numbered].find(c => c.item === item)?.labels ?? [];
    return [item, { all, english: all[0] ?? null }];
  })));
  vi.mocked(queries.classesOfItems).mockImplementation(async (items: readonly string[]) =>
    new Map(items.map(item => [item, item === RESOLVED_ITEM ? [CASTRUM] : []])));
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 1, '9840-fixture', 'Component item fixture', ST_SetSRID(ST_MakePoint(21.87, 61.59), 4326))`,
    [SITE],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, wikidata_items)
     SELECT $1, s.kind_id, s.id, '9840-fixture', 'auto', NOW(), $2 FROM experience_sources s WHERE s.id = 1`,
    [SITE, [SITE_ITEM]],
  );
  points = {
    mairea: await point('09840bis-001', 'Villa Mairea', 61.5947, 21.8728, null),
    bologa: await point('9840-002', 'Bologa', 46.8853, 22.8752, null),
    buciumi: await point('9840-003', 'Buciumi', 47.0383, 23.0581, null),
    resolved: await point('9840-004', 'Resolved', 61.6, 21.9, RESOLVED_ITEM),
  };
  await pool.query(
    `INSERT INTO experience_component_item_proposals
            (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis, answer, answered_at)
     VALUES ($1, $2, 'Castra of Buciumi', 30, 0.5, false, 'near', 'refused', NOW()),
            ($3, $4, 'Something stale', 400, 0.3, false, 'near', NULL, NULL)`,
    [points.buciumi, REFUSED_ITEM, points.bologa, STALE_ITEM],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('findComponentItems', () => {
  it("proposes the site's own part — under whatever numbering Wikidata files it — and an item of its kind beside a point, and nothing a curator refused, nor another property's part", async () => {
    await run();

    expect(await proposals()).toEqual([
      { location_id: points.mairea, wikidata_item: MAIREA_ITEM, basis: 'part_of', exact: true, answer: null },
      { location_id: points.bologa, wikidata_item: BOLOGA_ITEM, basis: 'near', exact: false, answer: null },
      { location_id: points.buciumi, wikidata_item: REFUSED_ITEM, basis: 'near', exact: false, answer: 'refused' },
    ]);
  });

  it("proposes by a place name of the component's where the name rule finds nothing, with the item's register code (#1340)", async () => {
    vi.mocked(queries.itemsInBoxes).mockImplementation(async () => [
      { item: BOLOGA_ITEM, labels: [], coords: [[46.8851, 22.8754]], classes: [CASTRUM] },
      { item: GRESIA_ITEM, labels: [], coords: [[44.166667, 24.916667]], classes: [CASTRUM] },
    ]);
    vi.mocked(queries.labelsOf).mockImplementation(async (items: readonly string[]) => new Map(items.map(item => {
      const all = item === GRESIA_ITEM ? ['Castrul roman de la Gresia'] : [...parts, ...nearby].find(c => c.item === item)?.labels ?? [];
      return [item, { all, english: all[0] ?? null }];
    })));
    vi.mocked(queries.registerCodesOf).mockImplementation(async () => new Map([
      [GRESIA_ITEM, [{ property: 'P1770', code: 'TR-I-s-B-14205' }]],
      [BOLOGA_ITEM, [{ property: 'P1770', code: 'CJ-I-s-A-07104' }]],
    ]));
    const gresia = await point('9840-005', 'Gresia - La Biserică', 44.1666666667, 24.9166666667, null);

    await run();

    const row = (await pool.query(
      `SELECT basis, register_code, register_disagrees FROM experience_component_item_proposals WHERE location_id = $1`, [gresia],
    )).rows;
    expect(row).toEqual([{ basis: 'toponym', register_code: 'LMI TR-I-s-B-14205', register_disagrees: false }]);
  });

  it('writes its proposals without codes when the register read fails, whatever the failure', async () => {
    vi.mocked(queries.registerCodesOf).mockRejectedValue(new Error('the wait budget is spent'));

    await run();

    const rows = (await pool.query(
      `SELECT wikidata_item, register_code FROM experience_component_item_proposals WHERE location_id = $1`, [points.bologa],
    )).rows;
    expect(rows).toEqual([{ wikidata_item: BOLOGA_ITEM, register_code: null }]);
  });

  it("narrowed to one site, asks about and writes that site's points only (#1429)", async () => {
    // Another site of the source, with a component of its own: a pass narrowed to it
    // leaves the fixture site's stale proposal and its points alone.
    const other = OTHER_SITES[0];
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, 1, $2, 'Another fixture site', ST_SetSRID(ST_MakePoint(10, 50), 4326))`,
      [other, `${other}-fixture`],
    );
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at, wikidata_items)
       SELECT $1, s.kind_id, s.id, $2, 'auto', NOW(), $3 FROM experience_sources s WHERE s.id = 1`,
      [other, `${other}-fixture`, [otherSiteItem(other)]],
    );
    vi.mocked(queries.partsOfSites).mockClear();

    const narrowed = await findComponentItems({ write: true, siteId: other, hooks: { budget: new WaitBudget(1000) } });

    expect(narrowed.report.points).toBe(0);
    expect(vi.mocked(queries.partsOfSites).mock.calls[0][0]).not.toContain(SITE_ITEM);
    expect((await proposals()).map(p => p.wikidata_item)).toEqual([STALE_ITEM, REFUSED_ITEM]);

    await findComponentItems({ write: true, siteId: SITE, hooks: { budget: new WaitBudget(1000) } });
    expect((await proposals()).map(p => p.wikidata_item)).toEqual([MAIREA_ITEM, BOLOGA_ITEM, REFUSED_ITEM]);
  });

  it('writes nothing on a dry pass', async () => {
    const { matches } = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });

    expect(matches.filter(m => Object.values(points).includes(m.locationId)).map(m => m.item).sort())
      .toEqual([MAIREA_ITEM, BOLOGA_ITEM]);
    expect((await proposals()).map(p => p.wikidata_item)).toEqual([STALE_ITEM, REFUSED_ITEM]);
  });

  it('rewrites a taken-back candidate it finds again, mark kept, and drops one it no longer finds (#1336)', async () => {
    await pool.query(
      `INSERT INTO experience_component_item_proposals
              (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis, taken_back_at)
       VALUES ($1, $2, 'Castra of Bologa, as first found', 900, 0.1, false, 'near', NOW() - interval '1 day'),
              ($1, 'Q9840999', 'An item the pass no longer finds', 400, 0.3, false, 'near', NOW() - interval '1 day')`,
      [points.bologa, BOLOGA_ITEM],
    );

    await run();

    const rows = (await pool.query<{ wikidata_item: string; item_label: string; distance_m: number; marked: boolean }>(
      `SELECT wikidata_item, item_label, distance_m, taken_back_at IS NOT NULL AS marked
         FROM experience_component_item_proposals WHERE location_id = $1 ORDER BY wikidata_item`,
      [points.bologa],
    )).rows;
    expect(rows).toEqual([{ wikidata_item: BOLOGA_ITEM, item_label: 'Castra of Bologa', distance_m: expect.any(Number), marked: true }]);
    expect(rows[0].distance_m).toBeLessThan(100);
  });

  it('keeps its answer on a second pass rather than adding to it', async () => {
    await run();
    await run();

    expect((await proposals()).filter(p => p.answer === null)).toHaveLength(2);
  });

  it('asks one area at a time where the service cannot answer several, and counts an area it cannot answer at all', async () => {
    // Bologa and Buciumi lie in different cells. Asked together the service
    // times out; asked alone it answers for Bologa and times out on Buciumi.
    vi.mocked(queries.itemsInBoxes).mockImplementation(async (boxes) => {
      if (boxes.length > 1 || boxes[0].south > 46.95) throw new SparqlUnanswered('Wikidata SPARQL error 504: gateway timeout');
      return nearby.map(c => ({ ...c, labels: [] }));
    });

    const { report, matches } = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });

    expect(report.unsearched).toBeGreaterThanOrEqual(1);
    expect(matches.map(m => m.item)).toContain(BOLOGA_ITEM);
  });

  it('stops when the service says to stop, rather than asking it smaller questions', async () => {
    const asked = vi.mocked(queries.itemsInBoxes);
    asked.mockClear();
    asked.mockRejectedValue(new Error('Wikidata SPARQL error 429: too many requests'));

    await expect(run()).rejects.toThrow(/429/);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("keeps an earlier pass's proposal for a point whose surroundings the service could not answer", async () => {
    // Buciumi's cell times out, alone and with the others: the open proposal an
    // earlier pass made for it stands, where Bologa's stale one is replaced.
    await pool.query(
      `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q98405', 'Castra of Buciumi (earlier pass)', 40, 0.6, false, 'near')`,
      [points.buciumi],
    );
    vi.mocked(queries.itemsInBoxes).mockImplementation(async (boxes) => {
      if (boxes.length > 1 || boxes[0].south > 46.95) throw new SparqlUnanswered('Wikidata SPARQL error 504: gateway timeout');
      return nearby.map(c => ({ ...c, labels: [] }));
    });

    await run();

    const open = (await proposals()).filter(p => p.answer === null).map(p => p.wikidata_item);
    expect(open).toContain('Q98405');
    expect(open).toContain(BOLOGA_ITEM);
    expect(open).not.toContain(STALE_ITEM);
  });

  it('sets a village aside before choosing, so the next candidate is taken, and counts it', async () => {
    // The tree names Bologa's first candidate a village; the castrum beside it is taken instead.
    const VILLAGE_ITEM = 'Q98406';
    vi.mocked(queries.itemsInBoxes).mockImplementation(async () => [
      { item: VILLAGE_ITEM, labels: [], coords: [[46.8852, 22.8753]], classes: [CASTRUM] },
      ...nearby.map(c => ({ ...c, labels: [] })),
    ]);
    vi.mocked(queries.labelsOf).mockImplementation(async (items: readonly string[]) => new Map(items.map(item => {
      const all = item === VILLAGE_ITEM ? ['Bologa'] : ([...parts, ...nearby].find(c => c.item === item)?.labels ?? []);
      return [item, { all, english: all[0] ?? null }];
    })));
    vi.mocked(queries.settlementsAmong).mockImplementation(async (ids: readonly string[], _hooks, asClasses) =>
      new Set(asClasses ? [] : ids.filter(id => id === VILLAGE_ITEM)));

    const { report, matches } = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });

    expect(matches.find(m => m.locationId === points.bologa)?.item).toBe(BOLOGA_ITEM);
    expect(report.settlements).toBe(1);
  });

  it("clears an earlier pass's open proposal for a point that stands for its whole site", async () => {
    // A site of one standing point: its only component is the site itself.
    await pool.query(`UPDATE experience_locations SET missing_since = NOW() WHERE id = ANY($1)`,
      [[points.bologa, points.buciumi, points.resolved]]);
    await pool.query(
      `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q98407', 'A building inside', 30, 0.5, false, 'near')`,
      [points.mairea],
    );

    const { report } = await run();

    expect(report.wholeSites).toBe(1);
    expect((await proposals()).filter(p => p.location_id === points.mairea && p.answer === null)).toHaveLength(0);
  });

  it('sets aside, on a site with no resolved component, a contender standing in a place named like the component, and counts it (#1349)', async () => {
    await fallBack();
    // Wikidata says the item near Bologa stands in Bologa, and it is not named "Bologa" itself;
    // the place states no coordinate, so it cannot be offered in its stead.
    vi.mocked(queries.placesOf).mockImplementation(async (items: readonly string[]) => new Map(items
      .filter(item => item === BOLOGA_ITEM)
      .map(item => [item, [{ item: PLACE_ITEM, names: ['Bologa'], coords: [], referenced: false }]])));

    const { report, matches } = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });

    // Asked only about what the near rule would take: the castra, not the whole neighbourhood.
    const asked = vi.mocked(queries.placesOf).mock.calls.flatMap(([items]) => [...items]);
    expect(asked).toContain(BOLOGA_ITEM);
    expect(asked).not.toContain(STALE_ITEM);
    expect(matches.find(m => m.locationId === points.bologa)).toBeUndefined();
    expect(report.atTheComponent).toBe(1);
  });

  it('offers the place a thing at the component stands in, in its stead, unless it carries a World Heritage reference (#1349)', async () => {
    await fallBack();
    const at = (referenced: boolean) => vi.mocked(queries.placesOf).mockImplementation(async (items: readonly string[]) => new Map(items
      .filter(item => item === BOLOGA_ITEM)
      .map(item => [item, [{ item: PLACE_ITEM, names: ['Bologa'], coords: [[46.8856, 22.8749]], referenced }]])));

    at(false);
    const offered = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });
    expect(offered.matches.find(m => m.locationId === points.bologa)).toMatchObject({ item: PLACE_ITEM, basis: 'near' });

    // A place with a reference of its own is the reference reader's to find, never the near rule's.
    at(true);
    const kept = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });
    expect(kept.matches.find(m => m.locationId === points.bologa)).toBeUndefined();

    // Nor a settlement: the village a thing at the component stands in is not the component.
    at(false);
    vi.mocked(queries.settlementsAmong).mockImplementation(async (ids: readonly string[], _hooks, asClasses) =>
      new Set(asClasses ? [] : ids.filter(id => id === PLACE_ITEM)));
    const village = await findComponentItems({ write: false, hooks: { budget: new WaitBudget(1000) } });
    expect(village.matches.find(m => m.locationId === points.bologa)).toBeUndefined();
    expect(vi.mocked(queries.settlementsAmong).mock.calls.some(([ids]) => ids.includes(PLACE_ITEM))).toBe(true);
  });

  it('leaves those points unanswered when QLever cannot say where their contenders stand', async () => {
    await fallBack();
    await pool.query(
      `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q98408', 'An earlier pass found this', 40, 0.5, false, 'near')`,
      [points.bologa],
    );
    vi.mocked(queries.placesOf).mockRejectedValue(new SparqlUnanswered('QLever error 503'));

    const { report } = await run();

    expect(report.near).toBe(0);
    expect(report.unsearched).toBeGreaterThan(0);
    const open = (await proposals()).filter(p => p.location_id === points.bologa && p.answer === null).map(p => p.wikidata_item);
    expect(open).toContain('Q98408');
  });

  it('leaves a site with no resolved components unsearched when QLever cannot say which classes are settlements', async () => {
    // Bologa's site has resolved components (its classes are its own); a site with none
    // falls back on the catalogue's classes, which need the tree's answer to be usable.
    await pool.query(`UPDATE experience_locations SET wikidata_item = NULL WHERE id = $1`, [points.resolved]);
    await pool.query(
      `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, 'Q98408', 'An earlier pass found this', 40, 0.5, false, 'near')`,
      [points.bologa],
    );
    vi.mocked(queries.settlementsAmong).mockImplementation(async (_ids, _hooks, asClasses) => {
      if (asClasses) throw new SparqlUnanswered('QLever error 503');
      return new Set<string>();
    });

    vi.mocked(queries.itemsInBoxes).mockClear();
    const { report } = await run();

    // Not searched at all: no area question goes out for the site, rather than one
    // with the settlement rule quietly off. (The fixture's one site is below the
    // catalogue-wide class floor, so `near === 0` alone would hold either way.)
    expect(vi.mocked(queries.itemsInBoxes)).not.toHaveBeenCalled();
    // Every point the part rule left is one of this site's, and none of them was searched.
    expect(report.unsearched).toBe(report.points - report.partOf);
    expect(report.unsearched).toBeGreaterThan(0);
    expect(report.near).toBe(0);
    // Left unanswered, the point keeps every open proposal it had: the earlier pass's and the stale one from the fixture.
    const open = (await proposals()).filter(p => p.location_id === points.bologa && p.answer === null).map(p => p.wikidata_item);
    expect(open).toContain('Q98408');
    expect(open).toContain(STALE_ITEM);
  });

  it("proposes an item carrying the point's number under another inscription beside the other doors' answers (#1394)", async () => {
    vi.mocked(queries.componentNumbers).mockImplementation(async () => numbered.map(c => ({ ...c, labels: [] })));

    const { report } = await run();

    expect(report.numbered).toBe(1);
    expect((await proposals()).filter(p => p.location_id === points.buciumi)).toEqual([
      { location_id: points.buciumi, wikidata_item: REFUSED_ITEM, basis: 'near', exact: false, answer: 'refused' },
      { location_id: points.buciumi, wikidata_item: NUMBERED_ITEM, basis: 'numbered', exact: false, answer: null },
    ]);
  });

  it("keeps an earlier pass's numbered proposals when the numbers could not be read", async () => {
    await pool.query(
      `INSERT INTO experience_component_item_proposals (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       VALUES ($1, $2, 'Buciumi', 90, 1, false, 'numbered')`,
      [points.buciumi, NUMBERED_ITEM],
    );
    vi.mocked(queries.componentNumbers).mockRejectedValue(new SparqlUnanswered('Wikidata SPARQL error 504: gateway timeout'));

    const { report } = await run();

    expect(report.numbered).toBe(0);
    expect((await proposals()).some(p => p.location_id === points.buciumi && p.wikidata_item === NUMBERED_ITEM && p.answer === null)).toBe(true);
  });
});
