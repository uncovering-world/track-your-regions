/**
 * The report decides where each expectation stands and what follows for the
 * kinds, from facts a query read. These hold the decisions on hand-made facts,
 * and hold the statements to the reader predicates they compose; which rows the
 * statements select is asked of a real database in `report.db.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { MEMBERSHIPS } from '../../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { countedMembershipSql } from '../../experience/experienceCounts.js';
import { venuesShowingSql } from '../../experience/siteFinds.js';
import { buildCoverageReport } from './report.js';
import { coverageSql, type CoverageFacts, type ExpectationRow, type KindRow } from './reportQueries.js';
import { renderCoverageReport } from './reportText.js';

const kind = (over: Partial<KindRow>): KindRow => ({
  slug: 'archaeology', name: 'Archaeology', form: 'place', status: 'live', experience_kind_id: 5, issue_number: null,
  in_venue: false, enter_sitelinks: 22, ...over,
});
const KINDS: KindRow[] = [
  kind({}),
  kind({ slug: 'world-heritage', name: 'World Heritage Sites', experience_kind_id: 1, enter_sitelinks: null }),
  kind({ slug: 'art-museums', name: 'Art Museums', experience_kind_id: 2, enter_sitelinks: null }),
  kind({ slug: 'public-art', name: 'Public Art & Monuments', experience_kind_id: 3, enter_sitelinks: null }),
  kind({ slug: 'notable-works', name: 'Notable works', form: 'work', experience_kind_id: null, in_venue: true, enter_sitelinks: null }),
  kind({ slug: 'markets', name: 'Markets', status: 'proposed', experience_kind_id: null, enter_sitelinks: null }),
  kind({ slug: 'festivals-and-events', name: 'Festivals & events', form: 'event', status: 'proposed', experience_kind_id: null, issue_number: 1300, enter_sitelinks: null }),
  kind({ slug: 'beaches-and-swimming', name: 'Beaches', status: 'proposed', experience_kind_id: null, enter_sitelinks: null }),
];

const entry = (slug: string, over: Partial<ExpectationRow> = {}): ExpectationRow => ({
  region_slug: 'cusco-region', slug, name: slug, type: 'place', source_count: 2, sitelinks: null,
  kinds: ['archaeology'], ...over,
});

const facts = (over: Partial<CoverageFacts>): CoverageFacts => ({
  kinds: KINDS,
  regions: [{ slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-01' }],
  expectations: [],
  matches: [],
  nearby: [],
  ...over,
});
const at = (slug: string) => ({ region_slug: 'cusco-region', slug });
const verdictOf = (report: ReturnType<typeof buildCoverageReport>, slug: string) =>
  report.expectations.find(result => result.slug === slug)?.verdict;

describe('where an expectation stands', () => {
  const report = buildCoverageReport(facts({
    expectations: [
      entry('machu-picchu'), entry('pending-dig'), entry('cusco-cathedral'), entry('moray'), entry('san-pedro-market', { kinds: ['markets'] }),
      entry('inti-raymi', { type: 'event', kinds: ['festivals-and-events'] }),
      entry('dome-climb', { type: 'activity', kinds: [] }),
      entry('plaza', { kinds: ['markets'] }),
      entry('mask', { type: 'work', kinds: ['notable-works'] }),
    ],
    matches: [
      { ...at('machu-picchu'), catalogue_name: 'Machu Picchu', kind_id: 5, offered: true },
      { ...at('machu-picchu'), catalogue_name: 'Historic Sanctuary of Machu Picchu', kind_id: 1, offered: true },
      { ...at('pending-dig'), catalogue_name: 'A dig nobody read yet', kind_id: 5, offered: false },
    ],
    nearby: [
      { ...at('cusco-cathedral'), place: 'City of Cuzco', point: 'Main Square', metres: 78 },
      { ...at('cusco-cathedral'), place: 'City of Cuzco', point: 'Main Square', metres: 78 },
      { ...at('plaza'), place: 'City of Cuzco', point: 'Main Square', metres: 10 },
      { ...at('mask'), place: 'Museo Inka', point: '', metres: 0 },
    ],
  }));

  it('is offered when a row its identifiers match is offered, whatever else matches', () => {
    expect(verdictOf(report, 'machu-picchu')).toBe('offered');
  });

  it('is held when the catalogue has it and no reader sees it', () => {
    expect(verdictOf(report, 'pending-dig')).toBe('held');
  });

  it('is at the same spot when a live kind should hold it and an offered place stands there, named once', () => {
    const cathedral = report.expectations.find(result => result.slug === 'cusco-cathedral');
    expect(cathedral?.verdict).toBe('same_spot');
    expect(cathedral?.nearby).toEqual([{ place: 'City of Cuzco', point: 'Main Square', metres: 78 }]);
  });

  it('is missing from a live kind when nothing stands at its spot', () => {
    expect(verdictOf(report, 'moray')).toBe('missing_live');
  });

  it('is missing from a proposed kind whatever stands beside it: a square by a cathedral is a neighbour', () => {
    expect(verdictOf(report, 'san-pedro-market')).toBe('missing_proposed');
    expect(verdictOf(report, 'plaza')).toBe('missing_proposed');
    expect(verdictOf(report, 'inti-raymi')).toBe('missing_proposed');
  });

  it('never asks a work what stands at its spot: it is at its venue by definition', () => {
    expect(verdictOf(report, 'mask')).toBe('missing_live');
  });

  it('is unsorted when it is filed under no kind', () => {
    expect(verdictOf(report, 'dome-climb')).toBe('unsorted');
  });

  it('counts each region by verdict', () => {
    expect(report.regions[0]).toMatchObject({
      total: 9,
      counts: { offered: 1, held: 1, same_spot: 1, missing_live: 2, missing_proposed: 3, unsorted: 1 },
    });
  });
});

describe('what the surveys expect of a proposed kind', () => {
  const report = buildCoverageReport(facts({
    regions: [
      { slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-01' },
      { slug: 'sydney', name: 'Sydney', country: 'Australia', surveyed: '2026-10-01' },
    ],
    expectations: [
      entry('san-pedro-market', { kinds: ['markets'], source_count: 4 }),
      entry('pisac-market', { kinds: ['markets'], source_count: 3 }),
      entry('paddys-markets', { region_slug: 'sydney', kinds: ['markets'], source_count: 2 }),
      entry('bondi', { region_slug: 'sydney', kinds: ['beaches-and-swimming'], source_count: 5 }),
      entry('manly', { region_slug: 'sydney', kinds: ['beaches-and-swimming'], source_count: 4 }),
      entry('bronte', { region_slug: 'sydney', kinds: ['beaches-and-swimming'], source_count: 3 }),
      entry('coogee', { region_slug: 'sydney', kinds: ['beaches-and-swimming'], source_count: 3 }),
      entry('inti-raymi', { type: 'event', kinds: ['festivals-and-events'] }),
      entry('old-town', { kinds: ['world-heritage', 'markets'] }),
    ],
    matches: [{ ...at('old-town'), catalogue_name: 'City of Cuzco', kind_id: 1, offered: true }],
  }));

  it('orders by the regions that ask for it before the number of entries', () => {
    expect(report.proposedKinds.map(demand => [demand.slug, demand.expected, demand.regions])).toEqual([
      ['markets', 4, 2],
      ['beaches-and-swimming', 4, 1],
      ['festivals-and-events', 1, 1],
    ]);
  });

  it('gives a kind of festival its place beside the kinds of place, with what it holds and its issue', () => {
    expect(report.proposedKinds.find(demand => demand.slug === 'festivals-and-events'))
      .toMatchObject({ form: 'event', issue: 1300, examples: ['inti-raymi'] });
  });

  it('says how much of the demand a reader already sees through another kind', () => {
    expect(report.proposedKinds[0].offeredElsewhere).toBe(1);
  });

  it('names the most named first', () => {
    expect(report.proposedKinds[1].examples).toEqual(['bondi', 'manly', 'bronte', 'coogee']);
  });

  it('leaves out a proposed kind nothing is filed under', () => {
    const empty = buildCoverageReport(facts({ expectations: [entry('moray')] }));
    expect(empty.proposedKinds).toEqual([]);
  });
});

describe('what a live kind lacks', () => {
  const report = buildCoverageReport(facts({
    expectations: [
      entry('machu-picchu', { sitelinks: 150 }),
      entry('ollantaytambo', { sitelinks: 40 }),
      entry('moray', { sitelinks: 18 }),
      entry('coricancha', { sitelinks: 29 }),
      entry('cuzco', { kinds: ['world-heritage'] }),
      entry('soumaya', { kinds: ['art-museums'], sitelinks: 31 }),
      entry('house-museum', { kinds: ['art-museums'], sitelinks: 4 }),
      entry('obelisk', { kinds: ['public-art'], sitelinks: 25 }),
      entry('fountain', { kinds: ['public-art'], sitelinks: 6 }),
      entry('mask', { type: 'work', kinds: ['notable-works'], sitelinks: 30 }),
      entry('tunic', { type: 'work', kinds: ['notable-works'], sitelinks: 3 }),
    ],
    matches: [
      { ...at('machu-picchu'), catalogue_name: 'Machu Picchu', kind_id: 5, offered: true },
      // Offered as a place of worship, and so still absent from Archaeology.
      { ...at('coricancha'), catalogue_name: 'Coricancha', kind_id: 4, offered: true },
      { ...at('tunic'), catalogue_name: 'Tunic', kind_id: null, offered: true },
    ],
  }));
  const gaps = (slug: string) => report.liveKinds.find(live => live.slug === slug);

  it('names what is absent from the kind at or over its own line, and counts the rest', () => {
    expect(gaps('archaeology')).toMatchObject({ line: 22, expected: 4, offered: 1, belowLineMissing: 1 });
    expect(gaps('archaeology')?.wellKnownMissing.map(missing => [missing.name, missing.verdict])).toEqual([
      ['ollantaytambo', 'missing_live'],
      ['coricancha', 'offered'],
    ]);
  });

  it('names every absent property of World Heritage, which has no line', () => {
    expect(gaps('world-heritage')).toMatchObject({ line: null, expected: 1, offered: 0, belowLineMissing: 0 });
    expect(gaps('world-heritage')?.wellKnownMissing.map(missing => missing.name)).toEqual(['cuzco']);
  });

  it('names every absent museum: Art Museums admits by a work a museum holds, not by the museum\'s own sitelinks', () => {
    expect(gaps('art-museums')).toMatchObject({ line: null, expected: 2, offered: 0, belowLineMissing: 0 });
    expect(gaps('art-museums')?.wellKnownMissing.map(missing => missing.name)).toEqual(['soumaya', 'house-museum']);
  });

  it('holds a monument and a work to the line their code states', () => {
    expect(gaps('public-art')).toMatchObject({ line: 22, expected: 2, offered: 0, belowLineMissing: 1 });
    expect(gaps('public-art')?.wellKnownMissing.map(missing => missing.name)).toEqual(['obelisk']);
    expect(gaps('notable-works')).toMatchObject({ line: 22 });
  });

  it('counts a work offered wherever the catalogue shows it', () => {
    expect(gaps('notable-works')).toMatchObject({ expected: 2, offered: 1 });
    expect(gaps('notable-works')?.wellKnownMissing.map(missing => missing.name)).toEqual(['mask']);
  });
});

describe('the statements', () => {
  const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

  it('call a place offered by the predicate a kind\'s count uses, and a work by the one its venue list uses', () => {
    const sql = collapse(coverageSql.MATCHES_SQL);
    expect(sql).toContain(`JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id`);
    expect(sql).toContain(collapse(`(${countedMembershipSql('m', 'e')}) AS offered`));
    expect(sql).toContain(collapse(`(${publishedContentSql('t')} AND EXISTS (SELECT 1 ${venuesShowingSql('t')})) AS offered`));
  });

  it('match by identifier alone: the entry\'s Wikidata id, the ids named as the same place, UNESCO\'s id', () => {
    const sql = collapse(coverageSql.MATCHES_SQL);
    expect(sql).toContain('x.wikidata_id AS id');
    expect(sql).toContain('unnest(x.same_as) AS same(id)');
    expect(sql).toContain('SELECT x.region_slug, x.slug, x.unesco_id');
    expect(sql).toContain('JOIN experiences e ON e.external_id = ids.id');
    expect(sql).toContain('JOIN treasures t ON t.external_id = ids.id');
    expect(sql).not.toMatch(/\bname\s*=|ILIKE|similarity\(/i);
  });

  it('count as standing at the spot only an offered point of an offered place', () => {
    const sql = collapse(coverageSql.NEARBY_SQL);
    expect(sql).toContain(collapse(offeredLocationSql('el')));
    expect(sql).toContain(collapse(publishedContentSql('el')));
    expect(sql).toContain(collapse(`m.experience_id = e.id AND ${countedMembershipSql('m', 'e')}`));
  });
});

describe('the report as text', () => {
  it('says the share offered, each region, each proposed kind with its issue, and what a person must judge', () => {
    const text = renderCoverageReport(buildCoverageReport(facts({
      expectations: [
        entry('Machu Picchu'), entry('Cusco Cathedral'), entry('Inti Raymi', { type: 'event', kinds: ['festivals-and-events'] }),
        entry('Climbing the dome', { type: 'activity', kinds: [] }),
      ],
      matches: [{ region_slug: 'cusco-region', slug: 'Machu Picchu', catalogue_name: 'Machu Picchu', kind_id: 5, offered: true }],
      nearby: [{ region_slug: 'cusco-region', slug: 'Cusco Cathedral', place: 'City of Cuzco', point: 'Main Square', metres: 78 }],
    })));

    expect(text).toContain('Catalogue coverage: 1 of 4 expected things are offered to a reader (25%), across 1 surveyed region(s).');
    expect(text).toContain('Cusco region, Peru (surveyed 2026-10-01): 4 expected, 1 offered (25%)');
    expect(text).toContain('Festivals & events [festivals-and-events; holds: event; #1300]');
    expect(text).toContain('cusco-region: Cusco Cathedral -> City of Cuzco / Main Square (78 m)');
    expect(text).toContain('cusco-region: Climbing the dome [activity]');
  });

  it('says of a proposed kind that it exists only inside a place', () => {
    const text = renderCoverageReport(buildCoverageReport(facts({
      kinds: [...KINDS, kind({
        slug: 'on-site-activities', name: 'On-site activities', form: 'activity', status: 'proposed', experience_kind_id: null,
        in_venue: true, enter_sitelinks: null,
      })],
      expectations: [entry('Climbing the dome', { type: 'activity', kinds: ['on-site-activities'] })],
    })));

    expect(text).toContain('On-site activities [on-site-activities; holds: activity, inside a place; no issue]');
  });
});
