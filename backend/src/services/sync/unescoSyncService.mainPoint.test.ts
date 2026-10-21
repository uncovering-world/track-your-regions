/**
 * Tests for the site's main point.
 *
 * UNESCO leaves `geo_point_2d` null on serial nominations and puts the real
 * positions in `components_list`. Requiring the main field discarded 28 of the
 * 29 records that failed the dry run of 3 August — including sites already in
 * the catalogue whose main field the source has since emptied.
 */

import { describe, it, expect } from 'vitest';
import { resolveMainPoint, buildUnescoTags, isInDanger, parseDelimitedField, transformRecord } from './unescoSyncService.js';
import type { UnescoApiRecord, ParsedLocation } from './types.js';

function record(overrides: Partial<UnescoApiRecord> = {}): UnescoApiRecord {
  return { id_no: '136', name_en: 'Garamba National Park', category: 'Natural', ...overrides };
}

/** A `components_list` as the dataset writes it since 2026-10-20 (#1803). */
const components = (...entries: Array<{ name: string; ref: string; latitude: number; longitude: number }>) =>
  JSON.stringify(entries);

function component(overrides: Partial<ParsedLocation> = {}): ParsedLocation {
  return { name: 'Weiße Stadt', externalRef: '1239bis-005', lat: 52.5694, lon: 13.3508, ...overrides };
}

describe('resolveMainPoint', () => {
  it('uses the site\'s own coordinates when the source provides them', () => {
    const point = resolveMainPoint(record({ geo_point_2d: { lat: -2.3333, lon: 34.8333 } }), []);

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
      record({ geo_point_2d: { lat: 1, lon: 2 } }),
      [component({ lat: 50, lon: 50 })],
    );

    expect(point).toEqual({ lat: 1, lon: 2 });
  });

  it("takes the most central component of a site of several, whatever the site's own coordinate says (ADR-0095)", () => {
    // The Danube Limes' export coordinate followed the first component listed
    // (Carnuntum, then Linz); the site is its components.
    const point = resolveMainPoint(record({ geo_point_2d: { lat: 48.1152, lon: 16.8614 } }), [
      component({ lat: 48.2262, lon: 14.5507 }),
      component({ lat: 48.1152, lon: 16.8614 }),
      component({ lat: 48.2, lon: 15.6 }),
    ]);

    expect(point).toEqual({ lat: 48.2, lon: 15.6 });
  });

  it('marks the point of a site of several components as its anchor, and a single place\'s as its own', () => {
    const serial = transformRecord(record({
      geo_point_2d: { lat: 48.1152, lon: 16.8614 },
      components_list: components(
        { name: 'Carnuntum', ref: '1608-001', latitude: 48.1152, longitude: 16.8614 },
        { name: 'Enns', ref: '1608-002', latitude: 48.2262, longitude: 14.5507 },
      ),
    }));
    expect(serial?.locationIsAnchor).toBe(true);
    expect(transformRecord(record({ geo_point_2d: { lat: 4.1, lon: 29.3 } }))?.locationIsAnchor).toBe(false);
  });

  it('treats a coordinate of zero as a position, not as missing', () => {
    // A site on the equator or the prime meridian; truthiness would send it to
    // the component fallback and move it
    const point = resolveMainPoint(
      record({ geo_point_2d: { lat: 0, lon: 6.6 } }),
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
      record({ geo_point_2d: { lat: 52.5, lon: undefined as unknown as number } }),
      [component({ lat: 10, lon: 20 })],
    );

    expect(point).toEqual({ lat: 10, lon: 20 });
  });
});

describe('the picture a site is shown with', () => {
  const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan.jpg';
  const sited = (overrides: Partial<UnescoApiRecord> = {}) =>
    record({ geo_point_2d: { lat: 34.84, lon: 67.82 }, ...overrides });

  it('does not read the picture the portal offers, whatever it says about it', () => {
    // The World Heritage Centre's terms: its photographs "may not be copied or
    // retransmitted by any means without explicit authorisation", and a site
    // may "only link to, not replicate" its content (ADR-0043, #557).
    // The three fields are not even asked for (`EXPORT_FIELDS`), so a
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

  it('reads the site\'s type from the portal\'s own field, `category`', () => {
    // The portal's word, not this catalogue's: read under any other name the
    // field is absent from every record, and every site is proposed with no
    // type — 1,272 held changes a run, on runs 108 and 141 (#1231).
    expect(transformRecord(sited({ category: 'Cultural' }))?.type).toBe('cultural');
    expect(transformRecord(sited({ category: 'Natural' }))?.type).toBe('natural');
    expect(transformRecord(sited({ category: 'Mixed' }))?.type).toBe('mixed');
  });

  it('links to the property page instead, which those terms invite, as UNESCO\'s own link (#1538)', () => {
    const metadata = transformRecord(sited({ id_no: '208' }))?.metadata;
    expect(metadata?.unescoUrl).toBe('https://whc.unesco.org/en/list/208');
    // The site's own website is the Wikidata kinds' to bring, not this page.
    expect(metadata).not.toHaveProperty('website');
  });

  it('shows the Commons picture Wikidata states, with whoever took it', () => {
    const site = transformRecord(
      sited(),
      { article: 'https://en.wikipedia.org/wiki/Bamiyan', picture: { url: COMMONS, via: 'exact', ref: '208', itemPictures: [COMMONS] } },
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
      { article: null, picture: { url: COMMONS, via: 'component', ref: '208-001', itemPictures: [COMMONS] } },
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
      geo_point_2d: { lat: 36.199, lon: 37.163 },
    }));

    expect(aleppo?.metadata.inDanger).toBe(true);
    expect(aleppo?.metadata.dangerList).toBe('Y 2013');
    expect(aleppo?.tags).toContain('in_danger');
  });

  it('leaves the flag false for a site nothing lists', () => {
    const garamba = transformRecord(record({ geo_point_2d: { lat: 4.1, lon: 29.5 } }));

    expect(garamba?.metadata.inDanger).toBe(false);
  });
});

describe("a site's components (#1803)", () => {
  it('reads each entry of the list, commas in a name included', () => {
    // Two of Aalto Works' components and one of Tashkent Modernist Architecture's.
    const site = transformRecord(record({
      id_no: '1752',
      name_en: 'Aalto Works',
      components_list: components(
        { name: 'Villa Mairea, Pori', ref: '1752-013', latitude: 61.5974091666, longitude: 21.8745822223 },
        { name: 'Experimental House, Muuratsalo, Jyväskylä', ref: '1752-009', latitude: 62.1147980556, longitude: 25.7450022222 },
        { name: 'Zhemchug Residential Building (Zhemchug, the “Pearl”)', ref: '1766-001', latitude: 41.3026833333, longitude: 69.2672222223 },
      ),
    }));

    expect(site?.locations.map(location => location.name)).toEqual([
      'Villa Mairea, Pori',
      'Experimental House, Muuratsalo, Jyväskylä',
      'Zhemchug Residential Building (Zhemchug, the “Pearl”)',
    ]);
    expect(site?.locations.map(location => location.externalRef)).toEqual(['1752-013', '1752-009', '1766-001']);
  });

  it('reads the list as the dataset writes it, from the export', () => {
    // The Bony Fish Fossils of the Western Limfjord (1758), copied from the export.
    const site = transformRecord(record({
      id_no: '1758',
      components_list: '[{"name": "Hanklit", "ref": "1758-001", "latitude": 56.895649, "longitude": 8.751962}, '
        + '{"name": "Knudeklint", "ref": "1758-002", "latitude": 56.838216, "longitude": 8.964653}]',
    }));

    expect(site?.locations.map(location => [location.name, location.externalRef, location.lat, location.lon])).toEqual([
      ['Hanklit', '1758-001', 56.895649, 8.751962],
      ['Knudeklint', '1758-002', 56.838216, 8.964653],
    ]);
  });

  it('keeps a name the source left empty as empty, and skips an entry with no ref or no point', () => {
    // Via Appia's component 1708-003 has an empty name.
    const site = transformRecord(record({
      components_list: JSON.stringify([
        { name: '', ref: '1708-003', latitude: 41.6718, longitude: 12.7273 },
        { name: 'No ref', ref: '', latitude: 41.6, longitude: 12.7 },
        { name: 'No point', ref: '1708-099', latitude: null, longitude: 12.7 },
      ]),
    }));

    expect(site?.locations).toEqual([expect.objectContaining({ name: '', externalRef: '1708-003' })]);
  });

  it('still reads the form the dataset wrote before 2026-10-20, commas in a name included', () => {
    const site = transformRecord(record({
      components_list: '{name: Villa Mairea, Pori, ref: 1752-013, latitude: 61.5974091666, longitude: 21.8745822223}\n'
        + '{name: İstisuchay Valley (Southern HNP), ref: 1584bis-017, latitude: 38.4549666667, longitude: 48.6793027778}',
    }));

    expect(site?.locations.map(location => [location.name, location.externalRef])).toEqual([
      ['Villa Mairea, Pori', '1752-013'],
      ['İstisuchay Valley (Southern HNP)', '1584bis-017'],
    ]);
  });

  it('fails a site whose list is in neither form, rather than read it as no components', () => {
    expect(() => transformRecord(record({ components_list: 'Carnuntum; Enns' }))).toThrow('Components list is not JSON');
    expect(() => transformRecord(record({ components_list: '{"name": "Carnuntum"}' }))).toThrow('not a list');
  });
});

/** A component name the portal sends decoded twice (#1405). */
describe("a component's name", () => {
  const namesOf = (name: string) =>
    transformRecord(record({
      geo_point_2d: { lat: 59.33, lon: 17.55 },
      components_list: components({ name, ref: '555-002', latitude: 59.3333, longitude: 17.55 }),
    }))?.locations.map(location => location.name);

  it('is read once where the portal decoded it twice', () => {
    // Birka and Hovgården (555): the export sends "HovgÃ¥rden", the bytes c3 a5 of "å" as two characters.
    expect(namesOf('HovgÃ¥rden')).toEqual(['Hovgården']);
  });

  it('is kept where it only looks so, or its bytes are not UTF-8', () => {
    expect(namesOf('Kåfjord')).toEqual(['Kåfjord']);
    expect(namesOf('Ã©tude Ãx')).toEqual(['Ã©tude Ãx']);
  });
});

describe("a site's countries", () => {
  it('reads the JSON list the dataset writes since 2026-10-20, and the pieces the portal splits it into', () => {
    // 1567 (France and Belgium) and the Silk Roads' 1675, copied from the export.
    expect(parseDelimitedField('["FR", "BE"]')).toEqual(['FR', 'BE']);
    expect(parseDelimitedField(['["Tajikistan"', '"Uzbekistan"', '"Turkmenistan"]']))
      .toEqual(['Tajikistan', 'Uzbekistan', 'Turkmenistan']);
    expect(transformRecord(record({ geo_point_2d: { lat: 27.7, lon: 88.15 }, iso_codes: '["IN"]', states_names: ['["India"]'] })))
      .toMatchObject({ countryCodes: ['IN'], countryNames: ['India'] });
  });

  it('still reads the forms before it', () => {
    expect(parseDelimitedField('FR,ES')).toEqual(['FR', 'ES']);
    expect(parseDelimitedField(['France', 'Spain'])).toEqual(['France', 'Spain']);
    expect(parseDelimitedField(undefined)).toEqual([]);
  });

  it('fails a list that is not well-formed JSON, rather than write it as a country', () => {
    expect(() => parseDelimitedField('["FR"')).toThrow();
    expect(() => parseDelimitedField(['["France"', '"Belgium"'])).toThrow();
  });
});
