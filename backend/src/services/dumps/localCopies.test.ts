import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyIsoDay, copyOf, newestLocalCopy, olderCopies } from './localCopies.js';
import { dumpNamed } from './catalog.js';

const WIKIVOYAGE_PAGES = dumpNamed('wikivoyage-pages')!;

/** The local copies of a dump told apart by their date (#1456), on the names the catalog gives. */

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'copies-'));
  for (const name of [
    'wikidata-20261005-all.json.gz', 'wikidata-20261005-all.json.gz.terms.gz', 'wikidata-20260928-all.json.gz.part',
    'wikidata-20260928-all.json.gz.part.json', 'wikidata-20261005-lexemes.json.gz', 'wikidata-20261012-all.json.gz.part',
    'enwiki-20261001-page.sql.gz', 'enwiki-20260901-page.sql.gz', 'enwiki-20260901-page_props.sql.gz',
    'pageviews-202608-user.bz2', 'notes.txt', 'wikidata-20261005-all.json.gz.scope',
    'enwikivoyage-2026-09-01-p1p220977.xml.bz2', 'enwikivoyage-2026-10-01-p1p221280.xml.bz2',
  ]) writeFileSync(join(dir, name), '');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the local copies of one dump (#1456)', () => {
  it('reads the dump and the date from a name and its leftovers', () => {
    expect(copyOf('wikidata-20261005-all.json.gz')).toEqual({ dump: 'wikidata-*-all.json.gz', date: '20261005' });
    expect(copyOf('wikidata-20261005-all.json.gz.part.json.tmp')).toEqual({ dump: 'wikidata-*-all.json.gz', date: '20261005' });
    expect(copyOf('wikidata-20261005-all.json.gz.terms.gz')).toEqual({ dump: 'wikidata-*-all.json.gz', date: '20261005' });
    expect(copyOf('wikidata-20261005-all.json.gz.scope')).toEqual({ dump: 'wikidata-*-all.json.gz', date: '20261005' });
    expect(copyOf('wikidata-20261005-all.json.gz.scope.tmp')).toEqual({ dump: 'wikidata-*-all.json.gz', date: '20261005' });
    expect(copyOf('pageviews-202609-user.bz2')).toEqual({ dump: 'pageviews-*-user.bz2', date: '202609' });
    expect(copyOf('planet-261012.osm.pbf')).toEqual({ dump: 'planet-*.osm.pbf', date: '261012' });
    expect(copyOf('planet-261012.osm.pbf.part')).toEqual({ dump: 'planet-*.osm.pbf', date: '261012' });
    expect(copyOf('notes.txt')).toBeNull();
  });

  it('reads a content export part as one dump whatever page range it holds, dated by its dashed date (#2355)', () => {
    expect(copyOf('enwikivoyage-2026-10-01-p1p221280.xml.bz2')).toEqual({ dump: 'enwikivoyage-*-p*.xml.bz2', date: '20261001' });
    expect(copyOf('enwikivoyage-2026-11-01-p1p221544.xml.bz2.part.json')).toEqual({ dump: 'enwikivoyage-*-p*.xml.bz2', date: '20261101' });
    expect(copyIsoDay(copyOf('enwikivoyage-2026-10-01-p1p221280.xml.bz2')!.date, 'day')).toBe('2026-10-01');
  });

  it('names every older copy of the same dump with its leftovers, and nothing else', async () => {
    expect(await olderCopies(dir, 'wikidata-20261012-all.json.gz', name => /^wikidata-\d{8}-all\.json\.gz$/.test(name))).toEqual([
      'wikidata-20260928-all.json.gz.part', 'wikidata-20260928-all.json.gz.part.json',
      'wikidata-20261005-all.json.gz', 'wikidata-20261005-all.json.gz.scope', 'wikidata-20261005-all.json.gz.terms.gz',
    ]);
    expect(await olderCopies(dir, 'enwiki-20261001-page.sql.gz', name => /^enwiki-\d{8}-page\.sql\.gz$/.test(name))).toEqual(['enwiki-20260901-page.sql.gz']);
    // Last month's export is an older copy of this month's, though its page range differs (#2355).
    expect(await olderCopies(dir, 'enwikivoyage-2026-10-01-p1p221280.xml.bz2', WIKIVOYAGE_PAGES.isFileName))
      .toEqual(['enwikivoyage-2026-09-01-p1p220977.xml.bz2']);
  });

  it('finds the newest whole-named copy of a dump, and none of a dump with only a part', async () => {
    expect(await newestLocalCopy(dir, name => /^wikidata-\d{8}-all\.json\.gz$/.test(name), 'day')).toEqual({ fileName: 'wikidata-20261005-all.json.gz', date: '2026-10-05', bytes: 0 });
    expect(await newestLocalCopy(dir, name => /^enwiki-\d{8}-page\.sql\.gz$/.test(name), 'day')).toMatchObject({ fileName: 'enwiki-20261001-page.sql.gz' });
    expect(await newestLocalCopy(dir, name => /^wikidata-\d{8}-lexemes\.json\.gz$/.test(name), 'day')).toMatchObject({ date: '2026-10-05' });
    expect(await newestLocalCopy(dir, name => /^enwiki-\d{8}-langlinks\.sql\.gz$/.test(name), 'day')).toBeNull();
    expect(await newestLocalCopy(dir, WIKIVOYAGE_PAGES.isFileName, 'day'))
      .toEqual({ fileName: 'enwikivoyage-2026-10-01-p1p221280.xml.bz2', date: '2026-10-01', bytes: 0 });
  });

  it("answers a copy's date as an ISO day, telling the planet's day from a month of counts by how the dump is dated", () => {
    expect(copyIsoDay('20261005', 'day')).toBe('2026-10-05');
    expect(copyIsoDay('202609', 'month')).toBe('2026-09-01');
    expect(copyIsoDay('261012', 'day')).toBe('2026-10-12');
  });

  it('names none for the newest copy', async () => {
    expect(await olderCopies(dir, 'wikidata-20260928-all.json.gz', name => /^wikidata-\d{8}-all\.json\.gz$/.test(name))).toEqual([]);
  });
});
