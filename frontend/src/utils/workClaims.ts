/**
 * What a work's claims read as on a row: "title corrected", "makers confirmed",
 * "year corrected", "picture corrected", or several of them.
 *
 * The sibling of `placeClaims` one level over (#731). A correction claims the
 * column it changed (`treasures.curated_fields`), and the source stops
 * overwriting it — so without a word on the row, a title a curator fixed reads
 * as the source's, on the very screen where the next curator decides about it.
 *
 * **The makers are "confirmed", not "corrected", and the difference is real.**
 * The stored order is a query planner's rather than the source's (ADR-0040), so
 * claiming that column is often a curator vouching for an order that was already
 * right — the *Visitation* in the Prado lists Penni, Romano and Raphael, and what
 * it needs is somebody to say Raphael led it. "Corrected" would describe that as
 * a change nobody made. The other three are corrections in the ordinary sense.
 *
 * There is no key here for the credit. On a work the picture's claim covers it:
 * `treasureWriter` keeps the row's own `metadata` whenever `image_url` is
 * claimed, so the photograph and the name under it are one claim and read as one
 * word. Anything else in the column is a claim this screen does not know how to
 * describe and is left to the claims screen (#626) rather than guessed at.
 */

/** The columns this screen can put into words, in the order a row names them. */
const CLAIM_WORDS: ReadonlyArray<[key: string, words: string]> = [
  ['name', 'title'],
  ['artists', 'makers'],
  ['year', 'year'],
  ['image_url', 'picture'],
];

export function claimLabel(curatedFields: ReadonlyArray<string> | null | undefined): string | null {
  const claims = new Set(curatedFields ?? []);
  const held = CLAIM_WORDS.filter(([key]) => claims.has(key));
  if (held.length === 0) return null;
  // The makers alone read differently, for the reason the note above gives. In
  // company they take the shared verb: "title and makers corrected" is one act
  // by one person, and spelling out both verbs would make it read as two.
  if (held.length === 1 && held[0][0] === 'artists') return 'makers confirmed';
  const words = held.map(([, word]) => word);
  const list = words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${list} corrected`;
}
