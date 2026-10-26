import { describe, expect, it } from 'vitest';
import { FAMILY_FIELDS, fieldsOfOthers, keptForFamilies } from './fieldFamilies.js';

/**
 * A run writes another family's fields as the place holds them (ADR-0109,
 * #1534): the Acropolis keeps UNESCO's names, text, states and inscription
 * facts under an Archaeology run that reads none of them.
 */

const STORED = {
  name_local: { en: 'Acropolis, Athens', fr: "Acropole d'Athènes" },
  description: 'The Acropolis of Athens and its monuments are universal symbols of the classical spirit.',
  country_codes: ['GR'],
  country_names: ['Greece'],
  metadata: { dateInscribed: '1987', inDanger: false, wikidataQid: 'Q131013' },
};
const RUN = {
  nameLocal: { en: 'Acropolis of Athens' },
  description: null,
  countryCodes: [],
  countryNames: ['Hellenic Republic'],
  metadata: { wikidataQid: 'Q131013', website: 'https://odysseus.culture.gr/' },
};

describe('keeping the fields another family of sources brings (#1534)', () => {
  it('puts back UNESCO\'s fields and leaves the run\'s own and the shared ones', () => {
    expect(keptForFamilies(RUN, STORED, FAMILY_FIELDS.unesco)).toEqual({
      nameLocal: STORED.name_local,
      description: STORED.description,
      countryCodes: ['GR'],
      countryNames: ['Greece'],
      metadata: { wikidataQid: 'Q131013', website: 'https://odysseus.culture.gr/', dateInscribed: '1987', inDanger: false },
    });
  });

  it('drops a key of the other family the place does not hold, rather than writing the run\'s', () => {
    const kept = keptForFamilies({ ...RUN, metadata: { ...RUN.metadata, region: 'Europe' } }, STORED, FAMILY_FIELDS.unesco);
    expect(kept.metadata).not.toHaveProperty('region');
  });

  it('changes nothing where no other family holds the place', () => {
    expect(keptForFamilies(RUN, STORED, { columns: [], metadata: [] })).toBe(RUN);
  });
});

describe("UNESCO's page about a site (#1851)", () => {
  it('is kept on a place no UNESCO membership holds, and written by UNESCO\'s own run', () => {
    // Khajuraho's place of worship carries the page migration 107 moved out of its website.
    expect(fieldsOfOthers(2, []).metadata).toEqual(['unescoUrl']);
    expect(fieldsOfOthers(4, [2]).metadata).toContain('unescoUrl');
    expect(fieldsOfOthers(1, []).metadata).toEqual([]);
  });
});

describe('a kind\'s own field, which no family keeps (ADR-0153)', () => {
  it('is never written as the place holds it, since it is not stored on the place', () => {
    // Charminar is held by Places of worship (4) and by Monuments & memorials
    // (6): the year and makers Monuments reads, and each kind's question to a
    // curator, are on each kind's membership, where a worship run never writes.
    for (const [sourceId, others] of [[4, [6]], [6, [3]], [2, [4, 5]], [7, [6, 8]], [1, [3, 4, 5, 6]]] as const) {
      const kept = fieldsOfOthers(sourceId, others).metadata;
      for (const key of ['year', 'creators', 'admissionNote', 'wikidataClasses', 'artworkCount']) {
        expect([sourceId, key, kept.includes(key)]).toEqual([sourceId, key, false]);
      }
    }
  });
});
