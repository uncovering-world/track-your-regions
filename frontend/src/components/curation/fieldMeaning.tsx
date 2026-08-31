/**
 * What each curated fact means to a person, and what it means that it changed.
 *
 * A review card used to print the changeset's own names — `shortDescription`,
 * `metadata.inDanger`, `criterion_ii` — with the stored values under them, and left the
 * curator to work out what any of it was. That is the wrong reader to leave it to: a
 * curator is a traveller with the right and the duty to say what the catalogue claims
 * about the world, and the row has to answer three questions before that is possible.
 * What is this fact, on the ground? What does it mean that it changed — an event in the
 * world, a correction in the source, a wrong match, or nothing at all? And what do
 * readers see today? (#570)
 *
 * So every field the changeset can name has a **label** (what the card prints), a **what**
 * and a **when it changes** (the definition behind the term), where the stored shape is
 * not how a person says it a **render** — as readers see it, wherever readers see it: the
 * In Danger badge is the badge — and for the fields whose change is itself an event a
 * one-line **change sentence** about *this* change, under the values.
 *
 * The vocabulary is the presentation half of #574: sixteen `metadata` keys across three
 * sources, the tag values, the language codes, and the columns. It lives on the client
 * today because the client is where the person is; the model half — a typed metadata the
 * adapters write into — is still open, and when it lands this table is what it will be
 * checked against. Measured on the live catalogue before writing (2026-08-30): the
 * examples in the definitions are its rows.
 */

import type { ReactNode } from 'react';
import { Chip, Link, Stack, Tooltip } from '@mui/material';
import { parseCriteria } from '../../utils/unescoCriteria';
import { inDangerLabel } from '../../utils/dangerLabel';
import { safeHref } from '../../utils/safeHref';
import { creators } from '../../utils/creatorList';

/** One field of a proposal, as the queue carries it. */
export interface ProposedField {
  field: string;
  old: unknown;
  new: unknown;
}

/**
 * What a rendering or a change sentence may look at beyond its own two values.
 *
 * `proposed` is every field on the card, because one field's meaning can hang on another:
 * a changed country *name* is a spelling correction unless the country *codes* changed
 * with it. `inDanger` / `dangerSince` are the object as readers see it now, which is what
 * "readers see no badge today" is a claim about, and what the badge's own year is read from.
 */
export interface ChangeContext {
  proposed: ReadonlyArray<ProposedField>;
  inDanger?: boolean;
  dangerSince?: number | null;
}

export interface FieldMeaning {
  label: string;
  /** The fact on the ground. */
  what: string;
  /** What a change usually means, and what to check. */
  whenItChanges: string;
  /** The value as a person says it, or as readers see it. Absent: text as itself, anything else as JSON. */
  render?: (value: unknown, context: ChangeContext) => ReactNode;
  /** One sentence about this change, for the fields whose change carries a meaning of its own. */
  describeChange?: (before: unknown, after: unknown, context: ChangeContext) => string | null;
  /** A change to this fact is an event in the world, not a rewording — the card marks the sentence. */
  event?: true;
  /** No reader-facing surface shows this fact today, so publishing it changes nothing readers see. */
  unseen?: true;
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** `-1848` → "1848 BC"; large negatives grouped, since `-400000` is a Palaeolithic date. */
function yearLabel(value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '');
  return value < 0 ? `${whole.format(-value)} BC` : String(value);
}

/**
 * Hectares with the unit a traveller thinks in beside them: the Rietveld Schröder House is
 * 0.0075 ha, which is 75 m²; the French Austral Lands are 166 million ha, which is 1.66
 * million km². Whether this is an afternoon or an expedition is the number's meaning.
 */
function areaLabel(value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '');
  const ha = `${number.format(value)} ha`;
  if (value < 1) return `${ha} (${whole.format(value * 10_000)} m²)`;
  if (value >= 100) return `${ha} (${number.format(value / 100)} km²)`;
  return ha;
}

/** "Y 2003" as UNESCO writes a current listing: listed, since 2003. Display only. */
function dangerListingLabel(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'not listed';
  const [answer, year] = value.trim().split(/\s+/);
  if (answer.toUpperCase() !== 'Y') return value;
  return year ? `listed since ${year}` : 'listed';
}

function yesNo(value: unknown, yes: string, no: string): string {
  if (value === true) return yes;
  if (value === false) return no;
  return String(value ?? '');
}

function wikidataUrl(qid: unknown): string | null {
  return typeof qid === 'string' && /^Q\d+$/.test(qid) ? `https://www.wikidata.org/wiki/${qid}` : null;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer nofollow" underline="hover">
      {children}
    </Link>
  );
}

/** A URL from the source: linked where it is one, shown as text where it is not. */
function urlLabel(value: unknown): ReactNode {
  if (typeof value !== 'string') return String(value ?? '');
  const href = safeHref(value);
  return href ? <ExternalLink href={href}>{value}</ExternalLink> : value;
}

/**
 * Each criterion as a chip with its meaning one hover away — the numerals are the claim,
 * the meanings are what to look for once there.
 */
function CriteriaChips({ text }: { text: string }) {
  const criteria = parseCriteria(text);
  if (criteria.length === 0) return <>{text}</>;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" component="span">
      {criteria.map(criterion => (
        <Tooltip
          key={criterion.numeral}
          title={criterion.meaning ?? 'not one of the ten criteria the Guidelines name'}
          arrow
        >
          <Chip size="small" variant="outlined" label={`(${criterion.numeral})`} sx={{ cursor: 'help' }} />
        </Tooltip>
      ))}
    </Stack>
  );
}

/** The four-digit year in a listing string — "Y 2003" — or nothing. Display only. */
function listingYear(value: unknown): number | null {
  const match = typeof value === 'string' ? /\b(\d{4})\b/.exec(value) : null;
  return match ? Number(match[1]) : null;
}

/**
 * Since when the site is listed, from wherever the card carries it.
 *
 * The object's own `danger_since` is nulled with the flag: `withDangerFields` dates a
 * listing only on a row whose flag is true, so on the one card where the year is most of
 * the fact — a site the Committee has just listed, flag false and about to be true — the
 * object says nothing. The proposal does: a new listing changes `dangerList` with the
 * flag, so the year sits in the card's own `metadata` row (Bamiyan's card carries
 * `"Y 2003"` there), or in a `metadata.dangerList` row of its own.
 */
function listedSince(context: ChangeContext): number | null {
  if (context.dangerSince) return context.dangerSince;
  for (const proposal of context.proposed) {
    let listing: unknown;
    if (proposal.field === 'metadata.dangerList') listing = proposal.new;
    else if (proposal.field === 'metadata' && isRecord(proposal.new)) listing = proposal.new.dangerList;
    const year = listingYear(listing);
    if (year) return year;
  }
  return null;
}

/** The In Danger badge as readers see it — the same words, the same colour. */
function dangerBadge(value: unknown, context: ChangeContext): ReactNode {
  if (value === true) return <Chip size="small" color="error" label={inDangerLabel(listedSince(context))} />;
  if (value === false) return 'no badge';
  return String(value ?? '');
}

function creditText(value: unknown): ReactNode {
  if (!isRecord(value)) return String(value ?? '');
  const author = typeof value.author === 'string' && value.author ? value.author : 'author not named';
  const license = typeof value.license === 'string' && value.license ? value.license : null;
  const terms = safeHref(typeof value.detailsUrl === 'string' ? value.detailsUrl : null);
  return (
    <>
      {author}
      {license && ` · ${license}`}
      {terms && <> · <ExternalLink href={terms}>terms</ExternalLink></>}
    </>
  );
}

function workLabel(value: unknown): ReactNode {
  if (!isRecord(value)) return String(value ?? '');
  const label = typeof value.label === 'string' ? value.label : String(value.qid ?? '');
  // Through safeHref although wikidataUrl only ever builds an https literal: the rule
  // is declared once, and `urlSafety.test.ts` reads every href in a module that carries
  // a stored link as going through it.
  const href = safeHref(wikidataUrl(value.qid));
  return href ? <ExternalLink href={href}><em>{label}</em></ExternalLink> : <em>{label}</em>;
}

function qidLabel(value: unknown): ReactNode {
  const href = safeHref(wikidataUrl(value));
  return href ? <ExternalLink href={href}>{`${String(value)} (Wikidata)`}</ExternalLink> : String(value ?? '');
}

function coordinateLabel(value: unknown): string {
  if (!isRecord(value) || typeof value.lat !== 'number' || typeof value.lon !== 'number') {
    return value == null ? '' : JSON.stringify(value);
  }
  return `${value.lat.toFixed(4)}, ${value.lon.toFixed(4)}`;
}

/** `criterion_ii` → "criterion (ii)", `in_danger` → "in danger"; the rest as words. */
export function tagLabel(tag: string): string {
  const criterion = /^criterion_([ivx]+)$/.exec(tag);
  if (criterion) return `criterion (${criterion[1]})`;
  return tag.replace(/_/g, ' ');
}

function listLabel(value: unknown, item: (v: string) => string = v => v): string {
  if (!Array.isArray(value)) return String(value ?? '');
  return value.map(v => item(String(v))).join(', ');
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', es: 'Spanish', ar: 'Arabic', ru: 'Russian', zh: 'Chinese',
};

/** A language code as its name: the six UNESCO publishes in, and whatever else arrives. */
export function languageName(code: string): string {
  const known = LANGUAGE_NAMES[code.toLowerCase()];
  if (known) return known;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Great-circle distance and the compass point it was in, for the sentence under a moved
 * pin. The same arithmetic and radius as the server's `distanceMeters` (`changeSet.ts`),
 * which is what decided the row was a move at all; the 1 km the sentence turns on is the
 * server's own `LOCATION_MAJOR_METERS`, stated here in words rather than imported, since
 * the two packages share no build (#527).
 */
function moved(before: unknown, after: unknown): { meters: number; heading: string } | null {
  if (!isRecord(before) || !isRecord(after)) return null;
  const { lon: lon1, lat: lat1 } = before;
  const { lon: lon2, lat: lat2 } = after;
  if ([lon1, lat1, lon2, lat2].some(v => typeof v !== 'number')) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1 as number); const φ2 = toRad(lat2 as number);
  const dφ = φ2 - φ1; const dλ = toRad((lon2 as number) - (lon1 as number));
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const meters = 2 * 6371000 * Math.asin(Math.sqrt(a));
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return { meters, heading: points[Math.round(degrees / 45) % 8] };
}

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${number.format(Math.round(meters / 100) / 10)} km`;
}

const MAJOR_MOVE_METERS = 1000;

function setDifference(before: unknown, after: unknown): { added: string[]; removed: string[] } {
  const left = new Set(Array.isArray(before) ? before.map(String) : []);
  const right = new Set(Array.isArray(after) ? after.map(String) : []);
  return {
    added: [...right].filter(v => !left.has(v)),
    removed: [...left].filter(v => !right.has(v)),
  };
}

const SOURCE_LINK_CHANGE = 'A different URL is usually the source reorganising its site; the page is the same. '
  + 'Open it and check it is this place.';

/**
 * The vocabulary. Keyed by the changeset's own field names — a column, or `metadata.<key>`
 * for a fact inside the source's extra data, whether the changeset reported that key on
 * its own or the card found it inside the catch-all.
 *
 * The change sentences are one line each and about *this* change, because they sit under
 * a value in a table a curator reads nineteen of at a sitting: the kind of change (new,
 * changed, removed) is already on the row, so a sentence never repeats it.
 */
const MEANINGS: Record<string, FieldMeaning> = {
  name: {
    label: 'name',
    what: 'The name readers see in lists and on the map.',
    whenItChanges: 'The source renamed or corrected it; readers see the new one everywhere.',
  },
  nameLocal: {
    label: 'name in other languages',
    what: 'The name in the source’s other languages — UNESCO publishes six: English, French, Spanish, Arabic, Russian and Chinese.',
    whenItChanges: 'Routine: a translation corrected or added.',
  },
  description: {
    label: 'description',
    what: 'The long text on the object’s own page.',
    whenItChanges: 'The source rewrote it. Read both; a rewrite can drop what a curator added.',
  },
  shortDescription: {
    label: 'short description',
    what: 'The paragraph on the card readers open.',
    whenItChanges: 'The source rewrote it. Read both; a rewrite can drop what a curator added.',
  },
  category: {
    label: 'category',
    what: 'UNESCO: cultural, natural or mixed — which kind of criteria the site meets. Landmarks: monument or sculpture. Museums: art.',
    whenItChanges: 'Reclassified by the source.',
  },
  tags: {
    label: 'tags',
    what: 'Labels the import derives from other facts on the row — the criteria, the danger listing, the type. Nothing on the site reads them.',
    whenItChanges: 'Repeats what the other rows say, in another form. Nothing readers see changes, and newer runs no longer ask.',
    render: value => listLabel(value, tagLabel),
    describeChange: (before, after) => {
      const { added, removed } = setDifference(before, after);
      const parts = [];
      if (added.length) parts.push(`Added: ${added.map(tagLabel).join(', ')}.`);
      if (removed.length) parts.push(`Removed: ${removed.map(tagLabel).join(', ')}.`);
      return parts.length ? `${parts.join(' ')} Nothing on the site reads tags.` : null;
    },
  },
  location: {
    label: 'coordinates',
    what: 'The point the source gives for the object — the pin readers see, and what decides which regions the object counts in.',
    whenItChanges: 'A move of a few metres is jitter. Kilometres can put the object in a different region or country: check the pin on the map before publishing.',
    render: coordinateLabel,
    event: true,
    describeChange: (before, after) => {
      const move = moved(before, after);
      if (!move) return null;
      const far = move.meters > MAJOR_MOVE_METERS ? ' — may fall in a different region; check the pin' : '';
      return `Moved ${distanceLabel(move.meters)} ${move.heading}${far}.`;
    },
  },
  countryCodes: {
    label: 'country codes',
    what: 'The countries the source lists for the object, as ISO codes — where a reader’s visit counts.',
    whenItChanges: 'A different country. A pin in the wrong country is a wrong claim about the world — check the pin and the source page before publishing.',
    render: value => listLabel(value),
    event: true,
    describeChange: () => 'A different country — check the pin and the source page.',
  },
  countryNames: {
    label: 'countries',
    what: 'The countries the source lists for the object, by name — where a reader’s visit counts.',
    whenItChanges: 'Same codes, different names: the source’s spelling changed, not the country. Different codes: a different country — check the pin.',
    render: value => listLabel(value),
    describeChange: (_before, _after, context) => (
      context.proposed.some(f => f.field === 'countryCodes')
        ? 'The country changed — see the country codes row.'
        : 'Spelling only — the country is the same.'
    ),
  },
  imageUrl: {
    label: 'picture',
    what: 'The picture readers see on the card.',
    whenItChanges: 'A different picture. Its credit changes with it — see the picture credit row.',
    render: urlLabel,
  },
  metadata: {
    label: 'source data',
    what: 'The source’s extra facts about the object, each by name.',
    whenItChanges: 'Each name that moved has its own row; the ones that did not are not shown.',
  },

  // UNESCO World Heritage Sites
  'metadata.dateInscribed': {
    label: 'inscribed',
    what: 'The year the World Heritage Committee inscribed the property on the List — how long it has carried the title.',
    whenItChanges: 'An inscription year does not change; extensions keep the original. A different year is a correction in the source, or this row matched to a different property. Open the source page and check the year there before publishing.',
    event: true,
    describeChange: () => 'Inscription years do not change — check the source page.',
  },
  'metadata.inDanger': {
    label: 'in danger',
    what: 'Whether the site is on the List of World Heritage in Danger: the Committee’s warning that what earned the inscription is under serious threat — armed conflict, disaster, unchecked development, tourism pressure. On the ground it often means damage already done, or access restricted.',
    whenItChanges: 'The Committee adds and removes sites once a year, at its session. A yes puts the In Danger badge on the site for readers; a no takes it off.',
    render: dangerBadge,
    event: true,
    describeChange: (before, after, context) => {
      if (after === true && before !== true) {
        // What readers see is a claim about the object, made only where the card
        // carries it: every queue kind does, through `withDangerFields`, but a
        // context built without it must not turn "unknown" into "no badge".
        if (context.inDanger === true) {
          return 'Readers already see this badge — the flag was repaired after the card was filed; publishing changes nothing here.';
        }
        const year = listedSince(context);
        if (context.inDanger === false) {
          const since = year ? `Listed since ${year} — r` : 'R';
          return `${since}eaders see no badge today; publishing adds it.`;
        }
        return year ? `Listed since ${year}.` : 'The source now lists this site as in danger.';
      }
      if (after === false && before === true) return 'Taken off the danger list — publishing removes the badge.';
      return null;
    },
  },
  'metadata.dangerList': {
    label: 'danger listing',
    what: 'The dated record of the listing as UNESCO publishes it — “Y 2003” is listed, since 2003. Emptied when the site comes off the list.',
    whenItChanges: 'A year appearing is a new listing; a year moving is a re-listing after an earlier removal — the emergency is current, not historical.',
    render: dangerListingLabel,
    event: true,
    describeChange: (before, after) => {
      const year = (v: unknown) => (typeof v === 'string' ? /\b(\d{4})\b/.exec(v)?.[1] ?? null : null);
      const was = year(before); const now = year(after);
      if (!was && now) return `Listed in ${now}.`;
      if (was && now && was !== now) return `Listed again in ${now}, after ${was} — the emergency is current.`;
      if (was && isAbsent(after)) return 'No longer listed.';
      return null;
    },
  },
  'metadata.criteria': {
    label: 'inscription criteria',
    what: 'Which of UNESCO’s ten selection criteria the site meets — the reason it is on the List, and what to look for there. (i)–(vi) are cultural, (vii)–(x) natural; a site meeting both is “mixed”.',
    whenItChanges: 'Criteria are fixed at inscription and change only when a property is extended or renominated, which is rare. A change is usually the source filling in or correcting the field.',
    render: value => (typeof value === 'string' ? <CriteriaChips text={value} /> : String(value ?? '')),
    describeChange: (before) => (isAbsent(before)
      ? 'Readers see no criteria for this site today.'
      : 'Criteria change only on extension or renomination — likely a correction.'),
  },
  'metadata.region': {
    label: 'UNESCO region',
    what: 'UNESCO’s own grouping of States Parties into five regions, used for its statistics — not geography: Türkiye, Israel and Russia sit in “Europe and North America”.',
    whenItChanges: 'Countries do not move between regions. A different region almost certainly means a wrong match — check the country and the pin.',
    event: true,
    describeChange: () => 'Countries do not move between regions — likely a wrong match; check the pin.',
  },
  'metadata.areaHectares': {
    label: 'area',
    what: 'The area of the inscribed property — the core zone, not the buffer zone. From 75 m² for the Rietveld Schröder House to 1.66 million km² of Southern Ocean for the French Austral Lands: whether this is an afternoon or an expedition.',
    whenItChanges: 'A jump is a boundary change the Committee approved, or a correction; a small move is a re-measurement. Readers do not see this number today.',
    render: areaLabel,
    describeChange: (before, after) => {
      if (typeof before !== 'number' || typeof after !== 'number' || before <= 0) return null;
      const ratio = after / before;
      if (ratio >= 1.5 || ratio <= 1 / 1.5) {
        const factor = ratio >= 1 ? ratio : 1 / ratio;
        return `Boundary ${ratio >= 1 ? 'grew' : 'shrank'} ×${number.format(factor)} — an extension, or a correction.`;
      }
      return 'Re-measured; same boundary.';
    },
  },
  'metadata.transboundary': {
    label: 'transboundary',
    what: 'The property straddles more than one country. Visiting one country’s part is not visiting the property — the Struve Geodetic Arc runs through ten.',
    whenItChanges: 'Newly transboundary means the property was extended into another country; otherwise a correction. Check the countries listed on the object.',
    render: value => yesNo(value, 'yes — shared between countries', 'no — within one country'),
    event: true,
    describeChange: (before, after) => {
      if (after === true && before !== true) return 'Now shared between countries — check the countries listed.';
      if (after === false && before === true) return 'No longer shared between countries.';
      return null;
    },
  },
  'metadata.website': {
    label: 'source page',
    what: 'The object’s page at the source — for a World Heritage property, whc.unesco.org, where the official description, maps and documents are.',
    whenItChanges: SOURCE_LINK_CHANGE,
    render: urlLabel,
  },
  'metadata.wikipediaUrl': {
    label: 'Wikipedia',
    what: 'The English Wikipedia article the source matched to the object.',
    whenItChanges: 'A different article can be a rename — or a different subject. Open it and check it is this place.',
    render: urlLabel,
  },
  'metadata.imageCredit': {
    label: 'picture credit',
    what: 'Whose photograph the catalogue shows, and under what terms. The licence asks one thing: that the author is named wherever the picture appears.',
    whenItChanges: 'A credit arriving for the first time is the catalogue starting to meet that term. A different name usually means a different picture — check the picture above is the one the credit is for.',
    render: creditText,
    describeChange: (before, after) => {
      if (isAbsent(before)) return 'Readers see the picture uncredited today.';
      const author = (v: unknown) => (isRecord(v) ? v.author : null);
      if (author(before) !== author(after)) return 'A different photographer — check the picture is the one this credit is for.';
      return null;
    },
  },

  // Top Art Museums, Public Art & Monuments
  'metadata.wikidataQid': {
    label: 'Wikidata item',
    what: 'The object’s identifier on Wikidata, which is where this source reads it from.',
    whenItChanges: 'A different item means this row now points at a different object, or Wikidata merged two records. Check the name and the pin before publishing.',
    render: qidLabel,
    event: true,
    describeChange: () => 'A different Wikidata item — check the name and the pin.',
  },
  'metadata.admittedFor': {
    label: 'admitted for',
    what: 'The single most famous work held here — the one whose fame qualified the museum for this list. The reason the row exists.',
    whenItChanges: 'A different work now tops the count. Not an event on the ground, and no longer a question: newer runs write it without asking.',
    render: workLabel,
  },
  'metadata.artworkCount': {
    label: 'works placed',
    what: 'How many works the last run hung in this museum — the run’s own bookkeeping.',
    whenItChanges: 'Never a question: the run writes it without asking.',
  },
  'metadata.totalArtworkSitelinks': {
    label: 'fame total',
    what: 'The sum of those works’ Wikipedia language editions — the run’s ranking input.',
    whenItChanges: 'Never a question: the run writes it without asking.',
  },
  'metadata.creators': {
    label: 'attribution',
    what: 'Everyone Wikidata records as having made it — the sculptors, the architect, sometimes the foundry. Missing for more than half the monuments: anonymous, ancient, or simply unrecorded. Christ the Redeemer is two people, the Fountain of Cybele seven.',
    whenItChanges: 'An attribution changed on Wikidata: research, or a fix. A name added or dropped, since restating the same people in another order is not reported. Plausible; check the article if a name is unfamiliar.',
    render: value => (Array.isArray(value) ? creators(value.map(String)) ?? 'unknown' : 'unknown'),
  },
  'metadata.year': {
    label: 'year',
    what: 'The year the work was made or unveiled, from Wikidata’s “inception”. Negative years are BC.',
    whenItChanges: 'Dates get corrected on Wikidata; a change of a few years is routine, a change of centuries is a different object.',
    render: yearLabel,
    describeChange: (before, after) => (
      typeof before === 'number' && typeof after === 'number' && Math.abs(after - before) >= 100
        ? 'Centuries apart — check it is the same object.'
        : null
    ),
  },
  'metadata.type': {
    label: 'type',
    what: 'Which of the source’s lists the object came from — monument or sculpture.',
    whenItChanges: 'Reclassified on Wikidata.',
  },
  'metadata.sitelinksCount': {
    label: 'language editions',
    what: 'How many Wikipedia language editions have an article — the source’s measure of fame, and how the import ranks what to include.',
    whenItChanges: 'Moves whenever anyone anywhere adds a translation. Not a fact about the object, and no longer a question: newer runs write it without asking.',
  },

  // A work inside a museum, and a place inside a serial site (contentsChangeSet.ts)
  artists: {
    label: 'attribution',
    what: 'Everyone Wikidata records as having made the work. Most have one maker and a minority have several: Morning in a Pine Forest is Shishkin’s forest and Savitsky’s bears.',
    whenItChanges: 'An attribution changed on Wikidata: research, or a fix. A name added or dropped, since restating the same people in another order is not reported. Check the work’s page if a name is unfamiliar.',
    render: value => (Array.isArray(value) ? creators(value.map(String)) ?? 'nobody recorded' : 'nobody recorded'),
  },
  year: {
    label: 'year',
    what: 'The year the work was made, from Wikidata’s “inception”. Negative years are BC.',
    whenItChanges: 'Dates get corrected on Wikidata; a change of a few years is routine, a change of centuries is a different work.',
    render: yearLabel,
  },
  image_url: {
    label: 'picture',
    what: 'The picture readers see for the work.',
    whenItChanges: 'A different picture on Wikimedia Commons.',
    render: urlLabel,
  },
};

/** A stored key as words: `totalArtworkSitelinks` → "total artwork sitelinks". */
function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced === key ? key : spaced.toLowerCase();
}

/**
 * A field nobody has described yet. Named as words rather than as camelCase, and honest
 * about the rest: a definition that guessed would be worse than one that says it does not
 * know.
 */
function unknownMeaning(label: string): FieldMeaning {
  return {
    label,
    what: 'Extra data from the source, stored under this name. Nothing on the site reads it by name today.',
    whenItChanges: 'The source changed it. Readers see nothing different.',
  };
}

/**
 * The facts no reader-facing surface shows today, measured on the tree (2026-08-30): the
 * expanded row, Discover's card and its detail panel read `dateInscribed`, `inDanger` (and
 * the listing's year), `website`, `wikipediaUrl`, the picture and its credit, the name and
 * the descriptions. Everything else the sources store is stored and shown nowhere — the
 * gap #574 is about — and a card must not say "nothing readers see changes" from the
 * *kind* of a change: a picture arriving is a fact appearing, and readers see it. This is
 * what lets the summary say it from the fact instead.
 */
const UNSEEN_BY_READERS = new Set([
  'tags',
  'metadata.criteria', 'metadata.region', 'metadata.areaHectares', 'metadata.transboundary',
  'metadata.wikidataQid', 'metadata.admittedFor', 'metadata.artworkCount', 'metadata.totalArtworkSitelinks',
  'metadata.creators', 'metadata.year', 'metadata.type', 'metadata.sitelinksCount',
]);

/** The meaning of a field the changeset names: a column, or `metadata.<key>`. */
export function meaningOf(field: string): FieldMeaning {
  const known = MEANINGS[field];
  if (known) return UNSEEN_BY_READERS.has(field) ? { ...known, unseen: true } : known;
  const key = field.startsWith('metadata.') ? field.slice('metadata.'.length) : field;
  // A key nobody has described is a key nothing shows, which is what its definition says.
  return { ...unknownMeaning(humaniseKey(key)), unseen: true };
}

/**
 * The meaning of one named part inside an object field: a metadata key, or a language in
 * the local-names map. A key inside `metadata` means exactly what the changeset's own
 * `metadata.<key>` row means, so the two read alike whichever way the key arrived.
 */
export function keyMeaningOf(field: string, key: string): FieldMeaning {
  if (field === 'metadata') return meaningOf(`metadata.${key}`);
  if (field === 'nameLocal') {
    const language = languageName(key);
    return {
      label: `name in ${language}`,
      what: `The name in ${language}, as the source publishes it.`,
      whenItChanges: 'Routine: a translation corrected or added.',
    };
  }
  return unknownMeaning(humaniseKey(key));
}

/** The field's name as a person says it — what the card prints. */
export function fieldLabel(field: string): string {
  return meaningOf(field).label;
}
