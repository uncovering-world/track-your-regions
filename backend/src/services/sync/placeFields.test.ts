import { describe, expect, it } from 'vitest';
import { PLACE_FIELDS, placeFieldMark } from '@tyr/shared/placeFields';
import { computeChangeSet, SYNC_OWNED_METADATA_KEYS, type ExperienceSnapshot } from './changeSet.js';
import { FAMILY_FIELDS } from './fieldFamilies.js';
import { KIND_FACT_KEYS } from './kindFacts.js';

/**
 * Every field a run writes carries a mark saying whether a reader is shown it
 * (#1834, ADR-0139), so the gate never decides one by default, and says whose
 * it is, the place's or one kind's (ADR-0153).
 */

const EVERY_FIELD: ExperienceSnapshot = {
  name: 'a', nameLocal: { en: 'a' }, subtitle: 'a', description: 'a', type: 'a', tags: ['a'],
  lon: 0, lat: 0, countryCodes: ['AA'], countryNames: ['A'], imageUrl: 'a',
  metadata: {}, boundary: { hash: 'a', areaKm2: 1 },
};
const OTHER_VALUES: ExperienceSnapshot = {
  name: 'b', nameLocal: { en: 'b' }, subtitle: 'b', description: 'b', type: 'b', tags: ['b'],
  lon: 1, lat: 1, countryCodes: ['BB'], countryNames: ['B'], imageUrl: 'b',
  metadata: {}, boundary: { hash: 'b', areaKm2: 2 },
};

/**
 * The metadata keys the runs write: each family's own on the place
 * (`FAMILY_FIELDS`), the keys a kind's run keeps on its membership, the keys a
 * run computes about its pass, and the two both families write and neither
 * owns, the Wikipedia article and the picture's credit.
 */
const METADATA_KEYS = [...new Set([
  ...FAMILY_FIELDS.unesco.metadata, ...FAMILY_FIELDS.wikidata.metadata, ...KIND_FACT_KEYS,
  ...SYNC_OWNED_METADATA_KEYS, 'wikipediaUrl', 'imageCredit',
])];

describe('the reader mark of every field a run writes', () => {
  it('marks every column the change record can name', () => {
    const fields = computeChangeSet(EVERY_FIELD, OTHER_VALUES, [], false).changedFields.map(f => f.field);
    // Tags are compared nowhere (#570), and written all the same.
    for (const field of [...fields, 'tags']) expect([field, placeFieldMark(field)]).not.toEqual([field, null]);
    expect(fields).toContain('nameLocal.en');
  });

  it('marks every metadata key a run writes', () => {
    for (const key of METADATA_KEYS) {
      expect([key, placeFieldMark(`metadata.${key}`)]).not.toEqual([key, null]);
    }
  });

  it('has no mark for a field no run writes', () => {
    const written = new Set([
      ...computeChangeSet(EVERY_FIELD, OTHER_VALUES, [], false).changedFields.map(f => f.field.replace(/^nameLocal\..*/, 'nameLocal')),
      'tags',
      ...METADATA_KEYS.map(key => `metadata.${key}`),
    ]);
    expect(Object.keys(PLACE_FIELDS).filter(field => !written.has(field))).toEqual([]);
  });
});

describe('whose each field is', () => {
  it('keeps no kind\'s field among the keys a family stores on the place', () => {
    // A kind's field on the place is written over by every other kind's run
    // of it (ADR-0153): Charminar kept Monuments & memorials' year under
    // Places of worship, and UNESCO's inscription is its membership's (#2068).
    for (const family of [FAMILY_FIELDS.wikidata, FAMILY_FIELDS.unesco]) {
      for (const key of family.metadata) expect([key, PLACE_FIELDS[`metadata.${key}`]?.owner]).toEqual([key, 'place']);
    }
  });

  it('shows a reader only the inscription\'s year and danger listing among the facts a membership stores', () => {
    // The membership's unseen facts are written as the run read them, held or
    // not. The three a reader is shown -- the year inscribed, the danger flag
    // and its listing (#2068) -- are kept on a held membership until a curator
    // publishes them (`heldFacts`).
    const shown = KIND_FACT_KEYS.filter(key => placeFieldMark(`metadata.${key}`) === 'shown');
    expect(shown.sort()).toEqual(['dangerList', 'dateInscribed', 'inDanger']);
    expect(KIND_FACT_KEYS).toEqual(expect.arrayContaining(['year', 'creators', 'admissionNote', 'wikidataClasses', 'criteria']));
  });
});
