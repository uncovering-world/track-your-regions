/**
 * Sync change-set computation.
 *
 * Pure: no database, no network. Given the row as it stands and the record the
 * source just produced, decide what actually changed — and how much it matters.
 *
 * The normalisation here is the point. A source that reorders JSONB keys, lists
 * two countries the other way round, or jitters a coordinate by three metres
 * has not changed anything, and reporting it as change would bury the handful
 * of edits that are real.
 */

import { sameLabelSet } from './labelFold.js';

export interface ExperienceSnapshot {
  name: string;
  nameLocal: Record<string, string> | null;
  description: string | null;
  shortDescription: string | null;
  category: string | null;
  tags: string[] | null;
  lon: number;
  lat: number;
  countryCodes: string[] | null;
  countryNames: string[] | null;
  imageUrl: string | null;
  metadata: Record<string, unknown> | null;
}

export type FieldSignificance = 'major' | 'minor';

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
  significance: FieldSignificance;
  /** A curator had claimed this field, so the stored value won on purpose. */
  curatedConflict: boolean;
  /**
   * The category's gate kept this write out of a row a reader can already see,
   * so the stored value won *provisionally* and a verdict is waiting (#519).
   *
   * The other half of "why was this not written", and never true beside
   * `curatedConflict`: the two are answered by different endpoints — a claim
   * through `accept-source`, a hold through `POST /:id/publish` — so a field
   * carrying both would raise two contradictory cards over one value.
   *
   * Positive rather than inferred. Three sites used to read "held" as "refused
   * and not claimed", which was right only while the gate was the sole other
   * reason a write could be refused.
   */
  held: boolean;
}

export interface ChangeSetResult {
  changeType: 'created' | 'updated' | 'unchanged';
  changedFields: FieldChange[];
  significance: FieldSignificance | null;
  curatedConflicts: FieldChange[];
  /** Fields the gate refused. Proposed, recorded, and waiting on a curator. */
  heldFields: FieldChange[];
}

/** Below this, a coordinate difference is source jitter, not a move. */
export const LOCATION_UNCHANGED_METERS = 10;
/** Above this, the object has moved far enough to matter to a traveller. */
export const LOCATION_MAJOR_METERS = 1000;

/** Metadata keys whose change is a product event, not bookkeeping. */
const MAJOR_METADATA_KEYS = ['inDanger', 'dateInscribed'] as const;

/**
 * Metadata keys a run computes about its own pass, not facts about the object.
 *
 * The rule they name: *a field the import computes about its own run is not a
 * field a person is asked about.* `artworkCount` is how many works the pass just
 * placed in the venue, `totalArtworkSitelinks` the sum of those works' sitelink
 * counts — a fame measure the run records about the venue it just filled.
 * Nothing reads either one today: which museums are admitted and in what order
 * is decided inside the run, off live Wikidata (`museum/pipeline.ts`), never off
 * the stored copy. A sum over some 2500 works
 * moves whenever anybody anywhere adds a language link to any painting a museum
 * holds, so under a gated source every move became a held proposal: the Louvre's
 * card read `totalArtworkSitelinks: 2363 → 2365`, and the next run raised the
 * same card again, for essentially every museum, for ever (#571).
 *
 * Held out of the diff on **both sides**: a run that moved nothing else is
 * `unchanged` and raises no card, and a run that also changed something real
 * shows a card carrying only the something real. Both sides, because a key held
 * out on one only would still differ from the other and would still raise an
 * entry of its own. On a card filed before ADR-0039, where these keys could ride
 * in a shared payload, both sides mattered for a second reason:
 * `publishHeldFields.ts` reads that payload's `old` as the list of keys the
 * entry speaks for, so a counter named there was wiped back to the value the
 * proposal was computed against the moment somebody published the field beside
 * it.
 *
 * `syncUtils.ts` writes these keys past the gate for the same reason
 * `last_seen_at` goes past it, and the two halves have to agree. Ignored in the
 * diff but refused by the write would leave the counter frozen at whatever it
 * read when the gate went up — which is exactly what the Louvre's stored 2363
 * already was: a number the queue kept asking about and no run could land, so
 * the stored copy said one thing and every run since computed another. No
 * reader saw that, because no reader reads it; the first thing that does would
 * have.
 *
 * One level down the same rule is already SQL: the treasures upsert writes
 * `sitelinks_count` unconditionally, "a measurement, not a judgement".
 *
 * The rule's general form, stated by the maintainer on #570: **a person is
 * asked only about what a reader can eventually see; what the import works out
 * on the way there is not a question.** Two more keys fall under it than #571
 * named. `sitelinksCount` on a landmark is the same measurement as the museums'
 * sum, one object up — how many Wikipedia editions have an article, which is
 * what the import ranks by; sixteen of its moves had reached curators' cards.
 * `admittedFor` was held out on purpose the first time, as "the reason the row
 * exists and worth a look when it changes" — but it is the work with the most
 * language links among the ones the pass placed, no reader sees it, and the
 * look it was kept for is already taken by the admission rule itself, which is
 * re-run against live data every pass and files a refusal card the moment a
 * museum stops qualifying. A curator has no decision on the name of the work
 * that did the qualifying. `wikidataClasses` and `wikidataArtwork` on a
 * landmark are the same shape one source over (#754): every class the
 * public-art rule read, and whether an artwork class answered it, kept so
 * that Catalogue Checks can ask what an admitted row is typed as; the rule
 * re-reads them every run and files its own refusal when they stop passing.
 */
export const SYNC_OWNED_METADATA_KEYS = [
  'artworkCount', 'totalArtworkSitelinks', 'sitelinksCount', 'admittedFor',
  'wikidataClasses', 'wikidataArtwork',
] as const;

/** Whether a metadata key belongs to the run rather than to the object. */
function isSyncOwned(key: string): boolean {
  return (SYNC_OWNED_METADATA_KEYS as readonly string[]).includes(key);
}

/**
 * The metadata keys whose value is a *set* of names rather than a list.
 *
 * `creators` is the one, and it is public art's half of ADR-0040: the source
 * says who made a monument and not in what order, so a run restating the same
 * seven people in another order has changed nothing about it. `jsonEquals`
 * compares arrays positionally and would report that as a change — and under the
 * gate raise a held card asking a curator to choose between two orderings of one
 * fact, which is the card ADR-0040 exists to remove.
 *
 * Folded, as the works comparison is: the same rule, so the two levels cannot
 * disagree about whether two lists name the same people.
 */
const METADATA_SET_KEYS: ReadonlySet<string> = new Set(['creators']);

/** Whether a metadata key's two values say the same thing. */
function sameMetadataValue(key: string, before: unknown, after: unknown): boolean {
  if (METADATA_SET_KEYS.has(key) && Array.isArray(before) && Array.isArray(after)) {
    return sameLabelSet(before.map(String), after.map(String));
  }
  return jsonEquals(before, after);
}

/**
 * The `curated_fields` prefix for a per-key metadata claim (`metadata.website`,
 * never `metadata` itself). The upsert's SQL guard in `syncUtils.ts` parses the
 * same claims out of the same column and needs the identical prefix to find
 * them and to know how many characters to strip off the front -- one constant
 * shared by both, instead of the same literal spelled out independently in
 * more than one place, where the two could silently drift apart (#488).
 */
export const METADATA_CLAIM_PREFIX = 'metadata.';

/**
 * The prefix a language of the local-names map is reported under (`nameLocal.ko`).
 *
 * `name_local` is one jsonb column and used to be reported as one entry carrying
 * the whole map, so a run proposing six local names for Getbol asked six facts
 * with one pair of buttons — the defect ADR-0039 removed for `metadata`, one
 * column over (#728). Each language that differs is its own entry now, and
 * publishing merges them back onto the stored map exactly as it does for
 * metadata keys.
 *
 * Shared with `publishHeldFields.ts`, which has to recognise the family to know
 * it cannot be written by assignment, for the same reason
 * `METADATA_CLAIM_PREFIX` is shared: two spellings of one prefix can drift.
 */
export const NAME_LOCAL_CLAIM_PREFIX = 'nameLocal.';

/** Snapshot fields that are `major` when they differ. `location` is synthetic. */
const MAJOR_FIELDS = new Set(['name', 'location', 'countryCodes']);

/**
 * The `curated_fields` entry that protects a given change. Column names, because
 * that is what `experiences.curated_fields` holds.
 */
export const CURATED_KEY_BY_FIELD: Record<string, string> = {
  name: 'name',
  nameLocal: 'name_local',
  description: 'description',
  shortDescription: 'short_description',
  category: 'category',
  tags: 'tags',
  location: 'location',
  countryCodes: 'country_codes',
  countryNames: 'country_names',
  imageUrl: 'image_url',
  metadata: 'metadata',
  'metadata.inDanger': 'metadata',
  'metadata.dateInscribed': 'metadata',
};

/**
 * Families of per-part entries that one **whole-column** claim protects, and the
 * column each shares. Keyed by the name before the dot, so `nameLocal.ko` and
 * `nameLocal.en` both resolve to the column the upsert actually guards.
 *
 * `metadata` is deliberately not here, and the asymmetry is the point.
 * `editExperience` claims metadata **per key** — `metadata.website` is a claim
 * name in its own right and no column at all (#488) — so a family rule sending
 * every `metadata.*` to `metadata` would answer a whole-column question of a
 * per-key claim. Nothing claims one language of `name_local`: the upsert's guard
 * is `curated_fields ? 'name_local'` and keeps or replaces the map whole
 * (`syncUtils.ts`), and no editor writes the column at all, so the claim on a
 * language is the claim on all of them.
 *
 * Read in two runtimes. `claimKeyFor` below is one; the queue's conflict SQL is
 * the other, and takes this object as a parameter rather than spelling the rule
 * out again — see `reviewQueueController.ts`.
 */
export const CLAIM_KEY_BY_FAMILY: Record<string, string> = {
  nameLocal: 'name_local',
};

/**
 * The `curated_fields` entry that protects a given field.
 *
 * Three answers in order. The map above answers it for every field that has a
 * column. The families answer it for the per-part entries of a column claimed
 * whole, which is what makes a `name_local` claim reach `nameLocal.ko` (#728) —
 * without it the diff would call the source's local name applied while the
 * upsert kept the curator's, and publishing would write over the claimed column.
 * The fallback answers it for a name that is its own claim: `editExperience`
 * claims `metadata.website` per key, and no column matches that name (#488).
 *
 * One function rather than the same lookup written out at each site, because
 * every caller — the diff below, the queue's conflict lookup, the publish
 * writer — has to reach the same key or one of them protects nothing.
 */
export function claimKeyFor(field: string): string {
  // The family is looked up off the name before the first dot whether or not
  // there is one, which is what `split_part(field, '.', 1)` answers in the SQL
  // mirror. Guarding on the dot here would make the two disagree about a bare
  // field name that is also a family key -- unreachable, since every such name
  // is in the map above and answered before this line, but the two have to be
  // the same function and not two functions that happen to agree.
  return CURATED_KEY_BY_FIELD[field]
    ?? CLAIM_KEY_BY_FAMILY[field.split('.')[0]]
    ?? field;
}

interface RawDiff {
  field: string;
  old: unknown;
  new: unknown;
  significance: FieldSignificance;
  /**
   * Whether a claim protects this change, where the name alone cannot say.
   *
   * Every field but a metadata key answers this from `curated_fields` and
   * `claimKeyFor`. A metadata key cannot: the upsert re-applies a per-key claim
   * only while the stored row still carries that key (`experiences.metadata ?
   * claimed.k` in `syncUtils.ts`), so an orphaned claim falls through and the
   * source's value lands — filing it as a conflict would offer a curator
   * "accept" on a value already applied. And a claim on the whole column
   * protects every key under it, which no per-key name matches. Both are facts
   * about the stored row, so the answer comes from `metadataChanges`, which has
   * it, rather than from a name lookup that does not.
   *
   * It answers **protection at the diff, and nothing about the name**. The
   * per-key names a whole-column claim's entries now carry are ones no reader
   * resolves back to it: the queue, `accept-source` and `decline-source` look a
   * conflict's claim up through `claimKeyFor`, which sends `metadata.website` to
   * itself, and `['metadata']` does not contain that — so such a conflict is
   * recorded, protected, and asked nowhere, where the same claim used to raise
   * one entry named `metadata` that the map resolves.
   *
   * **Publishing is the fourth reader and loses more than the asking.** Its
   * skip list is the same lookup (`publishHeldFields.ts`,
   * `claimed.includes(claimKeyFor(field.field))`), so per-key entries under a
   * whole-column claim are not skipped, land in `writable`, and are written key
   * by key over a column the claim covers; the claimed-key re-application there
   * filters on the same prefix and restores nothing. Reachable only for a claim
   * made *after* the run, since a claim standing at diff time holds every key.
   * So `syncUtils.ts` still keeps the column whole on `curated_fields ?
   * 'metadata'` while publishing no longer does — which is why this flag's
   * answer stops at the diff.
   *
   * Nothing writes a bare `metadata` claim today. Tracked as #729 rather than
   * fixed in a change about something else.
   */
  protectedByClaim?: boolean;
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function textEquals(a: unknown, b: unknown): boolean {
  if (isAbsent(a) && isAbsent(b)) return true;
  return a === b;
}

function setEquals(a: string[] | null, b: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every(item => seen.has(item));
}

/** Deep value equality with object keys compared as sets, not sequences. */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }

  if (typeof a === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => jsonEquals(left[key], right[key]));
  }

  return false;
}

/**
 * Great-circle distance in metres.
 *
 * Exported for `contentsChangeSet.ts`, which asks the same question one level
 * down — did this point move, and far enough to matter — and must ask it with
 * the same arithmetic, or a component and its object would disagree about what
 * ten metres means.
 */
export function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

function fieldSignificance(field: string): FieldSignificance {
  return MAJOR_FIELDS.has(field) ? 'major' : 'minor';
}

/**
 * Keys a curator claimed individually, as bare key names.
 *
 * Two kinds drop out, for two different reasons — the two filters below carry
 * one each, and this is the only sentence recording either. A **sync-owned** key
 * raises no entry at all (`SYNC_OWNED_METADATA_KEYS`), so there is no entry for
 * a claim to attach to. A **major** key raises one every time it differs, in its
 * own loop below, and is excluded here because carrying it a second time would
 * push the same key twice — once as major, once as minor.
 *
 * The upsert's re-application of claimed keys carries the **sync-owned** half of
 * that exclusion and only it (`claimed.k <> ALL($16)`, where `$16` is
 * `SYNC_OWNED_METADATA_KEYS`; the SQL's own comment scopes itself to a claimed
 * counter). Without it one of the two would report a conflict over a value the
 * other had just written.
 *
 * The major half diverges, in the opposite direction and unreachably: a claim on
 * `metadata.inDanger` is dropped here, reported by the major loop with no
 * `protectedByClaim`, and checked by `claimKeyFor` against a whole-column claim
 * — so the changeset would call the source's value applied while the upsert
 * re-applied the curator's. Nothing writes such a claim (`editExperience` offers
 * `website`, `wikipediaUrl` and `imageCredit`), so it is a shape to know about
 * rather than a defect to see — tracked as #727 rather than fixed in a change
 * about something else.
 */
function claimedMetadataKeys(curatedFields: string[]): string[] {
  return curatedFields
    .filter(key => key.startsWith(METADATA_CLAIM_PREFIX))
    .map(key => key.slice(METADATA_CLAIM_PREFIX.length))
    .filter(key => !(MAJOR_METADATA_KEYS as readonly string[]).includes(key))
    .filter(key => !isSyncOwned(key));
}

/**
 * One side's value for a metadata key, absent where the side does not own it.
 *
 * `source[key]` is not that question. A key named `__proto__` reaches the
 * accessor on `Object.prototype`, so a side that does not carry it answers with
 * a prototype object rather than with nothing: the diff then reports
 * `old: Object.prototype` — `{}` once it is stored — for a key the row never
 * had, and the comparison that decides whether to report it at all is made
 * against the same wrong value. The keys come from the source, so this is the
 * read-side half of the rule `publishHeldFields.ts` keeps on the write side.
 */
function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

/**
 * Metadata is diffed **one key at a time**: every key that differs is reported
 * under its own name, `metadata.<key>` (ADR-0039). What the three loops below
 * still decide is significance and protection, not shape — a key a product
 * decision hangs on (a site entering the danger list) counts as major, a key a
 * curator claimed individually is checked against that claim, and the rest are
 * minor.
 *
 * It used to be three shapes, with everything unclaimed collapsing into one
 * catch-all entry — and that made the card fold those facts into one answer,
 * because an answer is addressed to an entry. Which bucket a key landed in was
 * decided here and was invisible to the person being asked.
 *
 * One group is reported nowhere: the keys the run computes about its own
 * pass. They are not a question, so they raise no card — see
 * `SYNC_OWNED_METADATA_KEYS`.
 */

function metadataChanges(
  before: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
  curatedFields: string[],
): RawDiff[] {
  const changes: RawDiff[] = [];
  const left = before ?? {};
  const right = incoming ?? {};

  for (const key of MAJOR_METADATA_KEYS) {
    if (!jsonEquals(ownValue(left, key), ownValue(right, key))) {
      changes.push({
        field: `${METADATA_CLAIM_PREFIX}${key}`,
        old: ownValue(left, key),
        new: ownValue(right, key),
        significance: 'major',
      });
    }
  }

  // A claimed key is checked against its claim here rather than left to the
  // generic lookup below, which would ask a whole-column question of a per-key
  // name (#488). Since ADR-0039 every key is reported on its own regardless;
  // what this loop still decides is that the claim is honoured, and on which
  // condition.
  //
  // The filter mirrors the guard's own condition, not just its key: the SQL
  // only re-applies a claimed key when the stored row still carries it
  // (`experiences.metadata ? claimed.k` in syncUtils.ts). That is key presence,
  // not value truth — `'{"a":null}'::jsonb ? 'a'` is true — so a curator who
  // deliberately cleared a value and still claims it stays protected. `hasOwn`
  // is presence too, which is what makes the two sides agree; a truthiness test
  // would not (`!!null` is false). A claim whose key the row no longer has falls
  // straight through in the upsert and the source's value gets written, so
  // treating it as a conflict here would offer a curator "accept" on a value
  // that is already applied. Unreachable today — nothing writes such an
  // orphaned claim — but the two sides should agree by construction.
  const claimed = claimedMetadataKeys(curatedFields).filter(key => Object.hasOwn(left, key));
  for (const key of claimed) {
    if (!jsonEquals(ownValue(left, key), ownValue(right, key))) {
      changes.push({
        field: `${METADATA_CLAIM_PREFIX}${key}`,
        old: ownValue(left, key),
        new: ownValue(right, key),
        significance: 'minor',
      });
    }
  }

  const ignoredKeys = [...MAJOR_METADATA_KEYS, ...SYNC_OWNED_METADATA_KEYS, ...claimed];
  // Everything else, one entry per key, for the same reason the two groups above
  // get one: **a curator answers a fact, and a key is a fact.** These used to
  // collapse into a single `metadata` entry, which made the card fold them into
  // one answer — on 1227 of the 1484 held cards on the development catalogue,
  // where a run proposes inscription criteria and a picture credit together and
  // taking the criteria meant taking the credit with them. Which bucket a key
  // landed in was a storage decision (this function), invisible to the person
  // being asked: `metadata.inDanger` had its own answer only because #600 gave it
  // its own entry. Now every key does.
  //
  // The stripping the catch-all needed goes with it. Its payload had to be
  // trimmed of the keys reported above, or a curator would read a claimed value
  // inside a row marked applied beside the row saying it was refused (#488); with
  // one key per entry there is no shared payload to disagree with itself.
  // A claim on the whole column protects every key under it, which no per-key
  // name matches; and a per-key claim the stored row can no longer honour
  // protects nothing. Neither is knowable from a field name, so this decides it
  // — see `RawDiff.protectedByClaim`. The keys reported above are gone from this
  // loop, so what remains is protected only by a whole-column claim.
  const wholeColumnClaimed = curatedFields.includes('metadata');
  const reported = new Set(ignoredKeys);
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (reported.has(key)) continue;
    if (sameMetadataValue(key, ownValue(left, key), ownValue(right, key))) continue;
    changes.push({
      field: `${METADATA_CLAIM_PREFIX}${key}`,
      old: ownValue(left, key),
      new: ownValue(right, key),
      significance: 'minor',
      protectedByClaim: wholeColumnClaimed,
    });
  }

  return changes;
}

/**
 * The local names are diffed **one language at a time**: every language that
 * differs is reported under its own name, `nameLocal.<lang>` (#728).
 *
 * The same rule ADR-0039 applied to `metadata`, and for the same reason — an
 * answer is addressed to an entry, so a map reported whole is six facts under
 * one pair of buttons. Run 68 proposes six local names for Getbol, Korean Tidal
 * Flats (Phase II); a curator who wants the corrected Korean name had to take
 * the English one with it, or refuse both.
 *
 * What each entry says is what the card used to work out for itself: the card
 * split the whole-map entry with `changedKeys` (`objectDiff.ts`), on the same
 * equality, in the same alphabetical order. So a run files what a reader was
 * already shown, and the answer now reaches the row rather than the column.
 * Alphabetical because a jsonb column does not keep the order the keys went in,
 * and the same card has to read the same way twice.
 *
 * `jsonEquals` per language rather than `textEquals`, because that is what the
 * card compared and what the two sides are pinned to (`objectDiff.ts` §
 * `valuesEqual`); the two agree on a string, and only this one is right about a
 * value that is not one.
 */
function nameLocalChanges(
  before: Record<string, string> | null,
  incoming: Record<string, string> | null,
): RawDiff[] {
  const left: Record<string, unknown> = before ?? {};
  const right: Record<string, unknown> = incoming ?? {};
  const changes: RawDiff[] = [];
  for (const language of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (jsonEquals(ownValue(left, language), ownValue(right, language))) continue;
    changes.push({
      field: `${NAME_LOCAL_CLAIM_PREFIX}${language}`,
      old: ownValue(left, language),
      new: ownValue(right, language),
      significance: 'minor',
    });
  }
  return changes;
}

function collectDifferences(
  before: ExperienceSnapshot,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
): RawDiff[] {
  const diffs: RawDiff[] = [];

  const textFields = ['name', 'description', 'shortDescription', 'category', 'imageUrl'] as const;
  for (const field of textFields) {
    if (!textEquals(before[field], incoming[field])) {
      diffs.push({ field, old: before[field], new: incoming[field], significance: fieldSignificance(field) });
    }
  }

  diffs.push(...nameLocalChanges(before.nameLocal, incoming.nameLocal));

  // Tags are compared nowhere. The import derives them from facts it also
  // stores by name -- `criterion_ii` from the criteria string, `in_danger`
  // from the danger listing, `monument` from the landmark's type -- and no
  // reader-facing read returns them (the by-id read did, rendered by nothing,
  // until #570 took the column out), so a tags row on a card restated the row
  // beside it to a person who could change nothing a reader sees by answering
  // (3785 such rows in this database's log). The upsert writes them past the
  // gate for the same reason, and keeps a curator's claim on them for a
  // different one: a person's deliberate write is not a measurement. A claimed
  // value the source disagrees with is therefore kept and not reported either
  // -- there is no decision in it, since nobody reads the outcome (#570).

  for (const field of ['countryCodes', 'countryNames'] as const) {
    if (!setEquals(before[field], incoming[field])) {
      diffs.push({ field, old: before[field], new: incoming[field], significance: fieldSignificance(field) });
    }
  }

  const moved = distanceMeters(before.lon, before.lat, incoming.lon, incoming.lat);
  if (moved >= LOCATION_UNCHANGED_METERS) {
    diffs.push({
      field: 'location',
      old: { lon: before.lon, lat: before.lat },
      new: { lon: incoming.lon, lat: incoming.lat },
      significance: moved > LOCATION_MAJOR_METERS ? 'major' : 'minor',
    });
  }

  diffs.push(...metadataChanges(before.metadata, incoming.metadata, curatedFields));

  return diffs;
}

/**
 * Diff a stored row against the record the source just produced.
 *
 * Every difference lands in exactly one of three buckets, and which one says why
 * the run did or did not write it. `changedFields` means *written*.
 * `curatedConflicts` means a curator had claimed the field, so the stored value
 * won on purpose and nothing is waiting. `heldFields` means the category's gate
 * kept the write out of a row a reader can already see, so the stored value won
 * provisionally and a verdict **is** waiting (#519).
 *
 * A row whose only differences were refused is `unchanged` — because nothing
 * about it changed. Both refusals are still reported: the value the source
 * proposed exists nowhere else, and it is what a curator is being asked about.
 *
 * `held` is the statement's own answer, not a rule re-applied here: the hold is
 * decided in SQL, against the stored row as the write locked it, and
 * `syncUtils.ts` hands that answer back (`was_held`). Re-deriving it on this side
 * is what let the write and the report disagree about one run — see the note on
 * `RETURNING` there.
 */
export function computeChangeSet(
  before: ExperienceSnapshot | null,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
  held: boolean,
): ChangeSetResult {
  if (before === null) {
    // An insert writes every column, and what the gate does about a new row is
    // stamp it `pending` — so there is no refused write to report here.
    return {
      changeType: 'created', changedFields: [], significance: null,
      curatedConflicts: [], heldFields: [],
    };
  }

  const curated = new Set(curatedFields);
  const changedFields: FieldChange[] = [];
  const curatedConflicts: FieldChange[] = [];
  const heldFields: FieldChange[] = [];

  for (const diff of collectDifferences(before, incoming, curatedFields)) {
    // A claim key is not always a column: 'metadata.website' is claimed under
    // that literal name (#488), which is what `claimKeyFor`'s fallback is for.
    const isProtected = diff.protectedByClaim ?? curated.has(claimKeyFor(diff.field));
    // The claim wins where both are true, and the upsert's `claim OR held` guard
    // is indifferent — it keeps the stored value either way. The claim is the
    // narrower and separately answerable reason: `accept-source` owns it, and
    // publishing deliberately leaves a claimed field alone, so filing it as held
    // would offer a curator their own value back as though a source had sent it.
    // Named field by field rather than spread: `protectedByClaim` is how
    // `metadataChanges` answers a question a field name cannot, and it is nobody
    // else's. Spread, it was stored in `changed_fields` on every per-key metadata
    // entry — an internal flag in provenance that is never deleted, and on an API
    // shape `FieldChange` does not declare. Listing what a reported change is
    // keeps the next internal field off the wire too, which a destructure would
    // not.
    const change: FieldChange = {
      field: diff.field,
      old: diff.old,
      new: diff.new,
      significance: diff.significance,
      curatedConflict: isProtected,
      held: !isProtected && held,
    };
    if (isProtected) curatedConflicts.push(change);
    else if (held) heldFields.push(change);
    else changedFields.push(change);
  }

  // Significance covers both kinds of refusal as well as applied changes. A row
  // where the source proposed a major change the run refused and a minor one it
  // applied would otherwise weigh 'minor' — the refused half, which is the part
  // needing a decision, would be the one the `?significance=major` filter and
  // the row's major chip never saw. Whether the row shows in the report's
  // default view is decided there, not here: that view keeps a row carrying a
  // refused claim, or a held one, whatever this weighs (#516).
  const weighed = [...changedFields, ...curatedConflicts, ...heldFields];
  let significance: FieldSignificance | null = null;
  if (weighed.length > 0) {
    significance = weighed.some(f => f.significance === 'major') ? 'major' : 'minor';
  }

  return {
    // Only what was written decides this. A held row reports `unchanged`, which
    // is what stops the run's `total_updated` counting rows where nothing moved.
    changeType: changedFields.length === 0 ? 'unchanged' : 'updated',
    changedFields,
    significance,
    curatedConflicts,
    heldFields,
  };
}
