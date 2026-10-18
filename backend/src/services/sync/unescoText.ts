/**
 * A name as the World Heritage Centre's feed writes it, read as plain text
 * (#1610). The feed marks a foreign term in italics with inline HTML
 * ("Via Appia. <em>Regina Viarum</em>", "<I>Sacri Monti</I> of Piedmont and
 * Lombardy"), and a name stored that way is drawn with its tags, since the
 * screens escape what they show.
 *
 * - An underline carries a letter, not a style: it marks the letter's macron
 *   below, as Haida and Pitjantjatjara write them. `S<U>G</U>ang Gwaay` is
 *   SG̱ang Gwaay and `Ulu<U>r</U>u-Kata Tju<U>t</U>a` is Uluṟu-Kata Tjuṯa,
 *   composed where Unicode has the letter (ṟ, ṯ) and combining where it does
 *   not (G̱).
 * - A line break is a space: Auschwitz Birkenau's name runs on in a
 *   `<small>` after it.
 * - Every other tag (`em`, `i`, `small`, `sup`) is presentation, and goes.
 *
 * Then the name is tidied as every stored name is (`tidyLabel`).
 */

import { tidyLabel } from '@tyr/shared/labels';

/** U+0331, combining macron below. */
const MACRON_BELOW = '̱';

export function feedText(value: string): string {
  let text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<u>([^<]*)<\/u>/gi, (_tag, letters: string) => [...letters].map(letter => letter + MACRON_BELOW).join(''));
  // Until nothing changes, so a tag that dropping another one assembles goes too.
  let before: string;
  do {
    before = text;
    text = text.replace(/<\/?[a-z][^<>]*>/gi, '');
  } while (text !== before);
  return tidyLabel(text.normalize('NFC'));
}
