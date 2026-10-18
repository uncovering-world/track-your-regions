import { describe, expect, it } from 'vitest';
import { FAMILY_FIELDS, fieldsOfOthers, keptForFamilies } from './fieldFamilies.js';

/**
 * A run writes another family's fields as the place holds them (ADR-0109,
 * #1534): the Acropolis keeps UNESCO's names, text, states and inscription
 * facts under an Archaeology run that reads none of them.
 */

const STORED = {
  name_local: { en: 'Acropolis, Athens', fr: "Acropole d'Athènes" },
  short_description: 'The Acropolis of Athens and its monuments are universal symbols of the classical spirit.',
  country_codes: ['GR'],
  country_names: ['Greece'],
  metadata: { dateInscribed: '1987', inDanger: false, wikidataQid: 'Q131013' },
};
const RUN = {
  nameLocal: { en: 'Acropolis of Athens' },
  shortDescription: null,
  countryCodes: [],
  countryNames: ['Hellenic Republic'],
  metadata: { wikidataQid: 'Q131013', website: 'https://odysseus.culture.gr/' },
};

describe('keeping the fields another family of sources brings (#1534)', () => {
  it('puts back UNESCO\'s fields and leaves the run\'s own and the shared ones', () => {
    expect(keptForFamilies(RUN, STORED, FAMILY_FIELDS.unesco)).toEqual({
      nameLocal: STORED.name_local,
      shortDescription: STORED.short_description,
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

describe('keeping the question another source of the place asks', () => {
  // The Church of Our Lady in Bruges is held by Art Museums (source 2) for
  // Michelangelo's Madonna and by Places of worship (4): two runs of one
  // family, each asking its own question. A museum run, a worship run and a
  // museum run again leave the other's question where it was and clear only
  // their own.
  const MUSEUM_NOTE = "Admitted for Michelangelo's Madonna of Bruges, below the sitelinks line.";
  const WORSHIP_NOTE = 'Admitted for its readers, below the sitelinks line.';
  const record = (metadata: Record<string, unknown>) => ({ ...RUN, metadata });
  const stored = (metadata: Record<string, unknown>) => ({ ...STORED, metadata });

  it('writes the other source\'s question as the place holds it, run after run', () => {
    const afterMuseum = keptForFamilies(
      record({ wikidataQid: 'Q917183', museumReadershipNote: null }),
      stored({ wikidataQid: 'Q917183', museumReadershipNote: MUSEUM_NOTE, worshipReadershipNote: WORSHIP_NOTE }),
      fieldsOfOthers(2, [4]),
    ).metadata;
    expect(afterMuseum).toEqual({ wikidataQid: 'Q917183', museumReadershipNote: null, worshipReadershipNote: WORSHIP_NOTE });

    const afterWorship = keptForFamilies(
      record({ wikidataQid: 'Q917183', worshipReadershipNote: null }),
      stored({ ...afterMuseum, museumReadershipNote: MUSEUM_NOTE }), fieldsOfOthers(4, [2]),
    ).metadata;
    expect(afterWorship).toEqual({ wikidataQid: 'Q917183', museumReadershipNote: MUSEUM_NOTE, worshipReadershipNote: null });

    const afterMuseumAgain = keptForFamilies(
      record({ wikidataQid: 'Q917183', museumReadershipNote: MUSEUM_NOTE }),
      stored({ ...afterWorship, worshipReadershipNote: WORSHIP_NOTE }), fieldsOfOthers(2, [4]),
    ).metadata;
    expect(afterMuseumAgain).toEqual({ wikidataQid: 'Q917183', museumReadershipNote: MUSEUM_NOTE, worshipReadershipNote: WORSHIP_NOTE });
  });

  it('keeps Archaeology\'s question under a museum run on a place Archaeology holds', () => {
    // The Israel Museum, held by Archaeology (5) with its doubt written down.
    const note = 'an antiquities department; is the exposition substantially archaeology?';
    const kept = keptForFamilies(
      record({ wikidataQid: 'Q46815', museumReadershipNote: null }),
      stored({ wikidataQid: 'Q46815', admissionNote: note }), fieldsOfOthers(2, [5]),
    );
    expect(kept.metadata).toEqual({ wikidataQid: 'Q46815', museumReadershipNote: null, admissionNote: note });
  });

  it('keeps no question of a source whose membership no longer stands', () => {
    expect(fieldsOfOthers(2, []).metadata).toEqual([]);
  });
});
