/**
 * A refusal in two sizes: one line to read, and the reasoning behind it on demand.
 *
 * A curator works down nineteen of these at a sitting, so the card gets a short sentence
 * in words. The rule's own text — `painting-share: 2 painting(s) vs 9 sculptural work(s)`,
 * `site, not a venue: church building` — names internal tests, states no thresholds and
 * never says where its numbers came from. Read once it is opaque; read nineteen times it
 * is noise. It is still what was recorded, so it moves into the help rather than out of
 * the product.
 *
 * Each summary also names the phrase worth hovering — the count of works, or the work
 * that dragged a building into the list — so the card can show *which* works those are.
 * "0 of 5" is a claim a curator cannot check; five named sculptures is one they can.
 */

import { plural } from '../../utils/plural';

/** `painting-share: 2 painting(s) vs 9 sculptural work(s)` — the art test's own form. */
const PAINTING_SHARE = /painting-share:\s*(\d+)\s+painting\(s\)\s+vs\s+(\d+)\s+sculptural work\(s\)/;
/**
 * `site, not a venue: church building; Catholic cathedral — named by X (24 sitelinks)`.
 *
 * Split on the dash rather than matched in one expression: the optional trailing clause
 * with two unbounded runs inside it is the backtracking shape the linter refuses.
 */
const SITE_NOT_VENUE = 'site, not a venue:';

const NOTHING_TO_JUDGE = 'no famous holding to judge by';
const BY_HAND = 'editorial exclusion:';
const KILL_LIST = 'kill-list:';
const NOT_A_MUSEUM = 'not a museum class';
const NO_COORDS = 'no coordinates of its own';
const DISSOLVED = 'dissolved ';

/** The clause every venue-test verdict ends with, and the two readings of it below. */
const NAMED_BY = ' — named by ';

/** The work named after that clause, when the rule named one. */
function namedBy(reason: string): string | null {
  const at = reason.indexOf(NAMED_BY);
  if (at < 0) return null;
  const tail = reason.slice(at + NAMED_BY.length);
  const bracket = tail.lastIndexOf(' (');
  return (bracket > 0 ? tail.slice(0, bracket) : tail).trim() || null;
}

/**
 * The verdict without the clause naming the work that brought the place in.
 *
 * Cut at that exact marker rather than at the first dash: the verdicts themselves carry
 * dashes — four of the six kill-list classes read like `art collection — a holding, not a
 * place`, and the half after the dash is the half that says why. Cutting early leaves
 * "Not a place you visit: art collection." and throws away the reason for saying so.
 */
function withoutNamedBy(text: string): string {
  const at = text.indexOf(NAMED_BY);
  return (at < 0 ? text : text.slice(0, at)).trim();
}

export interface RefusalLine {
  text: string;
  /** The phrase in `text` the works are behind, when there are works to show. */
  highlight?: string;
  /**
   * How many works the phrase claims, when it claims a number.
   *
   * The card carries at most twelve of them, so a venue with more would otherwise promise
   * a number and show fewer — the preview has to say what it is not showing.
   */
  worksTotal?: number;
  /**
   * The single work the phrase names, when it names one instead of counting.
   *
   * The preview shows the whole holding either way; this is what lets it put the named
   * work first and label the others, rather than answering "which work" with three.
   */
  namedWork?: string;
}

/** Where every count in these reasons comes from, said once and reused. */
const WHERE_THE_WORKS_COME_FROM =
  'The count is not the collection — nobody publishes those. It is the works Wikidata lists as '
  + 'held here that are famous enough to carry their own page in several languages, which is the '
  + 'same handful we would show a traveller.';

/**
 * How the art test read, in words that bend with its numbers.
 *
 * Its own function because every count-dependent word here has to agree, including the
 * one that reads worst: twelve of the twenty-two refusals on this catalogue weigh exactly
 * one work, so "of the 1 famous works" would be the page's most-read sentence rather than
 * an edge case.
 */
function paintingShareLine(paintings: number, total: number): RefusalLine {
  if (total === 1) {
    // Both sentences open with the phrase, in the same casing, because the card finds it
    // by an exact `indexOf`: a capitalised sentence over a lower-case `highlight` is not a
    // near miss, it is the hover silently not existing on the commonest refusal there is.
    const one = 'The one famous work listed here';
    return paintings === 1
      ? { text: `${one} is a painting, and one work is not a collection.`, highlight: one, worksTotal: 1 }
      : { text: `${one} is a sculpture, not a painting.`, highlight: one, worksTotal: 1 };
  }

  const works = `${plural(total, 'famous work')} listed here`;
  if (paintings === 0) {
    return {
      text: `None of the ${works} is a painting — this reads as sculpture or antiquities.`,
      highlight: works,
      worksTotal: total,
    };
  }
  return {
    text: `Only ${paintings} of the ${works} ${paintings === 1 ? 'is a painting' : 'are paintings'}`
      + ' — the rest is sculpture.',
    highlight: works,
    worksTotal: total,
  };
}

/**
 * The object's own name, dropped from a note that opens with it.
 *
 * Both hand-written exclusions on this catalogue start by naming the venue, because they
 * were written where nothing else did. On a card the name is already the heading two lines
 * up, so repeating it costs the reader the start of every such sentence.
 */
function withoutLeadingName(text: string, name: string | undefined): string {
  if (!name) return text;
  for (const separator of [' — ', ': ', ', ']) {
    const opening = name + separator;
    if (text.startsWith(opening)) return text.slice(opening.length);
  }
  return text;
}

/**
 * The class the rule named, as the opening of an English sentence.
 *
 * The classes are written for a rule, not for a sentence, and two of the six say so out
 * loud: `archaeological park` takes "an", and `roman ruins` is plural and takes no article
 * at all. This is the first thing on the card and the sentence a curator reads before any
 * other, so "A archaeological park" is not a small thing to leave in it.
 */
function openingFor(kind: string): string {
  // Plural: not "a roman ruins" but "Roman ruins" — and the capital the class map omits,
  // since with no article in front of it the class now opens the sentence itself.
  if (/[^s]s$/.test(kind)) return kind[0].toUpperCase() + kind.slice(1);
  return `${/^[aeiou]/i.test(kind) ? 'An' : 'A'} ${kind}`;
}

/** The line on the card: what was found, short enough to read nineteen times. */
export function refusalSummary(reason: string | null | undefined, name?: string): RefusalLine {
  if (!reason) return { text: 'No reason was recorded.' };

  const share = PAINTING_SHARE.exec(reason);
  if (share) return paintingShareLine(Number(share[1]), Number(share[1]) + Number(share[2]));

  if (reason.includes(NOTHING_TO_JUDGE)) {
    return { text: 'Wikidata lists no famous work here, so there was nothing to judge it by.' };
  }

  if (reason.startsWith(SITE_NOT_VENUE)) {
    // The first class of possibly several: "church building; Catholic cathedral" says one
    // thing twice, and the sentence needs the noun, not the list.
    const kind = withoutNamedBy(reason.slice(SITE_NOT_VENUE.length)).split(';')[0].trim();
    const work = namedBy(reason);
    const opening = openingFor(kind);
    return work
      ? {
        text: `${opening}, not a museum — it reached the list because ${work} is kept there.`,
        highlight: work,
        namedWork: work,
      }
      : { text: `${opening}, not a museum you buy a ticket to.` };
  }

  if (reason.startsWith(BY_HAND)) {
    // A hand-written note is the one reason nobody formatted for a screen, so it is also
    // the one that can arrive without a full stop and read as cut off mid-thought.
    const note = withoutLeadingName(reason.slice(BY_HAND.length).trim(), name);
    return { text: `Kept out by hand: ${note}${note.endsWith('.') ? '' : '.'}` };
  }
  if (reason.startsWith(KILL_LIST)) {
    // A venue test records its verdict through one place (`nameFiltered`), which appends
    // the work that named the place to whatever the verdict was. Pasting that tail in
    // whole is exactly the internal wording this file exists to keep off the card — but
    // the verdict before it is already written for a reader and stays as it is, all of it.
    const classes = withoutNamedBy(reason.slice(KILL_LIST.length));
    return { text: `Not a place you visit: ${classes}.` };
  }
  if (reason.startsWith(DISSOLVED)) {
    return { text: `Closed on ${reason.slice(DISSOLVED.length).split(' ')[0]}, according to the source.` };
  }
  if (reason.includes(NOT_A_MUSEUM)) return { text: 'Wikidata does not call this a museum of any kind.' };
  if (reason.includes(NO_COORDS)) {
    return { text: 'No coordinates of its own, so it cannot be put on the map.' };
  }
  return { text: reason };
}

/** The rest, behind a question mark: how the source decides, and what it counted here. */
export function refusalHelp(reason: string | null | undefined): string | null {
  if (!reason) return null;

  const share = PAINTING_SHARE.exec(reason);
  if (share) {
    // Both counts bend, and the second is written out rather than `plural`-ed: at one,
    // "and antiquities" stops agreeing as well. This is the most-opened panel on the page —
    // the reachable one-work refusal is `0 painting(s) vs 1 sculptural work(s)`, since
    // `artVerdict` admits on `paintings >= sculptures`.
    const others = Number(share[2]) === 1
      ? '1 sculpture or antiquity'
      : `${share[2]} sculptures and antiquities`;
    return 'A venue Wikidata already calls an art museum is let in whatever it holds. This one it '
      + `does not, so the rule weighed what is kept there: ${plural(Number(share[1]), 'painting')} `
      + `against ${others}. It stays only if at least half are paintings.`
      + `\n\n${WHERE_THE_WORKS_COME_FROM}`
      + `\n\nThe rule’s own words: “${reason}”.`;
  }
  if (reason.includes(NOTHING_TO_JUDGE)) {
    return 'A venue Wikidata already calls an art museum is let in whatever it holds. This one it '
      + 'does not, and there is no famous work listed here either — so the rule had nothing to '
      + `weigh and refused rather than guess.\n\n${WHERE_THE_WORKS_COME_FROM}`
      + `\n\nThe rule’s own words: “${reason}”.`;
  }
  if (reason.startsWith(SITE_NOT_VENUE)) {
    return 'This list is of places you buy a ticket to. Wikidata also calls churches, Roman ruins '
      + 'and villas museums, and a famous work kept inside one pulls the building into the list — '
      + 'so a building is refused unless Wikidata separately calls it an art museum, which many '
      + 'former churches and palaces are.'
      + `\n\nThe rule’s own words: “${reason}”.`;
  }
  if (reason.startsWith(BY_HAND)) {
    return 'A person decided this one. The automatic tests would have let it in, so no count '
      + 'explains it — the reason above is the whole of it.';
  }
  if (reason.startsWith(KILL_LIST)) {
    // Every example here is a class the rule actually holds (`KILL_CLASSES`). This is the
    // panel that exists so a curator can check the rule rather than take its word, so it
    // is the one place where an example that sounds right and is not costs something.
    return 'Some things Wikidata types as museums are not places at all — a private collection, '
      + 'a curatorial department, a museum network that is an umbrella rather than a visit, a '
      + 'building that was never built. Those classes are refused outright.'
      + `\n\nThe rule’s own words: “${reason}”.`;
  }
  if (reason.startsWith(DISSOLVED)) {
    return 'Wikidata records a closing date for this venue (property P576), so it is refused as a '
      + 'place a traveller could go to today.'
      + `\n\nThe rule’s own words: “${reason}”.`;
  }
  if (reason.includes(NOT_A_MUSEUM)) {
    return 'Everything in this list has to be typed as a museum of some kind on Wikidata. This one '
      + 'carries no such class, so nothing further was tested.';
  }
  if (reason.includes(NO_COORDS)) {
    return 'A row with no coordinate of its own cannot be placed on the map or counted into a '
      + 'region, which is what this catalogue is for. Wikidata property P625 is the one missing.';
  }
  return null;
}
