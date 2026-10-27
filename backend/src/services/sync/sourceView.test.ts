import { describe, expect, it, vi } from 'vitest';
import {
  contestedFields, keepsItsPicture, keptAsStored, reportedArticle, type StoredView, type ViewRecord,
} from './sourceView.js';

/**
 * The run's half of a source's view (#1246): which fields another source
 * contradicts, and the record with those kept as the place holds them. Which
 * views disagree is decided in SQL and run against PostgreSQL in
 * `sourceView.db.test.ts`; this pins what TypeScript does with the answer.
 */

const RECORD: ViewRecord = {
  sourceId: 5,
  externalId: 'Q9480',
  name: 'Dome of the Rock',
  subtitle: 'Shrine built by the Umayyads in 691-692',
  imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Archaeology.jpg',
  lon: 35.2433,
  lat: 31.7781,
  metadata: {
    wikidataQid: 'Q9480', imageCredit: { artist: 'Archaeology photographer' },
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Dome_of_the_Rock',
  },
};

const STORED: StoredView = {
  name: 'Dome of the Rock',
  subtitle: 'Islamic shrine on the Temple Mount',
  image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Worship.jpg',
  metadata: { wikidataQid: 'Q9480', imageCredit: { artist: 'Worship photographer' } },
  lon: '35.2353',
  lat: '31.7781',
};

describe('the record a run writes where another source disagrees', () => {
  it('is the run\'s own where nothing is contested', () => {
    expect(keptAsStored(RECORD, STORED, [])).toBe(RECORD);
  });

  it('keeps each contested field as the place holds it, and only those', () => {
    const kept = keptAsStored(RECORD, STORED, ['subtitle', 'location']);

    expect(kept.subtitle).toBe(STORED.subtitle);
    expect([kept.lon, kept.lat]).toEqual([35.2353, 31.7781]);
    expect(kept.imageUrl).toBe(RECORD.imageUrl);
    expect(kept.metadata.imageCredit).toEqual(RECORD.metadata.imageCredit);
  });

  it('keeps the stored picture with its own credit', () => {
    const kept = keptAsStored(RECORD, STORED, ['imageUrl']);

    expect(kept.imageUrl).toBe(STORED.image_url);
    expect(kept.metadata.imageCredit).toEqual({ artist: 'Worship photographer' });
    expect(kept.metadata.wikidataQid).toBe('Q9480');
    // The run's record is not touched: its view is written from it.
    expect(RECORD.metadata.imageCredit).toEqual({ artist: 'Archaeology photographer' });
  });

  it('puts no credit beside a stored picture that has none', () => {
    const kept = keptAsStored(RECORD, { ...STORED, metadata: { wikidataQid: 'Q9480' } }, ['imageUrl']);

    expect(Object.hasOwn(kept.metadata, 'imageCredit')).toBe(false);
  });

  it('keeps the article the place links, or none where it links none (#1975)', () => {
    const stored = { ...STORED, metadata: { ...STORED.metadata, wikipediaUrl: 'https://en.wikipedia.org/wiki/Temple_Mount' } };

    expect(keptAsStored(RECORD, stored, ['wikipediaUrl']).metadata.wikipediaUrl)
      .toBe('https://en.wikipedia.org/wiki/Temple_Mount');
    expect(Object.hasOwn(keptAsStored(RECORD, STORED, ['wikipediaUrl']).metadata, 'wikipediaUrl')).toBe(false);
    expect(RECORD.metadata.wikipediaUrl).toBe('https://en.wikipedia.org/wiki/Dome_of_the_Rock');
  });
});

describe('the article a run reports (#1975)', () => {
  it('is the record\'s article, and nothing where it has none', () => {
    expect(reportedArticle(RECORD)).toBe('https://en.wikipedia.org/wiki/Dome_of_the_Rock');
    expect(reportedArticle({ metadata: {} })).toBeNull();
    expect(reportedArticle({ metadata: { wikipediaUrl: '' } })).toBeNull();
    expect(reportedArticle({ metadata: { wikipediaUrl: 42 } })).toBeNull();
  });
});

describe('the fields another source contradicts', () => {
  it('asks every other standing view of the place, and answers in the fields\' order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ field: 'location' }, { field: 'imageUrl' }] });

    const contested = await contestedFields({ query } as never, 9480, RECORD);

    expect(contested).toEqual(['imageUrl', 'location']);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // Not a view of the same item, the run's own included (#1246), and not a
    // source that stopped listing the place.
    expect(sql).toMatch(/v\.external_id <> \$2/);
    expect(sql).toMatch(/m\.missing_since IS NULL AND m\.source_membership = 'present'/);
    // And a serial site's view of the component a part stands for, on the
    // part's record (ADR-0156), unless the run is the site's own (#2061).
    expect(sql).toMatch(/rec\.experience_id = \$1 AND rec\.kind_id = 10/);
    expect(sql).toMatch(/NOT \(v\.component AND v\.source_id = \$9\)/);
    // A field the run leaves empty where another view has one is kept too.
    expect(sql).toMatch(/NULLIF\(\$5::text, ''\) IS NULL AND NULLIF\(m\.reported_image_url, ''\) IS NOT NULL/);
    expect(sql).toMatch(/NULLIF\(\$8::text, ''\) IS NOT NULL AND NULLIF\(m\.reported_wikipedia_url, ''\) IS NOT NULL/);
    expect(params).toEqual([
      9480, 'Q9480', RECORD.name, RECORD.subtitle, RECORD.imageUrl, RECORD.lon, RECORD.lat,
      'https://en.wikipedia.org/wiki/Dome_of_the_Rock', RECORD.sourceId,
    ]);
  });

  it("does not contest the anchor of a place of several points, which is the run's (ADR-0095)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ field: 'location' }, { field: 'imageUrl' }] });

    expect(await contestedFields({ query } as never, 9480, { ...RECORD, locationIsAnchor: true })).toEqual(['imageUrl']);
  });
});

describe('a picture the item still carries (#1778)', () => {
  // The Art Institute of Chicago's item carries two pictures at one rank; the place
  // holds the second, and every reader keeps the first by URL.
  const FIRST = 'http://commons.wikimedia.org/wiki/Special:FilePath/Art%20Institute%20of%20Chicago%20%2851575570710%29.jpg';
  const HELD = 'http://commons.wikimedia.org/wiki/Special:FilePath/Art%20Institute%20of%20Chicago%2C%20Illinois.jpg';
  const record = (itemPictures?: string[]): ViewRecord => ({ ...RECORD, imageUrl: FIRST, itemPictures });
  const stored: StoredView = { ...STORED, image_url: HELD };

  it('is kept while it is one of the item\'s pictures', () => {
    expect(keepsItsPicture(record([FIRST, HELD]), stored)).toBe(true);
  });

  it('is replaced once it left the item, which is a real change on Wikidata', () => {
    expect(keepsItsPicture(record([FIRST]), stored)).toBe(false);
  });

  it('asks nothing of a run with no item to read, or of a place holding no picture', () => {
    expect(keepsItsPicture(record(undefined), stored)).toBe(false);
    expect(keepsItsPicture(record([FIRST, HELD]), { ...stored, image_url: null })).toBe(false);
  });

  it('is no question where the run chose the picture the place holds', () => {
    expect(keepsItsPicture({ ...record([FIRST, HELD]), imageUrl: HELD }, stored)).toBe(false);
  });
});

