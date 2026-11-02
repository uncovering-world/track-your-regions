/**
 * The report decides where each expectation stands and what follows for the
 * kinds, from facts a query read. These hold the decisions on hand-made facts,
 * and hold the statements to the reader predicates they compose; which rows the
 * statements select is asked of a real database in `report.db.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { MEMBERSHIPS, membershipAdmittedSql, membershipCrowdedSql, membershipVisibleSql, realKindSql } from '../../../db/membership.js';
import { hideLostSql, offeredLocationSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { countedMembershipSql } from '../../experience/experienceCounts.js';
import { venuesShowingSql } from '../../experience/siteFinds.js';
import { MEASURED_BARS } from '../../../services/sync/places/admissionRegister.js';
import { buildCoverageReport } from './report.js';
import { coverageSql, type CalibrationRow, type CoverageFacts, type ExpectationRow, type JudgementRow, type KindRow } from './reportQueries.js';
import { renderCoverageReport } from './reportText.js';

const kind = (over: Partial<KindRow>): KindRow => ({
  slug: 'archaeology', name: 'Archaeology', form: 'place', status: 'live', experience_kind_id: 5, issue_number: null,
  in_venue: false, enter_sitelinks: 22, find_enter_sitelinks: null, crowding_limit: null, crowding_radius_km: null, crowding_exempt_types: [], ...over,
});
const KINDS: KindRow[] = [
  kind({}),
  kind({ slug: 'world-heritage', name: 'World Heritage Sites', experience_kind_id: 1, enter_sitelinks: null }),
  kind({ slug: 'art-museums', name: 'Art Museums', experience_kind_id: 2, enter_sitelinks: null }),
  kind({ slug: 'public-art', name: 'Public art', experience_kind_id: 3, enter_sitelinks: null }),
  kind({ slug: 'notable-works', name: 'Notable works', form: 'work', experience_kind_id: null, in_venue: true, enter_sitelinks: null }),
  kind({ slug: 'markets', name: 'Markets', status: 'proposed', experience_kind_id: null, enter_sitelinks: null }),
  kind({ slug: 'festivals-and-events', name: 'Festivals & events', form: 'event', status: 'proposed', experience_kind_id: null, issue_number: 1300, enter_sitelinks: null }),
  kind({ slug: 'beaches-and-swimming', name: 'Beaches', status: 'proposed', experience_kind_id: null, enter_sitelinks: null }),
];

const entry = (slug: string, over: Partial<ExpectationRow> = {}): ExpectationRow => ({
  region_slug: 'cusco-region', slug, name: slug, type: 'place', source_count: 2, sitelinks: null,
  kinds: ['archaeology'], kind_types: {}, lat: null, lon: null, ...over,
});

const facts = (over: Partial<CoverageFacts>): CoverageFacts => ({
  kinds: KINDS,
  regions: [{ slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-01' }],
  expectations: [],
  matches: [],
  nearby: [],
  judgements: [],
  unnamed: [],
  calibration: [],
  calibrationSources: [],
  ...over,
});
const top = (slug: string, over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  kind_slug: 'archaeology', slug, name: slug, wikidata_id: `Q${slug.length}${slug.charCodeAt(0)}`, sitelinks: 40, sources: ['coverage-surveys'],
  offered: false, admitted: false, crowded: false, held_as: null, refused_for: null, ...over,
});
const judged = (slug: string, cause: string, issue: number | null, over: Partial<JudgementRow> = {}): JudgementRow => ({
  region_slug: 'cusco-region', entry_slug: slug, kind_slug: 'archaeology', row_wikidata_id: null, cause, issue_number: issue, judged: '2026-10-16',
  note: `Judged ${slug}.`, ...over,
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
      { ...at('machu-picchu'), catalogue_name: 'Machu Picchu', kind_id: 5, offered: true, shadowed: false },
      { ...at('machu-picchu'), catalogue_name: 'Historic Sanctuary of Machu Picchu', kind_id: 1, offered: true, shadowed: false },
      { ...at('pending-dig'), catalogue_name: 'A dig nobody read yet', kind_id: 5, offered: false, shadowed: false },
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
    matches: [{ ...at('old-town'), catalogue_name: 'City of Cuzco', kind_id: 1, offered: true, shadowed: false }],
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
      { ...at('machu-picchu'), catalogue_name: 'Machu Picchu', kind_id: 5, offered: true, shadowed: false },
      // Offered as a place of worship, and so still absent from Archaeology.
      { ...at('coricancha'), catalogue_name: 'Coricancha', kind_id: 4, offered: true, shadowed: false },
      { ...at('tunic'), catalogue_name: 'Tunic', kind_id: null, offered: true, shadowed: false },
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

  it('holds a work of public art to the editions bar the register measured, and a work to the line its code states', () => {
    // Public art's editions bar as ADR-0175's review measured it: the fountain in 6 editions is under it.
    expect(gaps('public-art')).toMatchObject({ line: MEASURED_BARS.value['public-art'].editions, expected: 2, offered: 0, belowLineMissing: 1 });
    expect(gaps('public-art')?.wellKnownMissing.map(missing => missing.name)).toEqual(['obelisk']);
    expect(gaps('notable-works')).toMatchObject({ line: 22 });
  });

  it('counts a work offered wherever the catalogue shows it', () => {
    expect(gaps('notable-works')).toMatchObject({ expected: 2, offered: 1 });
    expect(gaps('notable-works')?.wellKnownMissing.map(missing => missing.name)).toEqual(['mask']);
  });

  it('carries no judgement and counts none where the ledger has no line', () => {
    expect(gaps('archaeology')?.wellKnownMissing.map(missing => missing.judgement)).toEqual([null, null]);
    expect(gaps('archaeology')?.judgedByCause).toEqual([]);
    expect(report.staleJudgements).toEqual([]);
  });
});

describe('what a person has judged', () => {
  const report = buildCoverageReport(facts({
    expectations: [
      entry('machu-picchu', { sitelinks: 150 }),
      entry('ollantaytambo', { sitelinks: 40 }),
      entry('pisac', { sitelinks: 28 }),
      entry('moray', { sitelinks: 18 }),
      // Filed under two live kinds, offered by one: a gap per kind, judged apart.
      entry('arch', { kinds: ['archaeology', 'public-art'], sitelinks: 49 }),
      entry('soumaya', { kinds: ['art-museums'], sitelinks: 31 }),
      entry('house-museum', { kinds: ['art-museums'], sitelinks: 4 }),
      entry('gallery', { kinds: ['art-museums'], sitelinks: 2 }),
    ],
    matches: [
      { ...at('machu-picchu'), catalogue_name: 'Machu Picchu', kind_id: 5, offered: true, shadowed: false },
      { ...at('arch'), catalogue_name: 'Arch', kind_id: 5, offered: true, shadowed: false },
    ],
    judgements: [
      judged('ollantaytambo', 'rule-defect', 1160),
      judged('moray', 'rule-defect', 1160),
      judged('arch', 'offered-elsewhere', null, { kind_slug: 'public-art' }),
      judged('soumaya', 'door-missing', 628, { kind_slug: 'art-museums' }),
      judged('house-museum', 'door-missing', 628, { kind_slug: 'art-museums', judged: '2026-10-01' }),
      judged('gallery', 'not-a-must', null, { kind_slug: 'art-museums' }),
      // Judged when it was absent; the kind offers it now.
      judged('machu-picchu', 'rule-defect', 1160),
      judged('', 'not-a-must', null, { entry_slug: null, kind_slug: null, row_wikidata_id: 'Q96000099' }),
    ],
  }));
  const gaps = (slug: string) => report.liveKinds.find(live => live.slug === slug);

  it('puts the ledger\'s line on the gap it judges, and leaves an unjudged one bare', () => {
    expect(gaps('archaeology')?.wellKnownMissing.map(missing => [missing.slug, missing.judgement?.cause ?? null])).toEqual([
      ['ollantaytambo', 'rule-defect'],
      ['pisac', null],
    ]);
    expect(gaps('art-museums')?.wellKnownMissing.map(missing => missing.judgement)).toEqual([
      { cause: 'door-missing', issue: 628, judged: '2026-10-16', note: 'Judged soumaya.' },
      { cause: 'door-missing', issue: 628, judged: '2026-10-01', note: 'Judged house-museum.' },
      { cause: 'not-a-must', issue: null, judged: '2026-10-16', note: 'Judged gallery.' },
    ]);
  });

  it('keeps a judgement to the kind it names: the arch is judged under Public Art and would be bare under Archaeology', () => {
    expect(gaps('public-art')?.wellKnownMissing.map(missing => [missing.slug, missing.judgement?.cause ?? null])).toEqual([['arch', 'offered-elsewhere']]);
    // Archaeology offers the arch, so it is not among its gaps at all; were a run to lose it, the gap would be bare there.
    expect(gaps('archaeology')?.wellKnownMissing.map(missing => missing.slug)).not.toContain('arch');
  });

  it('counts the judged among what a kind lacks by cause, naming each cause\'s issues once', () => {
    expect(gaps('art-museums')?.judgedByCause).toEqual([
      { cause: 'door-missing', count: 2, issues: [628] },
      { cause: 'not-a-must', count: 1, issues: [] },
    ]);
    // Moray sits under the line: judged, but not among the well-known rows the kind lists.
    expect(gaps('archaeology')?.judgedByCause).toEqual([{ cause: 'rule-defect', count: 1, issues: [1160] }]);
  });

  it('calls stale a judgement whose kind offers the entry now, and none on a gap lacked under the line', () => {
    expect(report.staleJudgements).toEqual([
      {
        regionSlug: 'cusco-region', slug: 'machu-picchu', name: 'machu-picchu', kindSlug: 'archaeology', kindName: 'Archaeology',
        cause: 'rule-defect', issue: 1160, judged: '2026-10-16', note: 'Judged machu-picchu.',
      },
    ]);
  });

  it('joins a judgement on a catalogue row to no gap, and calls it stale when no offered row within reach carries the id', () => {
    expect(report.liveKinds.flatMap(live => live.wellKnownMissing).filter(missing => missing.judgement !== null)).toHaveLength(5);
    expect(report.staleRowJudgements).toEqual([
      { regionSlug: 'cusco-region', wikidataId: 'Q96000099', cause: 'not-a-must', issue: null, judged: '2026-10-16', note: 'Judged .' },
    ]);
  });
});

describe('a live kind against its own calibration list (#1864)', () => {
  const report = buildCoverageReport(facts({
    calibrationSources: [
      { slug: 'coverage-surveys', name: 'The coverage surveys', url: null, read: '2026-10-24', note: '' },
      { slug: 'wonders', name: 'The wonders list', url: 'https://example.org/wonders', read: '2026-10-24', note: '' },
    ],
    calibration: [
      top('machu-picchu', { sitelinks: 150, offered: true, sources: ['coverage-surveys', 'wonders'] }),
      // Held: a catalogue place known by the item that the kind does not offer.
      top('pending-dig', { held_as: 'A dig nobody read yet', sitelinks: 30 }),
      // Offered by another kind and held here is held too, whatever the match says.
      top('coricancha', { held_as: 'Coricancha', offered: false, sitelinks: 29, sources: ['wonders'] }),
      top('tipon', { refused_for: 'a water system, not a site', sitelinks: 24 }),
      // A top the catalogue still holds that the latest run refused: the run's reason is what the list is there to surface.
      top('knocked-out', { held_as: 'Knocked Out', refused_for: 'a rule changed under it', sitelinks: 27 }),
      // Let through by the line and waiting for a curator: counted, never named as a miss.
      top('waiting-arrival', { held_as: 'Waiting Arrival', admitted: true, sitelinks: 35 }),
      // Admitted and in a crowded city's tail (ADR-0172): a miss of the display, told apart from a held one.
      top('santa-sabina', { held_as: 'Basilica of Saint Sabina', crowded: true, sitelinks: 28, sources: ['wonders'] }),
      top('moray', { sitelinks: 18 }),
      top('choquequirao', { sitelinks: 26 }),
      top('unknown-count', { sitelinks: null }),
      // Another kind's list is its own.
      top('obelisk', { kind_slug: 'public-art', offered: true }),
    ],
  }));
  const own = (slug: string) => report.liveKinds.find(live => live.slug === slug)?.calibration;

  it('counts the tops offered, and names every miss most known first with where it stands', () => {
    expect(own('archaeology')).toMatchObject({ entries: 10, offered: 1, admitted: 1 });
    expect(own('archaeology')?.misses.map(miss => [miss.name, miss.standing, miss.detail])).toEqual([
      ['pending-dig', 'held', 'A dig nobody read yet'],
      ['coricancha', 'held', 'Coricancha'],
      ['santa-sabina', 'crowded', null],
      ['knocked-out', 'refused', 'a rule changed under it'],
      ['choquequirao', 'absent', null],
      ['tipon', 'refused', 'a water system, not a site'],
      ['moray', 'under_line', null],
      ['unknown-count', 'absent', null],
    ]);
  });

  it('tells an absent top under the kind\'s editions line from one its classes do not reach, by the list\'s own sitelinks', () => {
    const standing = (slug: string) => own('archaeology')?.misses.find(miss => miss.slug === slug)?.standing;
    expect(standing('moray')).toBe('under_line');
    expect(standing('choquequirao')).toBe('absent');
    expect(standing('unknown-count')).toBe('absent');
  });

  it('gives each reference list its share, the most named first, under the register\'s name', () => {
    expect(own('archaeology')?.bySource).toEqual([
      { slug: 'coverage-surveys', name: 'The coverage surveys', named: 8, offered: 1 },
      { slug: 'wonders', name: 'The wonders list', named: 3, offered: 1 },
    ]);
  });

  it('keeps each kind to its own list, and gives a kind with no list none', () => {
    expect(own('public-art')).toMatchObject({ entries: 1, offered: 1, admitted: 0, misses: [] });
    expect(own('world-heritage')).toBeNull();
    expect(own('notable-works')).toBeNull();
  });

  it('says it as text: the share, each list\'s share, and every miss with its reason', () => {
    const text = renderCoverageReport(report);
    expect(text).toContain('What each live kind offers of the tops a traveller expects of it: its fame line, checked');
    expect(text).toContain('Archaeology [archaeology]: 1 of 10 tops are offered, 1 more admitted and waiting for a curator');
    expect(text).toContain('    The coverage surveys: 1 of 8');
    expect(text).not.toContain('Waiting Arrival');
    expect(text).toContain('refused by the last run: a water system, not a site)');
    expect(text).toContain('moray (Q5109; 18 sitelinks; coverage-surveys; absent, under the editions line)');
    expect(text).toContain('in the catalogue, not offered by this kind: A dig nobody read yet)');
    expect(text).toContain("santa-sabina (Q12115; 28 sitelinks; wonders; in a crowded city's tail: ten better known of its type within 10 km, or a curator's shadow)");
    expect(text).not.toContain('World Heritage Sites [world-heritage]: 0 of');
  });
});

describe('what a region offers that no guide names', () => {
  const unnamed = (name: string, over: Partial<CoverageFacts['unnamed'][number]> = {}): CoverageFacts['unnamed'][number] => ({
    region_slug: 'cusco-region', experience_id: name.length, name, wikidata_id: `Q${name.length}`, kind_ids: [5], sitelinks: 10, km: 3, ...over,
  });
  const onRow = (id: string, cause: string, issue: number | null = null): JudgementRow =>
    judged('', cause, issue, { entry_slug: null, kind_slug: null, row_wikidata_id: id });
  const report = buildCoverageReport(facts({
    regions: [
      { slug: 'cusco-region', name: 'Cusco region', country: 'Peru', surveyed: '2026-10-01' },
      { slug: 'rome', name: 'Rome', country: 'Italy', surveyed: '2026-10-02' },
    ],
    unnamed: [
      unnamed('Tipon', { sitelinks: 19, kind_ids: [5, 1] }),
      unnamed('A stump', { sitelinks: 3 }),
      unnamed('A chapel', { wikidata_id: 'Q77', sitelinks: 9 }),
      unnamed('An aqueduct', { wikidata_id: 'Q78', sitelinks: 12, kind_ids: [5] }),
      unnamed('A road', { wikidata_id: 'Q79', sitelinks: 30 }),
      unnamed('A property only UNESCO names', { wikidata_id: null, sitelinks: null, kind_ids: [1] }),
    ],
    judgements: [
      onRow('Q77', 'worth-a-visit'),
      onRow('Q78', 'not-a-must'),
      onRow('Q79', 'rule-defect', 1160),
      // Judged in Rome, where no offered row carries the id any more.
      onRow('Q80', 'not-a-must', null),
    ].map((row, i) => (i === 3 ? { ...row, region_slug: 'rome' } : row)),
  }));
  const cusco = report.unnamed.find(region => region.regionSlug === 'cusco-region');

  it('lists per region the unjudged rows least known first, with the kinds that offer them, and apart the ones with no id to judge by', () => {
    expect(cusco?.total).toBe(6);
    expect(cusco?.unjudged.map(place => [place.name, place.sitelinks, place.kinds])).toEqual([
      ['A stump', 3, ['Archaeology']],
      ['Tipon', 19, ['Archaeology', 'World Heritage Sites']],
    ]);
    expect(cusco?.unjudgeable.map(place => [place.name, place.wikidataId, place.kinds])).toEqual([
      ['A property only UNESCO names', null, ['World Heritage Sites']],
    ]);
  });

  it('counts the judged by cause, and keeps standing what a person said is not worth a visit while a kind offers it', () => {
    expect(cusco?.judgedByCause).toEqual([
      { cause: 'worth-a-visit', count: 1, issues: [] },
      { cause: 'not-a-must', count: 1, issues: [] },
      { cause: 'rule-defect', count: 1, issues: [1160] },
    ]);
    expect(cusco?.standing.map(place => [place.name, place.judgement?.cause])).toEqual([['An aqueduct', 'not-a-must'], ['A road', 'rule-defect']]);
  });

  it('says of a region with nothing unnamed that it has nothing, and calls stale a row judgement no offered row carries', () => {
    expect(report.unnamed.find(region => region.regionSlug === 'rome')).toMatchObject({ total: 0, unjudged: [], unjudgeable: [], judgedByCause: [], standing: [] });
    expect(report.staleRowJudgements.map(stale => [stale.regionSlug, stale.wikidataId, stale.cause])).toEqual([['rome', 'Q80', 'not-a-must']]);
  });

  it('says it as text: the counts per region, the unjudged, and the findings that stand', () => {
    const text = renderCoverageReport(report);
    expect(text).toContain('Cusco region [cusco-region]: 6 offered that no entry names; 3 judged: 1 worth-a-visit; 1 not-a-must; 1 rule-defect (#1160); '
      + '2 wait for a person; 1 cannot be judged (no Wikidata id)');
    expect(text).toContain('        A stump (Q7; Archaeology; 3 sitelinks; 3 km)');
    expect(text).toContain('    no Wikidata id to judge by:\n        A property only UNESCO names (no Wikidata id; World Heritage Sites; no sitelinks count; 3 km)');
    expect(text).toContain('    judged not worth a visit and still offered:\n        An aqueduct (Q78; Archaeology; 12 sitelinks; 3 km)');
    expect(text).toContain('Rome [rome]: 0 offered that no entry names; 0 judged; 0 wait for a person');
    expect(text).toContain('rome: row Q80 -> not-a-must, judged 2026-10-16');
  });
});

describe('what the map shows: a crowded city\'s tail, and the places it crowds out (#2246)', () => {
  // The development catalogue's reading of 2026-11-02: each entry's sources, sitelinks and
  // coordinate as Rome's, Kyoto's and Istanbul's lists record them, its type as Places of
  // worship's rule gives it.
  const WORSHIP = kind({
    slug: 'places-of-worship', name: 'Places of worship', experience_kind_id: 4, enter_sitelinks: null, crowding_limit: 10, crowding_radius_km: 10,
  });
  const ROME_REGION = { slug: 'rome', name: 'Rome', country: 'Italy', surveyed: '2026-10-02' };
  const place = (region: string) => (slug: string, type: string, sources: number, sitelinks: number, at: [number, number] | null, kinds = ['places-of-worship']) =>
    entry(slug, {
      region_slug: region, name: slug, source_count: sources, sitelinks, kinds, kind_types: { 'places-of-worship': type }, lat: at?.[0] ?? null, lon: at?.[1] ?? null,
    });
  const rome = place('rome');
  const ROME = [
    rome('st-peter-s-basilica', 'church', 8, 131, [41.90222, 12.45342]),
    rome('pantheon', 'church', 8, 81, [41.89861, 12.47694], ['archaeology', 'places-of-worship']),
    rome('santa-maria-del-popolo', 'church', 6, 35, [41.91145, 12.47648]),
    rome('santa-maria-in-trastevere', 'church', 6, 33, [41.88944, 12.46972]),
    rome('santa-maria-maggiore', 'church', 5, 58, [41.8975, 12.49861]),
    rome('st-paul-outside-the-walls', 'church', 5, 58, [41.85861, 12.47722]),
    rome('san-pietro-in-vincoli', 'church', 5, 42, [41.89387, 12.49307]),
    rome('san-luigi-dei-francesi', 'church', 5, 35, [41.89958, 12.47467]),
    rome('santa-maria-della-vittoria', 'church', 4, 36, [41.90466, 12.49434]),
    // Four sources each: the survey's own sitelinks put Aracoeli tenth and Minerva eleventh.
    rome('santa-maria-in-aracoeli', 'church', 4, 36, [41.89389, 12.48333]),
    rome('santa-maria-sopra-minerva', 'church', 4, 35, [41.89806, 12.47833]),
    // In the churches' tail, and still demanded: Archaeology shows every site it admits.
    rome('basilica-of-san-clemente', 'church', 4, 28, [41.8893, 12.49756], ['archaeology', 'places-of-worship']),
    rome('sant-agnese-in-agone', 'church', 4, 27, [41.89877, 12.4726]),
    // Wikidata types Sant'Ignazio a chapel: it stands among the chapels, not the churches.
    rome('sant-ignazio', 'chapel', 5, 29, [41.899, 12.47976]),
    // Twenty kilometres out in the Alban Hills, with no ten better-named churches within 10 km of it.
    rome('san-tommaso-da-villanova-castel-gandolfo', 'church', 2, 5, [41.74627, 12.65076]),
  ];
  const offered = (slug: string, name: string) => ({ region_slug: 'rome', slug, catalogue_name: name, kind_id: 4, offered: true, shadowed: false });
  const report = buildCoverageReport(facts({
    kinds: [...KINDS, WORSHIP],
    regions: [ROME_REGION],
    expectations: ROME,
    matches: [
      offered('st-peter-s-basilica', 'St. Peter\'s Basilica'),
      offered('santa-maria-del-popolo', 'Santa Maria del Popolo'),
      offered('san-luigi-dei-francesi', 'San Luigi dei Francesi'),
      offered('santa-maria-sopra-minerva', 'Santa Maria sopra Minerva'),
      { region_slug: 'rome', slug: 'santa-maria-in-aracoeli', catalogue_name: 'Santa Maria in Aracoeli', kind_id: 4, offered: false, shadowed: true },
      { region_slug: 'rome', slug: 'sant-agnese-in-agone', catalogue_name: 'Sant\'Agnese in Agone', kind_id: 4, offered: false, shadowed: true },
    ],
  }));
  const worship = report.liveKinds.find(live => live.slug === 'places-of-worship');

  it('demands of a kind with the display rule the entries of a type the most sources name, as many as its map shows', () => {
    expect(verdictOf(report, 'santa-maria-in-aracoeli')).toBe('shadowed');
    expect(verdictOf(report, 'santa-maria-sopra-minerva')).toBe('tail');
    expect(verdictOf(report, 'sant-agnese-in-agone')).toBe('tail');
    // San Clemente is in the churches' tail too, and Archaeology asks for it.
    expect(worship).toMatchObject({ expected: 12, offered: 3, tail: 3 });
  });

  it('never asks what the catalogue holds of the tail: Minerva is offered and stays in it', () => {
    expect(report.regions[0].counts).toMatchObject({ offered: 3, shadowed: 1, tail: 2 });
  });

  it('keeps demanded an entry another kind asks for, an entry of another type, and one with no ten better named within the radius', () => {
    expect(verdictOf(report, 'basilica-of-san-clemente')).toBe('missing_live');
    expect(verdictOf(report, 'sant-ignazio')).toBe('missing_live');
    expect(verdictOf(report, 'san-tommaso-da-villanova-castel-gandolfo')).toBe('missing_live');
    expect(report.liveKinds.find(live => live.slug === 'archaeology')).toMatchObject({ expected: 2, tail: 0 });
  });

  it('never names a tail or a shadowed place among what a kind lacks, and counts the shadowed beside them', () => {
    const slugs = worship?.wellKnownMissing.map(missing => missing.slug);
    expect(slugs).not.toContain('sant-agnese-in-agone');
    expect(slugs).not.toContain('santa-maria-sopra-minerva');
    expect(slugs).not.toContain('santa-maria-in-aracoeli');
    expect(worship?.shadowed).toBe(1);
  });

  it('asks an entry only of the kinds that demand it: a church in the tail and filed under a proposed kind is missing from that kind', () => {
    const gardens = kind({ slug: 'parks-and-gardens', name: 'Parks and gardens', status: 'proposed', experience_kind_id: null });
    const both = buildCoverageReport(facts({
      kinds: [...KINDS, WORSHIP, gardens],
      regions: [ROME_REGION],
      expectations: ROME.map(row => row.slug === 'sant-agnese-in-agone' ? { ...row, kinds: ['places-of-worship', 'parks-and-gardens'] } : row),
    }));
    expect(verdictOf(both, 'sant-agnese-in-agone')).toBe('missing_proposed');
  });

  it('counts only the better-named places within the kind\'s radius: Nara\'s temples, a day trip filed under Kyoto, are demanded', () => {
    const kyoto = place('kyoto');
    const temples = [
      kyoto('kiyomizu-dera', 'temple', 8, 77, [34.99483, 135.785]), kyoto('byodo-in', 'temple', 8, 37, [34.88944, 135.80778]),
      kyoto('ginkaku-ji', 'temple', 8, 33, [35.02667, 135.79833]), kyoto('to-ji', 'temple', 8, 30, [34.98056, 135.74778]),
      kyoto('kinkaku-ji', 'temple', 7, 57, [35.0395, 135.7285]), kyoto('nanzen-ji', 'temple', 7, 22, [35.01111, 135.79417]),
      kyoto('saiho-ji-kokedera', 'temple', 7, 22, [34.9925, 135.68417]), kyoto('chion-in', 'temple', 7, 20, [35.00521, 135.7834]),
      kyoto('tenryu-ji', 'temple', 7, 20, [35.01599, 135.67379]), kyoto('kodai-ji', 'temple', 7, 15, [35.00076, 135.78111]),
      kyoto('sanzen-in', 'temple', 7, 8, [35.11972, 135.83444]), kyoto('todai-ji', 'temple', 6, 44, [34.68917, 135.83972]),
      kyoto('enryaku-ji', 'temple', 6, 32, [35.07056, 135.84111]), kyoto('ryoan-ji', 'temple', 6, 32, [35.03444, 135.71833]),
      kyoto('tofuku-ji', 'temple', 6, 23, [34.97571, 135.77368]), kyoto('higashi-hongan-ji', 'temple', 6, 13, [34.99081, 135.75844]),
      kyoto('kennin-ji', 'temple', 6, 13, [35.00099, 135.77366]), kyoto('daikaku-ji', 'temple', 6, 11, [35.02824, 135.67774]),
      kyoto('eikan-do', 'temple', 6, 9, [35.01453, 135.79529]), kyoto('shoren-in', 'temple', 6, 9, [35.00731, 135.7832]),
      kyoto('horyu-ji', 'temple', 5, 53, [34.61444, 135.73417]), kyoto('kofuku-ji', 'temple', 5, 29, [34.68321, 135.8313]),
    ];
    const tail = buildCoverageReport(facts({
      kinds: [...KINDS, WORSHIP],
      regions: [{ slug: 'kyoto', name: 'Kyoto', country: 'Japan', surveyed: '2026-10-02' }],
      expectations: temples,
    })).expectations.filter(result => result.verdict === 'tail').map(result => result.slug);
    // Ten better-named temples of central Kyoto stand within 10 km of these four; Arashiyama's Daikaku-ji has nine.
    expect(tail).toEqual(['higashi-hongan-ji', 'kennin-ji', 'eikan-do', 'shoren-in']);
    for (const nara of ['todai-ji', 'horyu-ji', 'kofuku-ji']) expect(tail).not.toContain(nara);
  });

  it('ranks an entry with no coordinate against its whole region, reads the line from the kind, and breaks a tie by slug: Fatih before Ortaköy', () => {
    const istanbul = (slug: string, sources: number, sitelinks: number) => entry(slug, {
      region_slug: 'istanbul', name: slug, source_count: sources, sitelinks, kinds: ['places-of-worship'], kind_types: { 'places-of-worship': 'mosque' },
    });
    const mosques = [
      istanbul('hagia-sophia', 6, 152), istanbul('blue-mosque', 6, 89), istanbul('suleymaniye-mosque', 6, 69),
      istanbul('chora-church', 4, 44), istanbul('sehzade-mosque', 4, 43), istanbul('new-mosque', 4, 41),
      istanbul('rustem-pasha-mosque', 4, 33), istanbul('arap-mosque', 4, 25),
      istanbul('ortakoy-mosque', 3, 38), istanbul('fatih-mosque', 3, 38), istanbul('little-hagia-sophia', 3, 36),
    ];
    const tailOf = (limit: number) => buildCoverageReport(facts({
      kinds: [...KINDS, { ...WORSHIP, crowding_limit: limit }],
      regions: [{ slug: 'istanbul', name: 'Istanbul', country: 'Turkey', surveyed: '2026-10-02' }],
      expectations: mosques,
    })).expectations.filter(result => result.verdict === 'tail').map(result => result.slug);
    expect(tailOf(10)).toEqual(['little-hagia-sophia']);
    expect(tailOf(9)).toEqual(['ortakoy-mosque', 'little-hagia-sophia']);
  });

  it('demands every entry of a kind without the display rule', () => {
    const without = buildCoverageReport(facts({
      kinds: [...KINDS, { ...WORSHIP, crowding_limit: null, crowding_radius_km: null }], regions: [ROME_REGION], expectations: ROME,
    }));
    expect(without.expectations.filter(result => result.verdict === 'tail')).toEqual([]);
    expect(without.liveKinds.find(live => live.slug === 'places-of-worship')).toMatchObject({ expected: 15, tail: 0 });
  });

  it('demands every entry of a type its kind exempts: Archaeology\'s museums in Rome (ADR-0179)', () => {
    // Eleven museums of one type within 10 km would put the least known in the
    // tail; filed as museums of a kind that exempts them, every one is demanded.
    const museum = (slug: string, sources: number) => entry(slug, {
      region_slug: 'rome', name: slug, source_count: sources, sitelinks: 30, kinds: ['archaeology'], kind_types: { archaeology: 'museum' },
      lat: 41.9, lon: 12.48,
    });
    const museums = Array.from({ length: 11 }, (_, i) => museum(`museum-${String(i).padStart(2, '0')}`, 11 - i));
    const archaeology = kind({ crowding_limit: 10, crowding_radius_km: 10 });
    const tailOf = (exempt: string[]) => buildCoverageReport(facts({
      kinds: [{ ...archaeology, crowding_exempt_types: exempt }], regions: [ROME_REGION], expectations: museums,
    })).expectations.filter(result => result.verdict === 'tail').map(result => result.slug);
    expect(tailOf([])).toEqual(['museum-10']);
    expect(tailOf(['museum'])).toEqual([]);
  });

  it('says it as text: the tail counted and its names folded, the shadowed by name', () => {
    const text = renderCoverageReport(report);
    expect(text).toContain('Catalogue coverage: 3 of 13 demanded things are offered to a reader (23%), across 1 surveyed region(s); 2 more expected are the lists\' tails.');
    expect(text).toContain('Rome, Italy (surveyed 2026-10-02): 15 expected, 13 demanded, 3 offered (23%)');
    expect(text).toContain('       2  in the list\'s tail, beyond what the map shows of its kind and type, 1 of them offered all the same: '
      + 'santa-maria-sopra-minerva; sant-agnese-in-agone');
    expect(text).toContain('Places of worship [places-of-worship; line: 16 sitelinks]: 3 of 12 expected are offered; 3 more are the lists\' tails; 1 shadowed in a crowded city');
    expect(text).toContain('rome: santa-maria-in-aracoeli -> Santa Maria in Aracoeli');
    expect(text).not.toContain('rome: sant-agnese-in-agone -> ');
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

  it('call a place shadowed when a kind admits it and crowds it out (ADR-0172), and read the display rule and the type from the kind and the filing', () => {
    const sql = collapse(coverageSql.MATCHES_SQL);
    expect(sql).toContain(collapse(`(${membershipAdmittedSql('m')} AND ${membershipVisibleSql('m')} AND ${realKindSql('m')} AND ${hideLostSql('e')} AND ${membershipCrowdedSql('m')}) AS shadowed`));
    expect(sql).toContain('false AS shadowed');
    expect(collapse(coverageSql.KINDS_SQL)).toContain('(SELECT k.crowding_limit FROM experience_kinds k WHERE k.id = ck.experience_kind_id) AS crowding_limit');
    expect(collapse(coverageSql.KINDS_SQL)).toContain('(SELECT k.crowding_radius_km FROM experience_kinds k WHERE k.id = ck.experience_kind_id) AS crowding_radius_km');
    expect(collapse(coverageSql.KINDS_SQL)).toContain("COALESCE((SELECT k.crowding_exempt_types FROM experience_kinds k WHERE k.id = ck.experience_kind_id), '{}') AS crowding_exempt_types");
    expect(collapse(coverageSql.EXPECTATIONS_SQL)).toContain('jsonb_object_agg(xk.kind_slug, xk.type)');
    expect(collapse(coverageSql.EXPECTATIONS_SQL)).toContain('ST_Y(x.location) AS lat, ST_X(x.location) AS lon');
  });

  it('match by identifier alone: the entry\'s Wikidata id, the ids named as the same place, UNESCO\'s id', () => {
    const sql = collapse(coverageSql.MATCHES_SQL);
    expect(sql).toContain('x.wikidata_id AS id');
    expect(sql).toContain('unnest(x.same_as) AS same(id)');
    expect(sql).toContain('SELECT x.region_slug, x.slug, x.unesco_id');
    // A place by every id it is known by: its own, each membership's, the items a membership resolves a site to.
    expect(sql).toContain('JOIN known_as k ON k.id = ids.id');
    expect(sql).toContain('JOIN experiences e ON e.id = k.experience_id');
    for (const known of ['e.external_id AS id', 'm.external_id', 'unnest(m.wikidata_items) AS item']) expect(sql).toContain(known);
    expect(sql).toContain('JOIN treasures t ON t.external_id = ids.id');
    expect(sql).not.toMatch(/\bname\s*=|ILIKE|similarity\(/i);
  });

  it('count as standing at the spot only an offered point of an offered place', () => {
    const sql = collapse(coverageSql.NEARBY_SQL);
    expect(sql).toContain(collapse(offeredLocationSql('el')));
    expect(sql).toContain(collapse(publishedContentSql('el')));
    expect(sql).toContain(collapse(`m.experience_id = e.id AND ${countedMembershipSql('m', 'e')}`));
  });

  it('count as offered and unnamed only an offered point of an offered place, by the identifiers the lists match by', () => {
    const sql = collapse(coverageSql.UNNAMED_SQL);
    expect(sql).toContain(collapse(offeredLocationSql('el')));
    expect(sql).toContain(collapse(publishedContentSql('el')));
    expect(sql).toContain(collapse(`m.experience_id = e.id AND ${countedMembershipSql('m', 'e')}`));
    expect(sql).toContain('rc.radius_km * 1000');
    // The prefilter in degrees widens with the latitude, covers the world by a pole, and is tested on both sides of the antimeridian.
    expect(sql).toContain('cos(radians(ST_Y(r.centre)))');
    expect(sql).toContain('>= 84 THEN 360');
    expect(sql).toContain('ST_DWithin(el.location, rc.twin, rc.degrees)');
    for (const identifier of ['x.wikidata_id AS id', 'unnest(x.same_as) AS same(id)', 'x.unesco_id', 'unnest(m.wikidata_items) AS item']) {
      expect(sql).toContain(identifier);
    }
    expect(sql).not.toMatch(/\bname\s*=|ILIKE|similarity\(/i);
  });

  it('stand a calibration top by the identifiers a place is known by, the kind\'s counted membership, and the last real run\'s refusals', () => {
    const sql = collapse(coverageSql.CALIBRATION_SQL);
    expect(sql).toContain(collapse(countedMembershipSql('m', 'e')));
    expect(sql).toContain('m.kind_id = ck.experience_kind_id');
    for (const identifier of ['e.external_id AS id', 'm.external_id, false', 'unnest(m.wikidata_items) AS item']) {
      expect(sql).toContain(identifier);
    }
    // Joined once and aggregated per entry, never a subquery per top over the whole union.
    expect(sql).toContain('JOIN known_as k ON k.id = c.wikidata_id');
    expect(sql).not.toMatch(/EXISTS \(SELECT 1 FROM known_as/);
    // A refusal is a changeset row of the latest real, closed run, never a membership.
    expect(sql).toContain("ch.change_type = 'filtered'");
    expect(sql).toContain("NOT l.is_dry_run AND l.status IN ('success', 'partial')");
    // A kind of work stands by the treasure its item names, shown by a venue a reader may go to (#1988).
    expect(sql).toContain("JOIN coverage_kinds ck ON ck.slug = c.kind_slug AND ck.form = 'work' JOIN treasures t ON t.external_id = c.wikidata_id");
    expect(sql).toContain(collapse(`${publishedContentSql('t')} AND EXISTS (SELECT 1 ${venuesShowingSql('t')})`));
    expect(sql).not.toMatch(/\bname\s*=|ILIKE|similarity\(/i);
  });
});

describe('a kind of work against its own calibration list (#1988)', () => {
  const works = (findLine: number | null) => buildCoverageReport(facts({
    kinds: KINDS.map(k => (k.slug === 'notable-works' ? { ...k, find_enter_sitelinks: findLine } : k)),
    calibration: [
      top('rosetta-stone', { kind_slug: 'notable-works', sitelinks: 105, offered: true }),
      // A treasure the catalogue holds that no venue a reader may go to shows.
      top('phaistos-disc', { kind_slug: 'notable-works', sitelinks: 40, held_as: 'Phaistos Disc' }),
      // Over the finds' line and under the artworks': out of reach, not under the line.
      top('mask-of-agamemnon', { kind_slug: 'notable-works', sitelinks: 20 }),
      top('lydenburg-heads', { kind_slug: 'notable-works', sitelinks: 9 }),
    ],
  })).liveKinds.find(live => live.slug === 'notable-works')?.calibration;

  it('stands a work offered where a venue shows it, and held where the catalogue holds it unshown', () => {
    expect(works(18)).toMatchObject({ entries: 4, offered: 1 });
    expect(works(18)?.misses.map(miss => [miss.slug, miss.standing, miss.detail])).toEqual([
      ['phaistos-disc', 'held', 'Phaistos Disc'],
      ['mask-of-agamemnon', 'absent', null],
      ['lydenburg-heads', 'under_line', null],
    ]);
  });

  it('puts a work under the line only below the lowest door a work enters by: the finds\' line where a source states one', () => {
    const standing = (findLine: number | null, slug: string) => works(findLine)?.misses.find(miss => miss.slug === slug)?.standing;
    expect(standing(18, 'mask-of-agamemnon')).toBe('absent');
    // With no finds' line the artworks' own is the only door.
    expect(standing(null, 'mask-of-agamemnon')).toBe('under_line');
  });
});

describe('the report as text', () => {
  it('says the share offered, each region, each proposed kind with its issue, and what a person must judge', () => {
    const text = renderCoverageReport(buildCoverageReport(facts({
      expectations: [
        entry('Machu Picchu'), entry('Cusco Cathedral'), entry('Inti Raymi', { type: 'event', kinds: ['festivals-and-events'] }),
        entry('Climbing the dome', { type: 'activity', kinds: [] }),
      ],
      matches: [{ region_slug: 'cusco-region', slug: 'Machu Picchu', catalogue_name: 'Machu Picchu', kind_id: 5, offered: true, shadowed: false }],
      nearby: [{ region_slug: 'cusco-region', slug: 'Cusco Cathedral', place: 'City of Cuzco', point: 'Main Square', metres: 78 }],
    })));

    expect(text).toContain('Catalogue coverage: 1 of 4 demanded things are offered to a reader (25%), across 1 surveyed region(s).');
    expect(text).toContain('Cusco region, Peru (surveyed 2026-10-01): 4 expected, 4 demanded, 1 offered (25%)');
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
