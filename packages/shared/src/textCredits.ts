/**
 * Whose text a place's description is, and the credit that goes with it — the
 * rule the storing side and the drawing side apply alike (ADR-0149).
 *
 * The UNESCO run copies the World Heritage Centre's short description of each
 * property from `whc001` on data.unesco.org, which UNESCO publishes under
 * CC BY-SA 4.0. The licence asks that whoever reads the text sees who wrote it
 * and under what licence, wherever it is shown. The run stamps the licence on
 * the row it writes (`metadata.unesco`), a read names the description's source
 * (`description_source`), and `DescriptionText` draws the text and this credit
 * together. Declared once, so the licence the row records and the licence the
 * reader is shown cannot drift apart.
 */

/** The sources whose text a description may be. */
export const TEXT_SOURCES = ['unesco'] as const;

export type TextSource = (typeof TEXT_SOURCES)[number];

export interface TextCredit {
  /** Who wrote the text, as the licence asks it to be named. */
  holder: string;
  /** The licence's short name. */
  licence: string;
  licenceUrl: string;
  /** Where the text was taken from. */
  sourceUrl: string;
}

export const TEXT_CREDITS: Readonly<Record<TextSource, TextCredit>> = {
  unesco: {
    holder: 'UNESCO World Heritage Centre',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://data.unesco.org/explore/dataset/whc001/',
  },
};
