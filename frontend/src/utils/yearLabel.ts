/**
 * "100 BC", "AD 200", "1889" — a work's year as a person reads it.
 *
 * `treasures.year` is a signed integer, and the sign is storage: the *Borghese
 * Gladiator* stands in the Louvre carved around 100 BC, and a row reading "-100"
 * beside "1503" is the database showing through. The catalogue reaches back a
 * long way — the Lion man of the Hohlenstein Stadel in Museum Ulm is 38000 BC —
 * so this is not an edge case dressed as one.
 *
 * Both sides of zero are written out, and that is the whole reason the era is
 * ever printed: "statue · 200" beside "statue · 200 BC" reads as a typo rather
 * than as four hundred years apart. Past the first millennium the era is
 * dropped, since nobody reads 1889 as anything else.
 *
 * A BC magnitude is grouped and a year is not: "1503" is a year and "1,503"
 * reads as a quantity, but "400,000 BC" is a number before it is a date and
 * "400000 BC" has to be counted.
 *
 * One rule in one place (#731). Before it there were three spellings: the works
 * preview's, which this is; nothing at all on the three surfaces that printed the
 * stored integer, so the same sculpture read "100 BC" in a tooltip and "-100" on
 * the card underneath it; and a second rule of its own in `fieldMeaning`, which
 * dropped the era under a thousand and grouped large negatives — putting
 * "38,000 BC" in a held work's change row directly above "38000 BC" on the row
 * that lists it. All of them read this now.
 */
/**
 * Grouped digits, for the one place a year wants them.
 *
 * A year is written without separators — "1503", never "1,503" — but a
 * Palaeolithic date is a number before it is a year, and "400000 BC" has to be
 * counted rather than read. So grouping applies to the magnitude of a BC date
 * and nowhere else.
 */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function yearLabel(year: number | null | undefined): string | null {
  if (year === null || year === undefined) return null;
  if (year < 0) return `${grouped.format(-year)} BC`;
  return year < 1000 ? `AD ${year}` : String(year);
}
