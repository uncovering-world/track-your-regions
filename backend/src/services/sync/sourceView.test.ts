import { describe, expect, it, vi } from 'vitest';
import { contestedFields, keptAsStored, type StoredView, type ViewRecord } from './sourceView.js';

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
  description: 'Shrine built by the Umayyads in 691-692',
  imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Archaeology.jpg',
  lon: 35.2433,
  lat: 31.7781,
  metadata: { wikidataQid: 'Q9480', imageCredit: { artist: 'Archaeology photographer' } },
};

const STORED: StoredView = {
  name: 'Dome of the Rock',
  description: 'Islamic shrine on the Temple Mount',
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
    const kept = keptAsStored(RECORD, STORED, ['description', 'location']);

    expect(kept.description).toBe(STORED.description);
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
});

describe('the fields another source contradicts', () => {
  it('asks every other standing view of the place, and answers in the fields\' order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ field: 'location' }, { field: 'imageUrl' }] });

    const contested = await contestedFields({ query } as never, 9480, RECORD);

    expect(contested).toEqual(['imageUrl', 'location']);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // Not a view of the same item, the run's own included (#1246), and not a
    // source that stopped listing the place.
    expect(sql).toMatch(/m\.external_id <> \$2/);
    expect(sql).toMatch(/m\.missing_since IS NULL AND m\.source_membership = 'present'/);
    // A field the run leaves empty where another view has one is kept too.
    expect(sql).toMatch(/NULLIF\(\$5::text, ''\) IS NULL AND NULLIF\(m\.reported_image_url, ''\) IS NOT NULL/);
    expect(params).toEqual([9480, 'Q9480', RECORD.name, RECORD.description, RECORD.imageUrl, RECORD.lon, RECORD.lat]);
  });
});
