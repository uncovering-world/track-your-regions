/**
 * UNESCO's ten selection criteria, by the numeral the source uses for them.
 *
 * A World Heritage property is inscribed under one or more of these (Operational
 * Guidelines § 77), and the source states them as a string of bracketed numerals —
 * `(i)(ii)(iii)(iv)` for the Bamiyan Valley. To a traveller the criteria are *why* the
 * place is on the List and what to look for once there; to a curator they are what the
 * string is a claim about. Neither is served by the numerals alone, so each carries the
 * criterion's meaning in one line, close to the Guidelines' own wording and shorter.
 *
 * (i)–(vi) are the cultural criteria and (vii)–(x) the natural ones; a property meeting
 * both kinds is what the source calls "mixed". Stated here, because the split is the
 * first thing the numerals mean.
 *
 * Shared knowledge rather than a curation detail: the review card reads it today, and a
 * reader-facing surface that shows criteria (#574) reads the same table.
 */

export interface UnescoCriterion {
  /** The numeral as the source writes it, without brackets: `iv`. */
  numeral: string;
  /** The criterion's meaning, one line. */
  meaning: string;
  kind: 'cultural' | 'natural';
}

const CRITERIA: readonly UnescoCriterion[] = [
  { numeral: 'i', kind: 'cultural', meaning: 'a masterpiece of human creative genius' },
  { numeral: 'ii', kind: 'cultural', meaning: 'an important interchange of human values — in architecture, technology, monumental arts, town planning or landscape design' },
  { numeral: 'iii', kind: 'cultural', meaning: 'a unique or exceptional testimony to a cultural tradition or civilisation, living or vanished' },
  { numeral: 'iv', kind: 'cultural', meaning: 'an outstanding example of a type of building, ensemble or landscape illustrating a stage in human history' },
  { numeral: 'v', kind: 'cultural', meaning: 'an outstanding example of a traditional settlement or land use, especially where it has become vulnerable' },
  { numeral: 'vi', kind: 'cultural', meaning: 'directly associated with events, living traditions, ideas, beliefs or artistic works of outstanding universal significance' },
  { numeral: 'vii', kind: 'natural', meaning: 'superlative natural phenomena or areas of exceptional natural beauty' },
  { numeral: 'viii', kind: 'natural', meaning: 'an outstanding example of major stages of the earth’s history — the record of life, or landforms in the making' },
  { numeral: 'ix', kind: 'natural', meaning: 'outstanding ongoing ecological and biological processes in the evolution of ecosystems' },
  { numeral: 'x', kind: 'natural', meaning: 'the most important natural habitats for the conservation of biodiversity, including threatened species' },
];

const BY_NUMERAL = new Map(CRITERIA.map(c => [c.numeral, c]));

/** The criterion a numeral names, or `null` for a numeral the Guidelines do not have. */
export function unescoCriterion(numeral: string): UnescoCriterion | null {
  return BY_NUMERAL.get(numeral.toLowerCase()) ?? null;
}

/**
 * The criteria a source string names, in the order it names them.
 *
 * Reads the same shape the importer reads (`buildUnescoTags`): bracketed numerals, any
 * case, with nothing else in the string mattering. A numeral the Guidelines do not have
 * is kept rather than dropped, with no meaning attached — the string is a claim by the
 * source, and a card that silently lost part of it would misreport the claim.
 */
export function parseCriteria(text: string): Array<UnescoCriterion | { numeral: string; meaning: null; kind: null }> {
  const matches = text.match(/\(([ivx]+)\)/gi) ?? [];
  return matches.map((match) => {
    const numeral = match.replace(/[()]/g, '').toLowerCase();
    return unescoCriterion(numeral) ?? { numeral, meaning: null, kind: null };
  });
}
