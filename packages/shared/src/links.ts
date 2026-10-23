/**
 * Which address a place's links may hold, declared once for the run that
 * writes a website and the card that shows it (#1851).
 *
 * UNESCO's page about a World Heritage site is the place's `unescoUrl`, which
 * UNESCO's run writes (#1538). Wikidata's official website (P856) of some
 * heritage items is that same page, so a Wikidata kind's run would store it as
 * the place's own website, and the card would show "Official website" and
 * "UNESCO page" opening one page: Gelati Monastery's
 * `http://whc.unesco.org/en/list/710` beside its `https://whc.unesco.org/en/list/710`.
 */

const WORLD_HERITAGE_CENTRE = /^https?:\/\/whc\.unesco\.org(?:[/:?#]|$)/i;

/** Whether an address is the World Heritage Centre's (`whc.unesco.org`), which is never a place's own website. */
export function isWorldHeritageCentreUrl(url: string): boolean {
  return WORLD_HERITAGE_CENTRE.test(url.trim());
}
