import { describe, expect, it } from 'vitest';
import { FAMILY_FIELDS, keptForFamilies } from './fieldFamilies.js';

/**
 * A run writes another family's fields as the place holds them (ADR-0109,
 * #1534): the Acropolis keeps UNESCO's names, text, states and inscription
 * facts under an Archaeology run that reads none of them.
 */

const STORED = {
  name_local: { en: 'Acropolis, Athens', fr: "Acropole d'Athènes" },
  short_description: 'The Acropolis of Athens and its monuments are universal symbols of the classical spirit.',
  country_codes: ['GR'],
  metadata: { dateInscribed: '1987', inDanger: false, wikidataQid: 'Q131013' },
};
const RUN = {
  nameLocal: { en: 'Acropolis of Athens' },
  shortDescription: null,
  countryCodes: [],
  metadata: { wikidataQid: 'Q131013', website: 'https://odysseus.culture.gr/' },
};

describe('keeping the fields another family of sources brings (#1534)', () => {
  it('puts back UNESCO\'s fields and leaves the run\'s own and the shared ones', () => {
    expect(keptForFamilies(RUN, STORED, FAMILY_FIELDS.unesco)).toEqual({
      nameLocal: STORED.name_local,
      shortDescription: STORED.short_description,
      countryCodes: ['GR'],
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
