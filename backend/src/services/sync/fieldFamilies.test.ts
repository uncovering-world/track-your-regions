import { describe, expect, it } from 'vitest';
import { FAMILY_FIELDS, fieldsOfOthers, keptForFamilies, WRITTEN_BY_SOURCES } from './fieldFamilies.js';

/**
 * A run writes another family's fields as the place holds them (ADR-0109,
 * #1534): the Acropolis keeps UNESCO's names, text, states and page under an
 * Archaeology run that reads none of them. Its inscription facts are not the
 * place's at all: they are on its World Heritage membership (#2068).
 */

const STORED = {
  name_local: { en: 'Acropolis, Athens', fr: "Acropole d'Athènes" },
  description: 'The Acropolis of Athens and its monuments are universal symbols of the classical spirit.',
  country_codes: ['GR'],
  country_names: ['Greece'],
  metadata: { unescoUrl: 'https://whc.unesco.org/en/list/404', wikidataQid: 'Q131013' },
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
      metadata: {
        wikidataQid: 'Q131013', website: 'https://odysseus.culture.gr/',
        unescoUrl: 'https://whc.unesco.org/en/list/404',
      },
    });
  });

  it('drops a key of the other family the place does not hold, rather than writing the run\'s', () => {
    const kept = keptForFamilies({ ...RUN, metadata: { ...RUN.metadata, unesco: { description: true } } }, STORED, FAMILY_FIELDS.unesco);
    expect(kept.metadata).not.toHaveProperty('unesco');
  });

  it('changes nothing where no other family holds the place', () => {
    expect(keptForFamilies(RUN, STORED, { columns: [], metadata: [] })).toBe(RUN);
  });
});

describe("UNESCO's page about a site (#1851)", () => {
  it('is kept on a place no UNESCO membership holds, and written by UNESCO\'s own run', () => {
    // Khajuraho's place of worship carries the page migration 107 moved out of its website.
    expect(fieldsOfOthers(2, []).metadata).toContain('unescoUrl');
    expect(fieldsOfOthers(4, [2]).metadata).toContain('unescoUrl');
    expect(fieldsOfOthers(1, []).metadata).not.toContain('unescoUrl');
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

describe('whom or what a place commemorates, which only Public art and Monuments & memorials read (#2144)', () => {
  const LINCOLN = { via: 'commemorates', subjects: [{ item: 'Q91', label: 'Abraham Lincoln', articleUrl: null }] };

  it('is written by Public art and Monuments & memorials, and kept by another source while one of them stands', () => {
    expect([...WRITTEN_BY_SOURCES.commemorates]).toEqual([3, 6]);
    for (const sourceId of [3, 6]) expect([sourceId, fieldsOfOthers(sourceId, [4]).metadata.includes('commemorates')]).toEqual([sourceId, false]);
    // A memorial church's worship run, UNESCO's and Towers' runs keep it while a writer's membership stands.
    for (const [sourceId, others] of [[4, [6]], [1, [3]], [7, [6]], [4, [3, 6]]] as const) {
      expect([sourceId, fieldsOfOthers(sourceId, others).metadata.includes('commemorates')]).toEqual([sourceId, true]);
    }
    // Once Monuments & memorials refused the place, or never held it, no writer stands behind the value:
    // the run's own record, which has none, goes to the gate as a removal (ADR-0190).
    for (const [sourceId, others] of [[4, []], [5, [4]], [2, []], [8, [7]], [9, []]] as const) {
      expect([sourceId, fieldsOfOthers(sourceId, others).metadata.includes('commemorates')]).toEqual([sourceId, false]);
    }
    // A refusal leaves the membership listed: Monuments & memorials still lists the memorial church,
    // and refused it, so it stands behind nothing it wrote.
    expect(fieldsOfOthers(4, [6], []).metadata).not.toContain('commemorates');
    expect(fieldsOfOthers(4, [3, 6], [3]).metadata).toContain('commemorates');
    // The family fields still follow every standing membership, admitted or not.
    expect(fieldsOfOthers(2, [1], []).metadata).toContain('unescoUrl');
  });

  it('is put back as the place holds it under a run that does not write it, and left out where the place holds none', () => {
    const stored = { ...STORED, metadata: { ...STORED.metadata, commemorates: LINCOLN } };
    const worship = fieldsOfOthers(4, [6]);
    expect(keptForFamilies(RUN, stored, worship).metadata).toHaveProperty('commemorates', LINCOLN);
    expect(keptForFamilies({ ...RUN, metadata: { ...RUN.metadata, commemorates: LINCOLN } }, STORED, worship).metadata)
      .not.toHaveProperty('commemorates');
  });
});
