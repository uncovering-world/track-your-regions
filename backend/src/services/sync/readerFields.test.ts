import { describe, expect, it } from 'vitest';
import { PLACE_FIELD_MARKS, placeFieldMark } from '@tyr/shared/readerFields';
import { computeChangeSet, SYNC_OWNED_METADATA_KEYS, type ExperienceSnapshot } from './changeSet.js';
import { FAMILY_FIELDS } from './fieldFamilies.js';

/**
 * Every field a run writes carries a mark saying whether a reader is shown it
 * (#1834, ADR-0139), so the gate never decides one by default.
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
 * The metadata keys the runs write: each family's own (`FAMILY_FIELDS`, read
 * off the stored places), the keys a run computes about its pass, and the two
 * both families write and neither owns, the Wikipedia article and the
 * picture's credit.
 */
const METADATA_KEYS = [...new Set([
  ...FAMILY_FIELDS.unesco.metadata, ...FAMILY_FIELDS.wikidata.metadata, ...SYNC_OWNED_METADATA_KEYS,
  'wikipediaUrl', 'imageCredit',
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
    expect(Object.keys(PLACE_FIELD_MARKS).filter(field => !written.has(field))).toEqual([]);
  });
});
