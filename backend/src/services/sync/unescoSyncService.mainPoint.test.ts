/**
 * Tests for the site's main point.
 *
 * UNESCO leaves `coordinates` null on serial nominations and puts the real
 * positions in `components_list`. Requiring the main field discarded 28 of the
 * 29 records that failed the dry run of 3 August — including sites already in
 * the catalogue whose main field the source has since emptied.
 */

import { describe, it, expect } from 'vitest';
import { resolveMainPoint, buildUnescoTags, isInDanger, transformRecord } from './unescoSyncService.js';
import type { UnescoApiRecord, ParsedLocation } from './types.js';

function record(overrides: Partial<UnescoApiRecord> = {}): UnescoApiRecord {
  return { id_no: '136', name_en: 'Garamba National Park', category: 'Natural', ...overrides };
}

function component(overrides: Partial<ParsedLocation> = {}): ParsedLocation {
  return { name: 'Weiße Stadt', externalRef: '1239bis-005', lat: 52.5694, lon: 13.3508, ...overrides };
}

describe('resolveMainPoint', () => {
  it('uses the site\'s own coordinates when the source provides them', () => {
    const point = resolveMainPoint(record({ coordinates: { lat: -2.3333, lon: 34.8333 } }), []);

    expect(point).toEqual({ lat: -2.3333, lon: 34.8333 });
  });

  it('falls back to the components when the main field is empty', () => {
    // The shape of 28 of the 29 dry-run failures
    const point = resolveMainPoint(record(), [component()]);

    expect(point).toEqual({ lat: 52.5694, lon: 13.3508 });
  });

  it('picks the most central component, not the first one listed', () => {
    // Getbol's shape: parts strung along a coast, the first of them 300 km from
    // the middle — far enough to land in another region
    const point = resolveMainPoint(record(), [
      component({ lat: 37.5, lon: 126.6 }),
      component({ lat: 35.0, lon: 126.2 }),
      component({ lat: 34.8, lon: 126.1 }),
    ]);

    expect(point).toEqual({ lat: 35.0, lon: 126.2 });
  });

  it('still returns a real component rather than an average of them', () => {
    // A centroid of scattered parts can fall in open water; every component is
    // by construction a place at the site
    const parts = [
      component({ lat: 0.14, lon: 6.64 }),
      component({ lat: 0.22, lon: 6.60 }),
      component({ lat: 1.60, lon: 7.40 }),
    ];
    const point = resolveMainPoint(record(), parts);

    expect(parts.some(p => p.lat === point?.lat && p.lon === point?.lon)).toBe(true);
  });

  it('prefers the site\'s own point over its components', () => {
    const point = resolveMainPoint(
      record({ coordinates: { lat: 1, lon: 2 } }),
      [component({ lat: 50, lon: 50 })],
    );

    expect(point).toEqual({ lat: 1, lon: 2 });
  });

  it('treats a coordinate of zero as a position, not as missing', () => {
    // A site on the equator or the prime meridian; truthiness would send it to
    // the component fallback and move it
    const point = resolveMainPoint(
      record({ coordinates: { lat: 0, lon: 6.6 } }),
      [component({ lat: 50, lon: 50 })],
    );

    expect(point).toEqual({ lat: 0, lon: 6.6 });
  });

  it('averages longitudes the short way round the antimeridian', () => {
    // Parts half a degree apart across the 180th meridian. An arithmetic mean
    // puts their centre at longitude 0 — the opposite side of the planet — and
    // would rank both against it. See CLAUDE.md § Antimeridian Handling.
    const parts = [
      component({ lat: -16.0, lon: 179.9 }),
      component({ lat: -16.1, lon: -179.9 }),
      component({ lat: -16.05, lon: 179.95 }),
    ];
    const point = resolveMainPoint(record(), parts);

    // The middle part is nearest the true centre; a mean of 0 would have picked
    // whichever part sat closest to Greenwich instead
    expect(point).toEqual({ lat: -16.05, lon: 179.95 });
  });

  it('gives up only when there is no coordinate anywhere', () => {
    // Site 1567 — the one genuine failure, in July and now
    expect(resolveMainPoint(record({ id_no: '1567' }), [])).toBeNull();
  });

  it('treats a half-populated coordinate pair as absent', () => {
    const point = resolveMainPoint(
      record({ coordinates: { lat: 52.5, lon: undefined as unknown as number } }),
      [component({ lat: 10, lon: 20 })],
    );

    expect(point).toEqual({ lat: 10, lon: 20 });
  });
});

describe('the picture a site is shown with', () => {
  const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan.jpg';
  const sited = (overrides: Partial<UnescoApiRecord> = {}) =>
    record({ coordinates: { lat: 34.84, lon: 67.82 }, ...overrides });

  it('does not read the picture the portal offers, whatever it says about it', () => {
    // The World Heritage Centre's terms: its photographs "may not be copied or
    // retransmitted by any means without explicit authorisation", and a site
    // may "only link to, not replicate" its content (ADR-0043, #557). 1260 rows
    // carried one of these before this rule.
    // The three fields are no longer even asked for (`EXPORT_FIELDS`), so a
    // record carrying them is one the type does not admit — pinned all the
    // same, so a portal that sends them unasked, or an export list that grows
    // them back, still changes nothing.
    const site = transformRecord({
      ...sited(),
      main_image_url: 'https://whc.unesco.org/document/119616',
      main_image_author: 'Ko Hon Chiu Vincent',
      main_image_copyright: 'Museum Mors',
    } as unknown as UnescoApiRecord);

    expect(site?.imageUrl).toBeNull();
    expect(site?.metadata.imageCredit).toBeUndefined();
  });

  it('links to the property page instead, which those terms invite', () => {
    expect(transformRecord(sited({ id_no: '208' }))?.metadata.website)
      .toBe('https://whc.unesco.org/en/list/208');
  });

  it('shows the Commons picture Wikidata states, with whoever took it', () => {
    const site = transformRecord(
      sited(),
      { article: 'https://en.wikipedia.org/wiki/Bamiyan', picture: { url: COMMONS, via: 'exact', ref: '208' } },
      new Map([[COMMONS, { author: 'Ko Hon Chiu Vincent', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null }]]),
    );

    expect(site?.imageUrl).toBe(COMMONS);
    expect(site?.metadata.imageCredit).toMatchObject({ author: 'Ko Hon Chiu Vincent' });
    expect(site?.metadata.wikipediaUrl).toBe('https://en.wikipedia.org/wiki/Bamiyan');
  });

  it('leaves the credit for the next run when Commons could not answer', () => {
    // Commons could not be reached for this file. The picture still stands —
    // the licence is what it is either way — and the credit is absent rather
    // than invented, which is what `creditToWrite` leaves for the next run.
    const site = transformRecord(
      sited(),
      { article: null, picture: { url: COMMONS, via: 'component', ref: '208-001' } },
    );

    expect(site?.imageUrl).toBe(COMMONS);
    expect(site?.metadata.imageCredit).toBeUndefined();
  });
});

describe('the tags a site carries', () => {
  it('reads the criteria out of the field the dataset actually has', () => {
    // `criteria_txt`. The importer asked for `criteria` until 2026-08-21, a name
    // whc001 does not define, so every one of the 1272 imported sites carried no
    // criterion tag — a whole facet missing with nothing anywhere saying so.
    const tags = buildUnescoTags(record({ id_no: '208', criteria_txt: '(i)(ii)(iii)(iv)' }));

    expect(tags).toEqual(['criterion_i', 'criterion_ii', 'criterion_iii', 'criterion_iv']);
  });

  it('reads the portal yes, which is the string "True"', () => {
    // Not the number 1, which is what the code compared against: measured on
    // the live data, 58 sites are in danger and 51 cross a border, and the
    // database held 0 of each.
    const tags = buildUnescoTags(record({ danger: 'True', transboundary: 'True' }));

    expect(tags).toEqual(['in_danger', 'transboundary']);
  });

  it('takes a real boolean too, in case the portal ever sends one', () => {
    expect(buildUnescoTags(record({ transboundary: true }))).toEqual(['transboundary']);
    expect(buildUnescoTags(record({ transboundary: 1 }))).toEqual(['transboundary']);
  });

  it('does not read "False" as a yes', () => {
    expect(buildUnescoTags(record({ danger: 'False', transboundary: 'False' }))).toEqual([]);
  });

  it('still calls a site listed in danger in danger, whatever the flag says', () => {
    // `danger_list` is the dated record of it, and it is what kept the tag
    // alive through the four years the flag was never read.
    expect(buildUnescoTags(record({ danger: 'False', danger_list: 'Y 2003' })))
      .toEqual(['in_danger']);
  });
});

describe('whether a site is listed in danger', () => {
  it('reads the flag the portal sets on all 58 of them', () => {
    expect(isInDanger(record({ danger: 'True' }))).toBe(true);
  });

  it('reads the dated listing too, so one field emptied cannot end the answer', () => {
    // The flag went unread for four years because it was compared against the
    // number 1 while the portal sends the string "True". `danger_list` is what
    // kept the tag alive through it, and the badge now stands on both.
    expect(isInDanger(record({ danger: 'False', danger_list: 'Y 2003' }))).toBe(true);
  });

  it('leaves a site the source has taken off the list alone', () => {
    // Belize Barrier Reef Reserve System, delisted in 2018: the portal answers
    // `danger: "False"` with an empty `danger_list`, and a site off the list
    // must not be badged as on it.
    expect(isInDanger(record({ id_no: '764', danger: 'False', danger_list: null }))).toBe(false);
  });

  it('is the same answer the tag carries', () => {
    // Two representations of one fact, written from one predicate: a database
    // whose tag and whose flag disagree about the same site is what this pins.
    for (const r of [
      record({ danger: 'True', danger_list: 'Y 2013' }),
      record({ danger: 'False', danger_list: 'Y 2003' }),
      record({ danger: 'False', danger_list: null }),
    ]) {
      expect(buildUnescoTags(r).includes('in_danger')).toBe(isInDanger(r));
    }
  });
});

describe('the row a record becomes', () => {
  it('carries the danger listing the badge reads, and the year under it', () => {
    // Ancient City of Aleppo, danger-listed since 2013. `metadata.inDanger` is
    // the field every "In Danger" surface keys on; it was false on all 1272
    // rows in the catalogue, Aleppo included.
    const aleppo = transformRecord(record({
      id_no: '21',
      name_en: 'Ancient City of Aleppo',
      danger: 'True',
      danger_list: 'Y 2013',
      coordinates: { lat: 36.199, lon: 37.163 },
    }));

    expect(aleppo?.metadata.inDanger).toBe(true);
    expect(aleppo?.metadata.dangerList).toBe('Y 2013');
    expect(aleppo?.tags).toContain('in_danger');
  });

  it('leaves the flag false for a site nothing lists', () => {
    const garamba = transformRecord(record({ coordinates: { lat: 4.1, lon: 29.5 } }));

    expect(garamba?.metadata.inDanger).toBe(false);
  });
});
