/**
 * A picture's credit out of Commons' free-form fields, as text and as a name.
 *
 * `Artist` and `Attribution` arrive as wiki HTML, typed by whoever uploaded the
 * file. They are reduced to text here rather than in the browser: the result is
 * stored, so it would otherwise be user-supplied markup sitting in our database
 * waiting for the one component that renders something without escaping it.
 * And they are read as a name (ADR-0182, #2346): a credit line is one line,
 * and the photographer's terms, contact details and the licence itself are not
 * who took the picture. `imageCredit.ts` asks Commons and decides what a run
 * writes; this file only reads what came back.
 */

/** Long enough that a name is a name; short enough that a wiki template is not a paragraph. */
const CREDIT_MAX_CHARS = 200;
/** What is even scanned: a credit hiding past 2 kB of markup is not a credit. */
const CREDIT_INPUT_MAX_CHARS = 2000;

/**
 * The entities a wiki text field actually carries, decoded in **one** pass.
 *
 * One pass and not a chain of replacements, which CodeQL names a
 * double-unescape (js/double-escaping). A chain re-reads its own output:
 * `&amp;lt;` becomes `&lt;` when the ampersand is decoded, and the next
 * replacement then turns that into `<`. So `&amp;lt;b&amp;gt;` — a wiki page
 * displaying the literal text `<b>` — would come out as real markup this
 * function had just finished stripping. A single scan with a
 * lookup cannot do that: the `&` it writes is behind the cursor.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#039;': "'",
};

/** A credit line is one line: longer than this, the text is cut with an ellipsis. */
function bounded(text: string): string {
  return text.length > CREDIT_MAX_CHARS ? `${text.slice(0, CREDIT_MAX_CHARS).trimEnd()}…` : text;
}

/**
 * Tags dropped and whitespace collapsed, on text whose entities are already
 * decoded — a fetched field's after `decodeEntities`, a stored credit's as it is.
 *
 * A tag cut open by the input cap is dropped too: a template's markup runs past
 * 2 kB, and the slice can end inside an `<a class="external text" …` that
 * no `>` closes, which would otherwise reach the line as text. Each pattern is anchored on a character class that cannot cross
 * its own delimiter, so none of them can backtrack.
 */
function stripTags(text: string): string {
  return text
    // eslint-disable-next-line sonarjs/slow-regex -- negated class `[^>]*` cannot match past `>`, so the quantifier is committed and cannot backtrack across tag boundaries; the input is capped by every caller
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line sonarjs/slow-regex -- the same committed negated class, anchored at the end of the input
    .replace(/<[^>]*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The entities decoded, in the one pass `ENTITIES` explains. */
function decodeEntities(html: string): string {
  return html.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#0?39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * A wiki HTML field as text, unbounded: entities decoded **before** tags are
 * stripped, since an `Artist` field can carry an escaped tag (`&lt;a …&gt;`)
 * that, decoded after the strip, came out as literal markup on the line.
 */
function plainText(html: string | null | undefined): string {
  if (!html) return '';
  // Bounded before anything scans it: the field is somebody else's wiki markup
  // and the answer is one line either way, so the work is capped by
  // construction rather than by trusting each pattern to stay linear.
  return stripTags(decodeEntities(html.slice(0, CREDIT_INPUT_MAX_CHARS)));
}

/**
 * A wiki HTML field as text.
 *
 * Entities decoded, tags dropped, whitespace collapsed, and the result bounded:
 * an `Artist` field can be a whole template with a table in it, and a credit
 * line is one line.
 */
export function creditText(html: string | null | undefined): string | null {
  const text = plainText(html);
  return text ? bounded(text) : null;
}

/** The sentence Commons writes into `Artist` when the uploader named nobody. */
const NO_AUTHOR_PREFIX = 'No machine-readable author provided.';
const ASSUMED_SUFFIXES = ['assumed (based on copyright claims).', 'assumed (based on copyright claims)'];
/** The same sentence's second half where a stored credit kept it after the name, without its first. */
const ASSUMED_PHRASE = ASSUMED_SUFFIXES[1];

/**
 * Without the hidden licence table Commons renders into `Artist` where an
 * uploader put the licence template in the author field: its four cells read,
 * as text, "Public domain Public domain false false" (Mount Fuji's picture) —
 * the short name, the long one, and whether a link and a credit are required.
 * Looked for among the first words only, where the table stands.
 */
function withoutLicenceCells(words: string[]): string[] {
  const flag = (word: string | undefined) => word === 'true' || word === 'false';
  for (let i = 0; i < Math.min(words.length - 1, 24); i++) {
    if (flag(words[i]) && flag(words[i + 1])) return words.slice(i + 2);
  }
  return words;
}

/** The phrases a user template introduces its photographer with, lower-cased. */
const TAKEN_BY = [
  'was taken by ', 'was created by ', 'was made by ', 'photographed by ', 'photograph by ', 'photo by ', 'is a work by ',
];
/** The phrase a transfer from a Wikipedia writes, which names the photographer only where it opens the field. */
const UPLOADER = 'original uploader was ';
/** How far into the field a template's phrase may stand: past that, a name before it is the author. */
const PHRASE_MAX_OFFSET = 40;
/** What such a template may put between the phrase and the name. */
const ACCOUNT_WORDS = ['wikipedia and wikimedia commons user ', 'wikimedia commons user ', 'user '];
/** How many words a name read out of a template may run to before the reading gives up. */
const NAME_MAX_WORDS = 8;

/**
 * The photographer's name inside the sentence a user template writes:
 * "This Photo was taken by Timothy A. Gonsalves." (Phuktal Monastery), "This
 * photo was taken by Anton Zelenov." (the Ipatiev Monastery), "This image is a
 * work by Wikipedia and Wikimedia Commons user C.Suthorn." (Fearless Girl),
 * "The original uploader was Sgbeer at German Wikipedia." — the last only where
 * it opens the field: "Arthur Muradyan, The original uploader was Verjakette"
 * names its photographer first.
 *
 * The name ends at the word a full stop closes — the stray " ." the stripped
 * tags leave, or "C.Suthorn." — and not at an initial's ("Timothy A."), or
 * at a comma, or before an "at" that says where the account is.
 */
function templateName(text: string): string | null {
  const lower = text.toLowerCase();
  const uploader = lower.indexOf(UPLOADER);
  const phrase = uploader >= 0 && uploader <= 'the '.length
    ? UPLOADER
    : TAKEN_BY.find((p) => lower.includes(p) && lower.indexOf(p) <= PHRASE_MAX_OFFSET);
  if (!phrase) return null;
  let start = lower.indexOf(phrase) + phrase.length;
  const account = ACCOUNT_WORDS.find((p) => lower.startsWith(p, start));
  if (account) start += account.length;
  const name: string[] = [];
  for (const word of text.slice(start).split(' ').slice(0, NAME_MAX_WORDS + 1)) {
    if (word === '.' || word === 'at') break;
    const initial = /^\p{L}\.$/u.test(word);
    if ((word.endsWith('.') && !initial) || word.endsWith(',')) {
      name.push(word.slice(0, -1));
      break;
    }
    name.push(word);
  }
  return name.length > 0 && name.length <= NAME_MAX_WORDS ? name.join(' ') : null;
}

/**
 * Where one sentence of a free-form author field ends: a full stop after a
 * word, or after a space the stripped tags left — or where a template's next
 * sentence starts without one ("Kth696586 This photo was taken with …").
 */
const SENTENCE_END = /(?<=\p{L}{2}[.!?]|\s[.!?])\s+/u;
const SENTENCE_START = / (?=(?:This|You) )/;

/**
 * What marks a part of the field that is about the licence, the picture or the
 * photographer's wishes rather than a name: "Feel free to use my photos",
 * "send me an email", "I, the copyright holder of this work, release this work
 * into the public domain", "used with permission". Nothing in such a part
 * names whom the line credits, so it is left off.
 */
const BOILERPLATE = [
  'feel free', 'please', 'email', 'e-mail', 'contact me', 'talk page', 'discussion page', 'licence', 'license',
  'licensed', 'licenced', 'copyright', 'public domain', 'permission', 'credit', 'reuse', 'reusing', 'attribution',
  'applies worldwide', 'in some countries', 'legally possible', 'grant anyone', 'grants anyone',
  'without any conditions', 'required by law', 'illegally', 'cc-by', 'cc by', 'cc0', 'gfdl',
  'this photo', 'this image', 'this picture', 'this file', 'must be',
];

/** A part that is only a label, a host or a link's word ("Name", "Wikimedia Commons", "talk"), lower-cased. */
const NOT_A_NAME = new Set([
  'name', 'author', 'auteur', 'autor', 'photographer', 'photo', 'foto', 'by', 'wikimedia commons', 'wikipedia',
  'talk', 'contribs', 'talk / email', 'i', 'we', 'you', 'me', 'it', 'if', 'if so', 'if not', '',
]);

function isBoilerplate(part: string): boolean {
  const lower = part.toLowerCase().replace(/…$/, '').trim();
  return NOT_A_NAME.has(lower) || BOILERPLATE.some((phrase) => lower.includes(phrase));
}

/** The marks an author field sometimes leads with, lower-cased, which the line writes itself ("© Author"). */
const LEADING_MARKS = [
  '©', '(c)', 'copyright ', 'photo credit:', 'credit:', 'credits to ', 'photo courtesy of ', 'courtesy of ',
  'photograph by:', 'photograph:', 'photo by:', 'photo:', 'foto:',
];

function withoutLeadingMarks(part: string): string {
  let rest = part;
  for (;;) {
    const lower = rest.toLowerCase();
    const mark = LEADING_MARKS.find((m) => lower.startsWith(m));
    if (mark) {
      rest = rest.slice(mark.length).trim();
    } else if (/^\d{4} /.test(rest) && rest !== part) {
      // The year a copyright notice gives ("Copyright © 2006 Kaihsu Tai").
      rest = rest.slice(5);
    } else {
      return rest;
    }
  }
}

/** An e-mail address or a web address: the line links the file page, and nobody's contact details belong on it. */
function isAddress(word: string): boolean {
  const bare = word.replace(/[()<>,;]/g, '');
  const at = bare.indexOf('@');
  const dot = at > 0 ? bare.indexOf('.', at) : -1;
  return (dot > at + 1 && dot < bare.length - 1) || /^(?:https?:\/\/|www\.)/i.test(bare);
}

/** Without a separator, a dangling "at" or "by" and a template's stray " ." left at the end; a name's own full stop stays. */
function withoutTail(text: string): string {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/[ ,;:/-]$/, '').replace(/ \.$/, '').replace(/ (?:at|by|from)$/, '');
    if (trimmed === rest) return rest;
    rest = trimmed;
  }
}

/** The separators a field strings its parts on: a name, then what was done to the file, by whom, and with whose leave. */
const SEPARATORS = [', ', '; ', ': ', ' / ', ' - '];

/** A sentence's parts, outside brackets, each with the separator before it, and without the parts that name nobody. */
function keptParts(unbracketed: string): string {
  const parts: Array<{ separator: string; text: string }> = [];
  let depth = 0;
  let from = 0;
  let separator = '';
  for (let i = 0; i < unbracketed.length; i++) {
    const char = unbracketed[i];
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    const next = depth === 0 ? SEPARATORS.find((s) => unbracketed.startsWith(s, i)) : undefined;
    if (next) {
      parts.push({ separator, text: unbracketed.slice(from, i) });
      separator = next;
      from = i + next.length;
      i += next.length - 1;
    }
  }
  parts.push({ separator, text: unbracketed.slice(from) });
  const kept = parts
    .map((part) => ({ ...part, text: withoutLeadingMarks(part.text.trim()) }))
    .filter((part) => !isBoilerplate(part.text));
  return kept.map((part, index) => (index === 0 ? part.text : `${part.separator}${part.text}`)).join('');
}

/**
 * A free-form author field reduced to the name it gives.
 *
 * Commons' `Artist` is whatever the uploader typed, and on a share of files it
 * is a template: a sentence naming the photographer among their terms, an
 * e-mail address, a link to their talk page, or the licence itself: "This
 * Photo was taken by Timothy A. Gonsalves . Feel free to use my photos … send
 * me an email …", or "Public domain Public domain false false I, the copyright
 * holder of this work …" (the fixtures in `imageCredit.fixtures.ts` hold the
 * real files).
 *
 * So: the licence's hidden cells go; a template's sentence gives its name;
 * otherwise e-mail and web addresses go, and the sentences and the parts of
 * them about terms and wishes with them ("Josefa Fiol, used with permission"
 * keeps the name). What is left is the name, or nothing — and nothing makes
 * the line point at the file page, where Commons states the author in full.
 * Run on text already reduced from markup and whitespace, a fetched field's or
 * a stored credit's, and idempotent, since a run resends a stored credit
 * through it.
 */
export function cleanAuthor(text: string | null): string | null {
  if (!text) return null;
  const rest = withoutLicenceCells(text.split(' ')).join(' ').split(ASSUMED_PHRASE).join(' ')
    .split(' ').filter((word) => !isAddress(word)).join(' ')
    // A bracket that only says something about the credit: "( talk / email )",
    // "(must be credited)", an emptied "( http://… )".
    .replace(/\(([^()]*)\)/g, (bracket, inner: string) => (isBoilerplate(inner) ? ' ' : bracket))
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:])/g, '$1')
    .trim();
  const named = templateName(rest);
  if (named) return bounded(named);
  const kept = rest
    .split(SENTENCE_END)
    .flatMap((sentence) => sentence.split(SENTENCE_START))
    .map((sentence) => keptParts(withoutLeadingMarks(sentence.trim())))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = withoutTail(kept);
  return name ? bounded(name) : null;
}

/**
 * An `Artist` field as the name of whoever took the picture.
 *
 * `plainText`, and then what it cannot know. Where the uploader named nobody,
 * Commons writes a sentence in place of a name — "No machine-readable author
 * provided. Roybb95~commonswiki assumed (based on copyright claims)." — and a
 * reader told that under the Sydney Opera House is told that a machine could
 * not read something. The name between the two halves is the whole of what
 * Commons claims, so it is what the credit says; the account name is kept as
 * Commons spells it, `~commonswiki` included, since that is who the file page
 * names. A field that is nothing but the sentence names nobody. And where the
 * field is a template rather than a name, `cleanAuthor` reads the name out of it.
 */
export function authorText(html: string | null | undefined): string | null {
  return cleanAuthor(assumedAuthor(plainText(html) || null));
}

/**
 * The sentence reduced to the name it assumes, on text already reduced from
 * markup — which is what a stored credit holds, and why this is its own step:
 * decoding a second time would decode the entities already decoded.
 */
function assumedAuthor(text: string | null): string | null {
  if (!text?.startsWith(NO_AUTHOR_PREFIX)) return text;
  let rest = text.slice(NO_AUTHOR_PREFIX.length).trim();
  const suffix = ASSUMED_SUFFIXES.find((s) => rest.endsWith(s));
  if (suffix) rest = rest.slice(0, rest.length - suffix.length).trim();
  return rest || null;
}

/** The licences a requested credit names beside the name, lower-cased: the line names the licence on its own. */
const LICENCE_PARTS = ['cc-by', 'cc by', 'ccby', 'cc0', 'cc-0', 'cc zero', 'creative commons', 'gfdl', 'public domain', 'pd-', 'free art'];

/** Whether one part of a requested credit is a licence, a web address or a bare domain ("commons.wikimedia.org"). */
function isLicenceOrAddress(part: string): boolean {
  const lower = part.toLowerCase();
  if (LICENCE_PARTS.some((licence) => lower.startsWith(licence)) || lower === 'pd' || lower === 'fal') return true;
  if (part.includes(' ')) return false;
  if (isAddress(part)) return true;
  const labels = part.replace(/\/$/, '').split('.');
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9-]+$/.test(label));
}

/** A note in brackets that is about the credit rather than part of it: "(via Wikimedia Commons)", "(Note the three necessary links …)". */
const ABOUT_NOTE = /\((?:via|note)\b[^)]*\)/gi;

/**
 * The credit the photographer asked for, as the name the line gives.
 *
 * Commons' `Attribution` is the `attribution=` its licence template was given:
 * what the author asked to be credited as. It often carries the licence and an
 * address beside the name — Fearless Girl's reads "C.Suthorn / cc-by-sa-4.0 /
 * commons.wikimedia.org (Note the three necessary links to author, licence and
 * image file in the attribution.)" — and the line already names the licence
 * and links the file page, so those parts go and the name is what stays.
 */
export function requestedAuthor(html: string | null | undefined): string | null {
  const parts = plainText(html).replace(ABOUT_NOTE, ' ').replace(/\s+/g, ' ')
    .split(' / ')
    .map((part) => part.trim())
    .filter((part) => part && !isLicenceOrAddress(part));
  return cleanAuthor(parts.join(' / ') || null);
}

/**
 * A stored credit's author read the way a fetched one is: tags a cut left open
 * dropped, the assumed author and the name read out. The entities are not
 * decoded again, since stored text is decoded already.
 */
export function storedAuthor(author: string): string | null {
  return cleanAuthor(assumedAuthor(stripTags(author.slice(0, CREDIT_INPUT_MAX_CHARS)) || null));
}
