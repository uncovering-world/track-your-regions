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
  { slug: 'world-heritage', name: 'World Heritage Sites', form: 'place', definition: 'A site on the List.', status: 'live', experience_kind_id: 1, issue: null, vision: null },
  { slug: 'archaeology', name: 'Archaeology', form: 'place', definition: 'A dig or its museum.', status: 'live', experience_kind_id: 5, issue: null, vision: null },
  { slug: 'markets', name: 'Markets', form: 'place', definition: 'A market.', status: 'proposed', experience_kind_id: null, issue: null, vision: 'Markets' },
  { slug: 'regional-food', name: 'Regional food', form: 'food', definition: 'A dish.', status: 'proposed', experience_kind_id: null, issue: null, vision: 'Regional Food' },
  { slug: 'notable-works', name: 'Notable works', form: 'work', definition: 'A work in a venue.', status: 'live', experience_kind_id: null, issue: null, vision: null },
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

function files(parts: { kinds?: Line[] | string; regions?: Line[] | string; expectations?: Record<string, Line[] | string> }): string {
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

  it('refuses a venue on anything but a work', () => {
    const dir = files({ expectations: { 'cusco-region': [entry({ venue: 'Museo Inka' })] } });
    expect(problemsOf(dir)).toEqual([expect.stringMatching(/line 1: moray names a venue and is not a work/)]);
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
      'expectations/cusco-region.jsonl line 2: moray-terraces names a venue and is not a work',
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
    expect(problemsOf(dir)).toEqual(['kinds.jsonl line 6: slug markets is already used on line 3']);
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
      'kinds.jsonl line 6: markets is proposed and names experience_kind_id 7',
      'kinds.jsonl line 6: slug markets is already used on line 3',
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
