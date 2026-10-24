/**
 * The catalogue-coverage files are written by hand and by a survey, and nothing but
 * this reader stands between a wrong line and the report built on it (ADR-0081). Each
 * refusal below names the file and the line, because "invalid input" in a list of a
 * thousand entries is not something a person can act on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoFile } from '../../testSupport/repoFile.js';
import { CoverageFilesError, readCoverageFiles } from './files.js';

type Line = Record<string, unknown>;

const KINDS: Line[] = [
  { slug: 'world-heritage', name: 'World Heritage Sites', form: 'place', definition: 'A site on the List.', status: 'live', experience_kind_id: 1, issue: null, vision: null, in_venue: false },
  { slug: 'archaeology', name: 'Archaeology', form: 'place', definition: 'A dig or its museum.', status: 'live', experience_kind_id: 5, issue: null, vision: null, in_venue: false },
  { slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', status: 'proposed', experience_kind_id: null, issue: null, vision: 'Markets', in_venue: false },
  { slug: 'regional-food', name: 'Regional food', form: 'food', definition: 'A dish.', status: 'proposed', experience_kind_id: null, issue: null, vision: 'Regional Food', in_venue: false },
  { slug: 'notable-works', name: 'Notable works', form: 'work', definition: 'A work in a venue.', status: 'live', experience_kind_id: null, issue: null, vision: null, in_venue: true },
  { slug: 'on-site-activities', name: 'On-site activities', form: 'activity', definition: 'Something done at one place.', status: 'proposed', experience_kind_id: null, issue: null, vision: null, in_venue: true },
  { slug: 'shows-and-performances', name: 'Shows & performances', form: 'activity', definition: 'A show.', status: 'proposed', experience_kind_id: null, issue: null, vision: null, in_venue: false },
];
const REGIONS: Line[] = [
  { slug: 'cusco-region', name: 'Cusco region', country: 'Peru', lat: -13.532, lon: -71.967, radius_km: 110, surveyed: '2026-10-01' },
];
const entry = (over: Line = {}): Line => ({
  slug: 'moray', name: 'Moray', aliases: [], type: 'place', kinds: ['archaeology'], wikidata: 'Q1814201', same_as: [],
  unesco: null, venue: null, sources: 4, sitelinks: 18, lat: -13.33, lon: -72.197, note: '', ...over,
});
const MACHU_PICCHU = entry({ slug: 'machu-picchu', name: 'Machu Picchu', kinds: ['world-heritage', 'archaeology'], wikidata: 'Q676203', unesco: '274' });
const CUY = entry({ slug: 'cuy', name: 'Cuy', type: 'food', kinds: ['regional-food'], wikidata: null, sitelinks: null, lat: null, lon: null });

const jsonl = (lines: Line[]) => lines.map(line => `${JSON.stringify(line)}\n`).join('');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const judgement = (over: Line = {}): Line => ({
  region: 'cusco-region', entry: 'moray', kind: 'archaeology', row: null, cause: 'rule-defect', issue: 1160, judged: '2026-10-16',
  note: 'Typed an archaeological site; never asked by a run.', ...over,
});

const source = (over: Line = {}): Line => ({ slug: 'coverage-surveys', name: 'The coverage surveys', url: null, read: '2026-10-24', note: '', ...over });
const top = (over: Line = {}): Line => ({ slug: 'machu-picchu', name: 'Machu Picchu', wikidata: 'Q676203', sources: ['coverage-surveys'], sitelinks: 150, note: '', ...over });

interface Parts {
  kinds?: Line[] | string;
  regions?: Line[] | string;
  expectations?: Record<string, Line[] | string>;
  judgements?: Line[] | string;
  /** The reference lists' register; written only when given. */
  calibrationSources?: Line[] | string;
  /** Each kind's calibration list, by the file's kind slug; the directory exists only when given. */
  calibration?: Record<string, Line[] | string>;
}

function files(parts: Parts): string {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-files-'));
  made.push(dir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
  mkdirSync(join(dir, 'expectations'));
  const text = (value: Line[] | string) => (typeof value === 'string' ? value : jsonl(value));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
  writeFileSync(join(dir, 'kinds.jsonl'), text(parts.kinds ?? KINDS));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
  writeFileSync(join(dir, 'regions.jsonl'), text(parts.regions ?? REGIONS));
  const lists = parts.expectations ?? { 'cusco-region': [entry(), MACHU_PICCHU, CUY] };
  for (const [region, lines] of Object.entries(lists)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
    writeFileSync(join(dir, 'expectations', `${region}.jsonl`), text(lines));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
  if (parts.judgements !== undefined) writeFileSync(join(dir, 'judgements.jsonl'), text(parts.judgements));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
  if (parts.calibrationSources !== undefined) writeFileSync(join(dir, 'calibration-sources.jsonl'), text(parts.calibrationSources));
  if (parts.calibration !== undefined) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
    mkdirSync(join(dir, 'calibration'));
    for (const [kindSlug, lines] of Object.entries(parts.calibration)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- under the temporary directory this spec just made
      writeFileSync(join(dir, 'calibration', `${kindSlug}.jsonl`), text(lines));
    }
  }
  return dir;
}

function problemsOf(dir: string): string[] {
  try {
    readCoverageFiles(dir);
  } catch (error) {
    if (error instanceof CoverageFilesError) return error.problems;
    throw error;
  }
  return [];
}

describe('reading a well-formed set of files', () => {
  it('returns the register, the regions and each region\'s list', () => {
    const read = readCoverageFiles(files({}));
    expect(read.kinds.map(kind => kind.slug)).toContain('markets');
    expect(read.regions.map(region => region.slug)).toEqual(['cusco-region']);
    expect(read.expectations.get('cusco-region')?.map(e => e.slug)).toEqual(['moray', 'machu-picchu', 'cuy']);
  });

  it('accepts an entry filed under no kind: it is waiting to be sorted, not wrong', () => {
    expect(problemsOf(files({ expectations: { 'cusco-region': [entry({ kinds: [] })] } }))).toEqual([]);
  });

  it('reads a directory with no ledger as one that has judged nothing', () => {
    expect(readCoverageFiles(files({})).judgements).toEqual([]);
  });
});

describe('the judgement ledger', () => {
  it('returns each judgement, on an entry of a list under one of its live kinds or on a catalogue row', () => {
    const onRow = judgement({ entry: null, kind: null, row: 'Q2003624', cause: 'not-a-must', issue: null, note: 'A chapel no guide names.' });
    const read = readCoverageFiles(files({ judgements: [judgement(), onRow] }));
    expect(read.judgements.map(j => [j.entry, j.kind, j.row, j.cause, j.issue])).toEqual([
      ['moray', 'archaeology', null, 'rule-defect', 1160], [null, null, 'Q2003624', 'not-a-must', null],
    ]);
  });

  it('takes a judgement per kind on an entry filed under two live kinds: each kind\'s gap is its own', () => {
    const judgements = [
      judgement({ entry: 'machu-picchu', kind: 'archaeology' }),
      judgement({ entry: 'machu-picchu', kind: 'world-heritage', cause: 'not-a-must', issue: null }),
    ];
    expect(problemsOf(files({ judgements }))).toEqual([]);
  });

  it('takes on a catalogue row what an offered row can be, and refuses the causes a gap waits on', () => {
    const row = (cause: string, issue: number | null, id = 'Q2003624') => judgement({ entry: null, kind: null, row: id, cause, issue, note: 'A chapel.' });
    const kept = files({ judgements: [row('worth-a-visit', null, 'Q2003621'), row('not-a-must', null, 'Q2003622'), row('rule-defect', 1160, 'Q2003623')] });
    expect(problemsOf(kept)).toEqual([]);
    for (const cause of ['door-missing', 'kind-missing', 'part-of-offered', 'offered-elsewhere']) {
      expect(problemsOf(files({ judgements: [row(cause, 628)] }))).toEqual([
        `judgements.jsonl line 1: Q2003624 is a catalogue row judged ${cause}: an offered row waits on no door, kind, part or other kind; it is worth a visit, not a must, or a rule's defect`,
      ]);
    }
  });

  it('refuses worth-a-visit on an entry: a gap a kind has is never worth a visit', () => {
    expect(problemsOf(files({ judgements: [judgement({ cause: 'worth-a-visit', issue: null })] }))).toEqual([
      'judgements.jsonl line 1: moray is an entry judged worth-a-visit: a gap a kind has is never worth a visit',
    ]);
  });

  it('refuses a judgement on a catalogue row that names a kind: a row is judged on its own', () => {
    const rowWithKind = judgement({ entry: null, kind: 'archaeology', row: 'Q2003624', cause: 'not-a-must', issue: null });
    expect(problemsOf(files({ judgements: [rowWithKind] }))).toEqual([
      'judgements.jsonl line 1: Q2003624 is a catalogue row and names a kind: a row is judged on its own, not under a kind',
    ]);
  });

  it('refuses a judgement on an entry that names no kind, a kind that is only proposed, or a kind the entry is not filed under', () => {
    expect(problemsOf(files({ judgements: [judgement({ kind: null })] }))).toEqual([
      'judgements.jsonl line 1: moray names no kind: a gap is an entry and the live kind that does not offer it',
    ]);
    expect(problemsOf(files({ judgements: [judgement({ kind: 'markets' })] }))).toEqual([
      'judgements.jsonl line 1: moray is judged under markets, which is only proposed: a gap is a live kind\'s',
    ]);
    expect(problemsOf(files({ judgements: [judgement({ kind: 'world-heritage' })] }))).toEqual([
      'judgements.jsonl line 1: moray is not filed under world-heritage',
    ]);
    expect(problemsOf(files({ judgements: [judgement({ kind: 'digs' })] }))).toEqual([
      'judgements.jsonl line 1: moray is judged under digs, which the register does not have',
    ]);
  });

  it('refuses a cause outside the vocabulary, since the report counts by it', () => {
    expect(problemsOf(files({ judgements: [judgement({ cause: 'meh' })] }))).toEqual([expect.stringMatching(/^judgements\.jsonl line 1: cause: /)]);
  });

  it('refuses a judgement that names both an entry and a row, or neither', () => {
    const both = files({ judgements: [judgement({ row: 'Q2003624' })] });
    expect(problemsOf(both)).toEqual([
      'judgements.jsonl line 1: a judgement names an entry or a catalogue row, one of the two',
      'judgements.jsonl line 1: Q2003624 is a catalogue row and names a kind: a row is judged on its own, not under a kind',
    ]);
    const neither = files({ judgements: [judgement({ entry: null })] });
    expect(problemsOf(neither)).toEqual(['judgements.jsonl line 1: a judgement names an entry or a catalogue row, one of the two']);
  });

  it('refuses a defect or a missing door without the issue that owns it, and takes the other causes without one', () => {
    expect(problemsOf(files({ judgements: [judgement({ issue: null })] }))).toEqual(['judgements.jsonl line 1: rule-defect names the issue that owns it']);
    expect(problemsOf(files({ judgements: [judgement({ cause: 'door-missing', issue: null })] }))).toEqual(['judgements.jsonl line 1: door-missing names the issue that owns it']);
    expect(problemsOf(files({ judgements: [judgement({ cause: 'part-of-offered', issue: null })] }))).toEqual([]);
  });

  it('refuses a region no list has and an entry its list does not hold', () => {
    expect(problemsOf(files({ judgements: [judgement({ region: 'rome' })] }))).toEqual(['judgements.jsonl line 1: no region rome in regions.jsonl']);
    expect(problemsOf(files({ judgements: [judgement({ entry: 'tipon' })] }))).toEqual(['judgements.jsonl line 1: cusco-region has no entry tipon']);
  });

  it('refuses a gap judged twice, naming the first line, and says what else is wrong with the second', () => {
    const twice = files({ judgements: [judgement(), judgement({ cause: 'not-a-must', issue: null })] });
    expect(problemsOf(twice)).toEqual(['judgements.jsonl line 2: moray under archaeology of cusco-region is already judged on line 1']);
    const twiceAndWrong = files({ judgements: [judgement(), judgement({ issue: null })] });
    expect(problemsOf(twiceAndWrong)).toEqual([
      'judgements.jsonl line 2: moray under archaeology of cusco-region is already judged on line 1',
      'judgements.jsonl line 2: rule-defect names the issue that owns it',
    ]);
    const rowTwice = files({ judgements: [
      judgement({ entry: null, kind: null, row: 'Q2003624', cause: 'not-a-must', issue: null }),
      judgement({ entry: null, kind: null, row: 'Q2003624', cause: 'not-a-must', issue: null }),
    ] });
    expect(problemsOf(rowTwice)).toEqual(['judgements.jsonl line 2: Q2003624 of cusco-region is already judged on line 1']);
  });

  it('refuses an empty note: a judgement nobody can read later judges nothing', () => {
    expect(problemsOf(files({ judgements: [judgement({ note: '' })] }))).toEqual([expect.stringMatching(/^judgements\.jsonl line 1: note: /)]);
  });
});

describe('the calibration lists (#1864)', () => {
  const calibrated = (calibration: Record<string, Line[] | string>, calibrationSources: Line[] | string = [source()]) =>
    files({ calibrationSources, calibration });

  it('returns each kind\'s list and the register of reference lists, and reads a directory with neither as having calibrated nothing', () => {
    const read = readCoverageFiles(calibrated({ archaeology: [top(), top({ slug: 'moray', wikidata: 'Q1814201', sitelinks: 18 })] }));
    expect(read.calibrationSources.map(s => s.slug)).toEqual(['coverage-surveys']);
    expect(read.calibration.get('archaeology')?.map(t => [t.slug, t.wikidata, t.sources])).toEqual([
      ['machu-picchu', 'Q676203', ['coverage-surveys']], ['moray', 'Q1814201', ['coverage-surveys']],
    ]);
    const none = readCoverageFiles(files({}));
    expect(none.calibrationSources).toEqual([]);
    expect(none.calibration.size).toBe(0);
  });

  it('wants the register once there is a list, and takes a register with no list', () => {
    expect(problemsOf(files({ calibration: { archaeology: [top()] } }))).toEqual([
      'calibration-sources.jsonl: the file is missing',
      'calibration/archaeology.jsonl line 1: machu-picchu names coverage-surveys, which calibration-sources.jsonl does not have',
    ]);
    expect(problemsOf(files({ calibrationSources: [source()] }))).toEqual([]);
  });

  it('refuses a list for a kind the register lacks, one only proposed, or one that holds no place', () => {
    expect(problemsOf(calibrated({ digs: [top()] }))).toEqual(['calibration/digs.jsonl: no kind digs in kinds.jsonl']);
    expect(problemsOf(calibrated({ markets: [top()] }))).toEqual([
      'calibration/markets.jsonl: markets is only proposed: a fame line is a live kind\'s to calibrate',
    ]);
    expect(problemsOf(calibrated({ 'notable-works': [top()] }))).toEqual([
      'calibration/notable-works.jsonl: notable-works holds a work: a calibration list names places, by their Wikidata items',
    ]);
  });

  it('refuses a slug or an item used twice in one list, naming the first line', () => {
    expect(problemsOf(calibrated({ archaeology: [top(), top({ wikidata: 'Q1814201' })] }))).toEqual([
      'calibration/archaeology.jsonl line 2: slug machu-picchu is already used on line 1',
    ]);
    expect(problemsOf(calibrated({ archaeology: [top(), top({ slug: 'machu-picchu-again' })] }))).toEqual([
      'calibration/archaeology.jsonl line 2: Q676203 is already the item of machu-picchu on line 1',
    ]);
    // Two kinds may name one place: a tower that is also a place of worship.
    expect(problemsOf(calibrated({ archaeology: [top()], 'world-heritage': [top()] }))).toEqual([]);
  });

  it('refuses an entry naming no reference list, one twice, or one the register does not have', () => {
    expect(problemsOf(calibrated({ archaeology: [top({ sources: [] })] }))).toEqual([expect.stringMatching(/^calibration\/archaeology\.jsonl line 1: sources: /)]);
    expect(problemsOf(calibrated({ archaeology: [top({ sources: ['coverage-surveys', 'coverage-surveys'] })] }))).toEqual([
      'calibration/archaeology.jsonl line 1: machu-picchu names coverage-surveys twice',
    ]);
    expect(problemsOf(calibrated({ archaeology: [top({ sources: ['wonders'] })] }))).toEqual([
      'calibration/archaeology.jsonl line 1: machu-picchu names wonders, which calibration-sources.jsonl does not have',
    ]);
  });

  it('refuses a reference list registered twice, and a register line that is not what the format says', () => {
    expect(problemsOf(calibrated({ archaeology: [top()] }, [source(), source()]))).toEqual([
      'calibration-sources.jsonl line 2: slug coverage-surveys is already used on line 1',
    ]);
    // A register line the format refuses registers nothing, so the entries naming it are reported too.
    const unknown = 'calibration/archaeology.jsonl line 1: machu-picchu names coverage-surveys, which calibration-sources.jsonl does not have';
    expect(problemsOf(calibrated({ archaeology: [top()] }, [source({ url: 'not a url' })]))).toEqual([expect.stringMatching(/^calibration-sources\.jsonl line 1: url: /), unknown]);
    expect(problemsOf(calibrated({ archaeology: [top()] }, [source({ read: 'yesterday' })]))).toEqual([expect.stringMatching(/^calibration-sources\.jsonl line 1: read: /), unknown]);
  });

  it('refuses an entry with no item: a list matches by identifier, never by name', () => {
    expect(problemsOf(calibrated({ archaeology: [top({ wikidata: null })] }))).toEqual([expect.stringMatching(/^calibration\/archaeology\.jsonl line 1: wikidata: /)]);
  });
});

describe('a line that is not what the format says', () => {
  it('names the file and the line of a line that is not JSON', () => {
    const dir = files({ expectations: { 'cusco-region': `${JSON.stringify(entry())}\n{"slug": "broken",\n` } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/^expectations\/cusco-region\.jsonl line 2: not JSON/)]);
  });

  it('names the field of a line that is JSON and not an entry', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ wikidata: 'Saqsaywaman' })] } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/^expectations\/cusco-region\.jsonl line 1: wikidata: /)]);
  });

  it('refuses a field the format does not have, so a misspelt one is not silently dropped', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ wikdata: 'Q1814201' })] } });
    expect(problemsOf(dir).join('\n')).toMatch(/line 1: .*wikdata/);
  });

  it('refuses an entry fewer than two sources named', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ sources: 1 })] } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/line 1: sources: /)]);
  });

  it('refuses a latitude without its longitude', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ lon: null })] } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/line 1: lat and lon are given together or not at all/)]);
  });
});

describe('a list that does not agree with the register', () => {
  it('refuses a kind the register does not have', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ kinds: ['archeology'] })] } });
    expect(problemsOf(dir)).toEqual(['expectations/cusco-region.jsonl line 1: moray is filed under archeology, which the register does not have']);
  });

  it('refuses an entry under a kind that holds something else', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ slug: 'cuy', name: 'Cuy', type: 'food', kinds: ['markets'], wikidata: null, lat: null, lon: null })] } });
    expect(problemsOf(dir)).toEqual(['expectations/cusco-region.jsonl line 1: cuy is a food and markets holds a place']);
  });

  it('refuses the same kind twice on one entry', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ kinds: ['archaeology', 'archaeology'] })] } });
    expect(problemsOf(dir)).toEqual(['expectations/cusco-region.jsonl line 1: moray is filed under archaeology twice']);
  });

  it('holds World Heritage to the UNESCO id in both directions', () => {
    const withoutKind = files({ expectations: { 'cusco-region': [entry({ unesco: '274' })] } });
    expect(problemsOf(withoutKind)).toEqual([expect.stringMatching(/line 1: moray carries a UNESCO id and is not filed under world-heritage/)]);
    const withoutId = files({ expectations: { 'cusco-region': [entry({ kinds: ['world-heritage'] })] } });
    expect(problemsOf(withoutId)).toEqual([expect.stringMatching(/line 1: moray is filed under world-heritage and carries no UNESCO id/)]);
  });

  it('refuses a venue on a place, which is where it is', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ venue: 'Museo Inka' })] } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/line 1: moray is a place and names a venue/)]);
  });

  it('takes a venue on what is shown or held at a place', () => {
    const show = entry({ slug: 'qoricancha-night-show', type: 'activity', kinds: ['shows-and-performances'], wikidata: null, venue: 'Qorikancha' });
    const climb = entry({ slug: 'cathedral-bell-tower', type: 'activity', kinds: ['on-site-activities'], wikidata: null, venue: 'Cusco Cathedral' });
    expect(problemsOf(files({ expectations: { 'cusco-region': [show, climb] } }))).toEqual([]);
  });

  it('refuses an entry of a kind that exists only inside a place when it names no venue', () => {
    const climb = entry({ slug: 'cathedral-bell-tower', type: 'activity', kinds: ['on-site-activities'], wikidata: null });
    const work = entry({ slug: 'last-supper-with-cuy', type: 'work', kinds: ['notable-works'], wikidata: 'Q2003624' });
    expect(problemsOf(files({ expectations: { 'cusco-region': [climb, work] } }))).toEqual([
      'expectations/cusco-region.jsonl line 1: cathedral-bell-tower is filed under on-site-activities, which exists only inside a place, and names no venue',
      'expectations/cusco-region.jsonl line 2: last-supper-with-cuy is filed under notable-works, which exists only inside a place, and names no venue',
    ]);
  });
});

describe('an identity used twice', () => {
  it('refuses a slug used twice in a region, naming the first line', () => {
    const dir = files({ expectations: { 'cusco-region': [entry(), entry({ wikidata: 'Q2003624' })] } });
    expect(problemsOf(dir)).toEqual(['expectations/cusco-region.jsonl line 2: slug moray is already used on line 1']);
  });

  it('refuses a Wikidata id used twice in a region, as an id or as the same place under another id', () => {
    const twice = files({ expectations: { 'cusco-region': [entry(), entry({ slug: 'moray-terraces' })] } });
    expect(problemsOf(twice)).toEqual(['expectations/cusco-region.jsonl line 2: Q1814201 is already the identity of moray on line 1']);
    const alias = files({ expectations: { 'cusco-region': [entry(), entry({ slug: 'moray-terraces', wikidata: 'Q2003624', same_as: ['Q1814201'] })] } });
    expect(problemsOf(alias)).toEqual(['expectations/cusco-region.jsonl line 2: Q1814201 is already the identity of moray on line 1']);
  });

  it('refuses a UNESCO id used twice in a region: an inscribed property is one entry', () => {
    const centre = entry({ slug: 'city-of-cuzco', wikidata: null, kinds: ['world-heritage'], unesco: '273' });
    const again = entry({ slug: 'historic-centre-of-cusco', wikidata: null, kinds: ['world-heritage'], unesco: '273' });
    expect(problemsOf(files({ expectations: { 'cusco-region': [centre, again] } }))).toEqual([
      'expectations/cusco-region.jsonl line 2: UNESCO id 273 is already the identity of city-of-cuzco on line 1',
    ]);
  });

  it('says what else is wrong with an entry whose slug or identity is already used', () => {
    const slugTwice = files({ expectations: { 'cusco-region': [entry(), entry({ wikidata: 'Q2003624', kinds: ['archeology'] })] } });
    expect(problemsOf(slugTwice)).toEqual([
      'expectations/cusco-region.jsonl line 2: slug moray is already used on line 1',
      'expectations/cusco-region.jsonl line 2: moray is filed under archeology, which the register does not have',
    ]);
    const identityTwice = files({ expectations: { 'cusco-region': [entry(), entry({ slug: 'moray-terraces', venue: 'Museo Inka' })] } });
    expect(problemsOf(identityTwice)).toEqual([
      'expectations/cusco-region.jsonl line 2: Q1814201 is already the identity of moray on line 1',
      'expectations/cusco-region.jsonl line 2: moray-terraces is a place and names a venue',
    ]);
  });

  it('counts a line copied whole as one problem', () => {
    const dir = files({ expectations: { 'cusco-region': [entry(), entry()] } });
    expect(problemsOf(dir)).toEqual(['expectations/cusco-region.jsonl line 2: slug moray is already used on line 1']);
  });

  it('lets two regions hold the same place: Nara is a day trip from Kyoto and from Osaka', () => {
    const regions = [...REGIONS, { ...REGIONS[0], slug: 'sacred-valley', name: 'Sacred Valley' }];
    const dir = files({ regions, expectations: { 'cusco-region': [entry()], 'sacred-valley': [entry()] } });
    expect(problemsOf(dir)).toEqual([]);
  });
});

describe('the register', () => {
  it('refuses a slug used twice', () => {
    const dir = files({ kinds: [...KINDS, KINDS[2]] });
    expect(problemsOf(dir)).toEqual(['kinds.jsonl line 8: slug markets is already used on line 3']);
  });

  it('refuses a live kind of place with no catalogue kind behind it, and a proposed kind with one', () => {
    const live = files({ kinds: [{ ...KINDS[0] }, { ...KINDS[1], experience_kind_id: null }, ...KINDS.slice(2)] });
    expect(problemsOf(live)).toEqual(['kinds.jsonl line 2: archaeology is a live kind of place and names no experience_kind_id']);
    const proposed = files({ kinds: [...KINDS.slice(0, 2), { ...KINDS[2], experience_kind_id: 7 }, ...KINDS.slice(3)] });
    expect(problemsOf(proposed)).toEqual(['kinds.jsonl line 3: markets is proposed and names experience_kind_id 7']);
  });

  it('refuses a catalogue kind on a live kind that holds no place: only a kind of place has one', () => {
    const dir = files({ kinds: [...KINDS.slice(0, 4), { ...KINDS[4], experience_kind_id: 6 }] });
    expect(problemsOf(dir)).toEqual([
      'kinds.jsonl line 5: notable-works holds a work and names experience_kind_id 6: only a kind of place has a catalogue kind',
    ]);
  });

  it('says what is wrong with a record besides its slug being used twice', () => {
    const dir = files({ kinds: [...KINDS, { ...KINDS[2], experience_kind_id: 7 }] });
    expect(problemsOf(dir)).toEqual([
      'kinds.jsonl line 8: markets is proposed and names experience_kind_id 7',
      'kinds.jsonl line 8: slug markets is already used on line 3',
    ]);
  });

  it('refuses two kinds that claim the same catalogue kind', () => {
    const dir = files({ kinds: [KINDS[0], { ...KINDS[1], experience_kind_id: 1 }, ...KINDS.slice(2)] });
    expect(problemsOf(dir)).toEqual(['kinds.jsonl line 2: experience_kind_id 1 is already claimed by world-heritage on line 1']);
  });
});

describe('regions and their lists', () => {
  it('refuses a region with no list and a list with no region', () => {
    const noList = files({ expectations: {} });
    expect(problemsOf(noList)).toEqual(['regions.jsonl line 1: cusco-region has no expectations/cusco-region.jsonl']);
    const noRegion = files({ expectations: { 'cusco-region': [entry()], rome: [entry()] } });
    expect(problemsOf(noRegion)).toEqual(['expectations/rome.jsonl: no region rome in regions.jsonl']);
  });

  it('reads a list no region names, so its wrong lines are reported in the same pass', () => {
    const dir = files({ expectations: { 'cusco-region': [entry()], rome: `${JSON.stringify(entry({ sources: 1 }))}\n{"slug":\n` } });
    expect(problemsOf(dir)).toEqual([
      expect.stringMatching(/^expectations\/rome\.jsonl line 1: sources: /),
      expect.stringMatching(/^expectations\/rome\.jsonl line 2: not JSON/),
      'expectations/rome.jsonl: no region rome in regions.jsonl',
    ]);
  });

  it('reports every problem of a run, not the first', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ kinds: ['archeology'] }), entry({ sources: 1, slug: 'tipon', wikidata: 'Q2003624' })] } });
    expect(problemsOf(dir)).toHaveLength(2);
  });
});

describe('the committed files', () => {
  it('are read without a problem', () => {
    const read = readCoverageFiles(repoFile('db', 'catalogue-coverage'));
    expect(read.regions.length).toBeGreaterThan(0);
    for (const region of read.regions) {
      expect(read.expectations.get(region.slug)?.length, region.slug).toBeGreaterThan(0);
    }
  });
});
