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

import { isEmptyValue, jsonEquals } from '@tyr/shared/equality';
import { sameLabelSet } from './labelFold.js';
import { sameTypography } from '@tyr/shared/labels';
import { distanceMeters, LOCATION_MAJOR_METERS, LOCATION_UNCHANGED_METERS } from '@tyr/shared/moves';
import { placeFieldUnseen } from '@tyr/shared/readerFields';

/**
 * The outline a row holds, as the diff compares it: a hash of the geometry the
 * writer stores, and its area for the record a person reads. The hash rather
 * than the WKT, because the stored shape is the repaired, multi-polygon form
 * of what the collector sent (`experienceUpsert.ts` measures the incoming one
 * with the writer's own expression), and a text comparison would report a
 * change on every run for a polygon PostGIS merely rewrote.
 */
export interface BoundarySnapshot {
  hash: string;
  areaKm2: number | null;
}

export interface ExperienceSnapshot {
  name: string;
  nameLocal: Record<string, string> | null;
  subtitle: string | null;
  description: string | null;
  /** The type within the kind; `null` for a museum (ADR-0045, #814). */
  type: string | null;
  tags: string[] | null;
  lon: number;
  lat: number;
  /**
   * On an incoming record: `lon`/`lat` is the anchor of a place of several
   * points, not a coordinate of its own (ADR-0095), so a move is written past
   * the gate. Absent on a stored row, which says nothing either way.
   */
  locationIsAnchor?: boolean;
  /**
   * On an incoming record: the closed vocabulary of the kind the run fills
   * (`publicArt/kindRules.ts`), where it declares one. A stored type that is
   * none or outside it is rewritten past the gate (`type-outside-vocabulary`). Absent on a stored
   * row, and from a source whose kind declares none.
   */
  typeVocabulary?: readonly string[];
  countryCodes: string[] | null;
  countryNames: string[] | null;
  imageUrl: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * The extent, where the source has one (the Archaeology site door; ADR-0059
   * decision 2). Optional because most writers and every older snapshot have
   * none, and absent reads as none.
   */
  boundary?: BoundarySnapshot | null;
}

export type FieldSignificance = 'major' | 'minor';

/**
 * Why a rewrite a gated source proposes on a row readers see passes the gate
 * unasked (#1353): it replaces no fact a reader holds (ADR-0099, ADR-0133, ADR-0135).
 * A part's name
 * with a qualifier added and nothing removed (*Church of All Saints* → *…,
 * Blizne*); a picture credit re-read for the same file under the same licence;
 * a measurement (`MEASURED_METADATA_KEYS`) the source re-took within
 * `REMEASURED_SHARE` (an area of 821.7474 ha → 821.748); the Wikidata item a
 * place held none of, written by a run that knows the place by it (`own-item`,
 * ADR-0129); a subtitle where the place held none (`first-subtitle`,
 * ADR-0133), a line where there was none; and a type where the membership
 * holds none, or one its kind's vocabulary has no word for, replaced by one it
 * has (`type-outside-vocabulary`, ADR-0135): a value its kind has no word for
 * answers no filter of the kind, so it is no reader's fact to keep. Those
 * two are the classes a visitor sees. A field no reader is shown
 * (`unseen`, ADR-0139: its mark in `@tyr/shared/readerFields`), and a text
 * rewritten only in its typesetting (`typography`, ADR-0139: `sameTypography`)
 * pass too. Every other rewrite is held as before (ADR-0099).
 */
export const GATE_PASSES = [
  'qualifier', 'same-file-credit', 'remeasured', 'own-item', 'first-subtitle', 'type-outside-vocabulary',
  'unseen', 'typography',
] as const;
export type GatePass = (typeof GATE_PASSES)[number];

/** How far a number may move and still be the same measurement re-taken. */
export const REMEASURED_SHARE = 0.1;

/**
 * The metadata keys that are measurements, and so may be re-taken: an area.
 * Named rather than read off the value's type, since a year is a number too —
 * a public-art monument's `year` moved from 1935 to 2100 is a different
 * statement, not a re-measurement.
 */
export const MEASURED_METADATA_KEYS: readonly string[] = ['areaHectares'];

/** A Wikidata item id, as a run writes one: `Q` and a number. */
const WIKIDATA_ITEM = /^Q[1-9]\d*$/;

/**
 * Whether a rewrite of a field passes the gate as `unseen` (ADR-0139): no
 * reader is shown the field. The Wikidata item is the one unseen field that
 * does not pass: a different item means the row may now describe another
 * object, which a curator reads (ADR-0129 decision 2).
 */
export function passesAsUnseen(field: string): boolean {
  return field !== `${METADATA_CLAIM_PREFIX}wikidataQid` && placeFieldUnseen(field);
}

/**
 * Whether a metadata key's rewrite passes the gate, and as which class, or
 * null. `sameImage` is whether the place keeps its picture: a credit passes
 * only beside the same file. The keys the gate weighs as major
 * (`MAJOR_METADATA_KEYS` — an inscription year among them) never pass, and a
 * value that appears or disappears is no re-reading.
 */
export function metadataPassesTheGate(key: string, old: unknown, next: unknown, sameImage: boolean): GatePass | null {
  if ((MAJOR_METADATA_KEYS as readonly string[]).includes(key)) return null;
  if (key === 'imageCredit') {
    const [a, b] = [old as { license?: unknown } | null, next as { license?: unknown } | null];
    // A licence on both sides, and the same one: a credit that names none
    // cannot be read as the same terms.
    return sameImage && a && b && typeof a === 'object' && typeof b === 'object'
      && typeof a.license === 'string' && a.license !== '' && a.license === b.license
      ? 'same-file-credit' : null;
  }
  // Every Wikidata kind writes as the item the id its membership knows the place
  // by, so an item arriving where the place holds none is that id written down:
  // a World Heritage site the UNESCO run made, which writes no item (#1794). An
  // item replaced by another is a different object, and stays a question.
  if (key === 'wikidataQid' && isEmptyValue(old) && typeof next === 'string' && WIKIDATA_ITEM.test(next)) {
    return 'own-item';
  }
  if (MEASURED_METADATA_KEYS.includes(key) && typeof old === 'number' && typeof next === 'number' && old > 0
      && Math.abs(next - old) / old < REMEASURED_SHARE) {
    return 'remeasured';
  }
  // A key the incoming record lacks is no rewrite the held row can take: the
  // upsert merges only the keys the record carries (`PASSING_SLICE`), so a
  // removal stays a question. A key sent as null is written.
  return next !== undefined && passesAsUnseen(`${METADATA_CLAIM_PREFIX}${key}`) ? 'unseen' : null;
}

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
  significance: FieldSignificance;
  /** A curator had claimed this field, so the stored value won on purpose. */
  curatedConflict: boolean;
  /**
   * The source's gate kept this write out of a row a reader can already see,
   * so the stored value won *provisionally* and a verdict is waiting (#519).
   *
   * The other half of "why was this not written", and never true beside
   * `curatedConflict`: the two are answered by different endpoints — a claim
   * through `accept-source`, a hold through `POST /:id/publish` — so a field
   * carrying both would raise two contradictory cards over one value.
   *
   * Positive rather than inferred: "refused and not claimed" is not "held",
   * because the gate is not the only other reason a write can be refused.
   */
  held: boolean;
  /**
   * On a row the gate holds, a rewrite it let through unasked, and why
   * (`GatePass`, #1353): written, so filed with the written fields, and saying
   * why no one was asked.
   */
  passedTheGate?: GatePass;
}

export interface ChangeSetResult {
  changeType: 'created' | 'updated' | 'unchanged';
  changedFields: FieldChange[];
  significance: FieldSignificance | null;
  curatedConflicts: FieldChange[];
  /** Fields the gate refused. Proposed, recorded, and waiting on a curator. */
  heldFields: FieldChange[];
}


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
 * `experienceUpsert.ts` writes these keys past the gate for the same reason
 * the membership's `last_seen_at` goes past it, and the two halves have to agree. Ignored in the
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
 * what the import ranks by, and a move in it would otherwise reach a curator's
 * card. `admittedFor` — "the reason the row exists", the work with the most
 * language links among the ones the pass placed, which no reader sees and
 * which the admission rule re-decides every pass — is not on the row at all:
 * it is what the kind says about the place, so it is written on the membership
 * (`admitted_for`, #822) and never enters metadata or this diff.
 * `wikidataClasses` and `wikidataArtwork` on a landmark are the
 * same shape one source over (#754): every class the public-art rule read,
 * and whether an artwork class answered it, kept so that Catalogue Checks can
 * ask what an admitted row is typed as; the rule re-reads them every run and
 * files its own refusal when they stop passing.
 *
 * The archaeology run adds three of the same shape (ADR-0058 decision 2), and
 * they are the run's working-out written down rather than facts about the
 * museum. `wikipediaCategories` is what English Wikipedia files the article
 * under, read because the class tree is silent about half the canon — the
 * British Museum is no `archaeological museum` to Wikidata and is
 * `Archaeological museums in London` to Wikipedia; editors re-file articles
 * constantly, and each re-filing would be a card asking a curator to approve a
 * category list nobody displays. `archaeologyNature` is what that reading
 * produced — `archaeological`, `department`, or `find` for a museum of no
 * nature held for a famous find no other kind shows (ADR-0103) — and
 * `admissionNote` the sentence the rule wrote for the curator screen — about a
 * museum it held for a person to decide, or (#895, ADR-0060 decision 2) about a site it admitted
 * on the map's word alone, with no class of a site on the item to vouch for
 * it. All three are re-derived from
 * live Wikidata and Wikipedia on every pass, so a stored copy is never what
 * decides anything — and a question a run answers again every time it runs is
 * not a question to put to a person.
 */
export const SYNC_OWNED_METADATA_KEYS = [
  'artworkCount', 'totalArtworkSitelinks', 'sitelinksCount',
  'wikidataClasses', 'wikidataArtwork',
  'archaeologyNature', 'admissionNote', 'wikipediaCategories',
  // The readership door's question on a place it alone admitted (ADR-0056),
  // one key per kind that opens the door, since a place two kinds hold would
  // otherwise carry whichever run's sentence came last. Re-derived every pass,
  // as admissionNote is.
  'museumReadershipNote', 'worshipReadershipNote',
  // What OpenStreetMap said about a site, and when (ADR-0059 decision 2). The
  // run's own reading, re-derived every pass and stamped with the date it was
  // read: a curator cannot be right about which object carried the tag, and a
  // card asking them to approve a re-tag on somebody else's wiki would be
  // asking about the rule rather than about the place.
  'osm',
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
export const METADATA_SET_KEYS: ReadonlySet<string> = new Set(['creators']);

/** Whether a metadata key's two values say the same thing. */
function sameMetadataValue(key: string, before: unknown, after: unknown): boolean {
  if (METADATA_SET_KEYS.has(key) && Array.isArray(before) && Array.isArray(after)) {
    return sameLabelSet(before.map(String), after.map(String));
  }
  return jsonEquals(before, after);
}

/**
 * The `curated_fields` prefix for a per-key metadata claim (`metadata.website`,
 * never `metadata` itself). Which keys such a claim reaches is
 * `claimedMetadataKeys`, below; the constant is shared with the writers that
 * build a claim's name (`editExperience`) or recognise a metadata entry
 * (`publishHeldFields.ts`), so no second spelling of the prefix can drift (#488).
 */
export const METADATA_CLAIM_PREFIX = 'metadata.';

/**
 * The prefix a language of the local-names map is reported under (`nameLocal.ko`).
 *
 * `name_local` is one jsonb column, and each language that differs is its own
 * entry: one entry carrying the whole map asks six facts with one pair of
 * buttons when a run proposes six local names for Getbol — the shape ADR-0039
 * refuses for `metadata`, one column over (#728). Publishing merges the
 * entries back onto the stored map exactly as it does for metadata keys.
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
 *
 * No metadata key is here, and no `metadata` either: a claim on metadata is
 * always per key and named for it — `metadata.inDanger`, `metadata.website` —
 * so `claimKeyFor`'s fallback answers every metadata entry with its own name,
 * and a CHECK on `experiences.curated_fields` refuses the bare column name
 * (ADR-0077 decision 3). A claim is then in the grain the run records, so every
 * key a claim protects is a key a curator can be asked about.
 */
export const CURATED_KEY_BY_FIELD: Record<string, string> = {
  name: 'name',
  nameLocal: 'name_local',
  subtitle: 'subtitle',
  description: 'description',
  type: 'type',
  tags: 'tags',
  location: 'location',
  countryCodes: 'country_codes',
  countryNames: 'country_names',
  imageUrl: 'image_url',
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
 * (`experienceUpsert.ts`), and no editor writes the column at all, so the claim on a
 * language is the claim on all of them.
 *
 * Read in two runtimes. `claimKeyFor` below is one; the queue's conflict SQL is
 * the other, and takes this object as a parameter rather than spelling the rule
 * out again — see `queryConflicts` in `reviewQueueConflicts.ts`.
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

/**
 * The metadata keys a curator's per-key claims hold on a row, as bare key
 * names: the keys the run puts back over the source's object, and the keys the
 * diff files as the curator's rather than as applied (ADR-0077 decision 2).
 *
 * One declaration for every runtime that asks it. The upsert binds this list
 * rather than parsing `curated_fields` in SQL, `metadataChanges` reads it to
 * decide what a claim protects, and publishing a held proposal reads it to put
 * the claimed keys back — so none of them can exclude a key the others honour.
 *
 * Two rules on top of the prefix, both facts about the stored row:
 * - **A key the run computes about its own pass is never held**
 *   (`SYNC_OWNED_METADATA_KEYS`): nobody can be right about a measurement, and
 *   a claimed counter put back over the source's value would be a number no
 *   run could ever correct.
 * - **A key the row no longer carries is not held either.** Presence, not
 *   truth — `Object.hasOwn`, as `'{"a":null}'::jsonb ? 'a'` is in SQL — so a
 *   curator who deliberately cleared a value and still claims it stays
 *   protected, while an orphaned claim falls through and the source's value
 *   lands. Putting back a key the row lacks would overlay a null over what the
 *   source just sent.
 *
 * A major key (`MAJOR_METADATA_KEYS`) is held like any other: a claim on
 * `metadata.inDanger` keeps the curator's flag and is reported as theirs.
 */
export function claimedMetadataKeys(
  curatedFields: readonly string[],
  stored: Record<string, unknown> | null,
): string[] {
  if (stored === null) return [];
  return curatedFields
    .filter(claim => claim.startsWith(METADATA_CLAIM_PREFIX))
    .map(claim => claim.slice(METADATA_CLAIM_PREFIX.length))
    .filter(key => !isSyncOwned(key) && Object.hasOwn(stored, key));
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
   * `claimKeyFor`. A metadata key cannot: a per-key claim holds only the keys
   * `claimedMetadataKeys` answers for the stored row — the list the upsert
   * binds — so an orphaned claim falls through and the source's value lands,
   * and filing it as a conflict would offer a curator "accept" on a value
   * already applied. That is a fact about the stored row, so the answer comes
   * from `metadataChanges`, which has it, rather than from a name lookup that
   * does not.
   *
   * It answers **protection**; the name answers **addressability**, and the two
   * agree because a metadata claim is always per key (ADR-0077 decision 3).
   * Every reader of a conflict or a held entry — the queue, `accept-source`,
   * `decline-source` and publishing's skip list — resolves its claim through
   * `claimKeyFor`, which sends `metadata.<key>` to itself: the very claim that
   * protected it. A claim on the whole column, which would protect every key
   * while matching none of their names, is refused by the schema.
   */
  protectedByClaim?: boolean;
  /**
   * The upsert writes this field whether or not the gate holds the row, so a
   * held row reports its change as written — which it was — rather than as
   * waiting on a verdict. The diff reads two such fields: the extent, since an
   * outline is what somebody surveyed, not a claim about the place
   * (`experienceUpsert.ts`, the `boundary` arm), and the anchor of a place of
   * several points, which is the run's and no coordinate of the place's own
   * (ADR-0095, `locationDiff`). `tags` is written past the gate too and
   * compared nowhere.
   */
  pastTheGate?: boolean;
  /** A rewrite of this class passes the gate on a held row (`metadataPassesTheGate`, #1353). */
  passedTheGate?: GatePass;
}

function textEquals(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  return a === b;
}

function setEquals(a: string[] | null, b: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every(item => seen.has(item));
}

function fieldSignificance(field: string): FieldSignificance {
  return MAJOR_FIELDS.has(field) ? 'major' : 'minor';
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
 * No catch-all entry: an answer is addressed to an entry, so an entry that
 * carried several unclaimed keys would fold those facts into one answer, on a
 * split decided here and invisible to the person being asked.
 *
 * One group is reported nowhere: the keys the run computes about its own
 * pass. They are not a question, so they raise no card — see
 * `SYNC_OWNED_METADATA_KEYS`.
 */

function metadataChanges(
  before: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
  curatedFields: string[],
  sameImage: boolean,
): RawDiff[] {
  const changes: RawDiff[] = [];
  const left = before ?? {};
  const right = incoming ?? {};
  // What the claims hold is the list the upsert binds for the same row
  // (`claimedMetadataKeys`), so a key is reported as the curator's exactly
  // where the write kept the curator's value — never by a name lookup, which
  // would ask a whole-column question of a per-key name (#488).
  const claimed = claimedMetadataKeys(curatedFields, before);
  const isMajor = (key: string): boolean => (MAJOR_METADATA_KEYS as readonly string[]).includes(key);

  for (const key of MAJOR_METADATA_KEYS) {
    if (!jsonEquals(ownValue(left, key), ownValue(right, key))) {
      changes.push({
        field: `${METADATA_CLAIM_PREFIX}${key}`,
        old: ownValue(left, key),
        new: ownValue(right, key),
        significance: 'major',
        protectedByClaim: claimed.includes(key),
      });
    }
  }

  // A claimed key that is not major, reported here rather than by the generic
  // loop below; a major one was reported above, with its claim, and is left out
  // so it is not pushed twice.
  for (const key of claimed) {
    if (!isMajor(key) && !jsonEquals(ownValue(left, key), ownValue(right, key))) {
      changes.push({
        field: `${METADATA_CLAIM_PREFIX}${key}`,
        old: ownValue(left, key),
        new: ownValue(right, key),
        significance: 'minor',
        protectedByClaim: true,
      });
    }
  }

  const ignoredKeys = [...MAJOR_METADATA_KEYS, ...SYNC_OWNED_METADATA_KEYS, ...claimed];
  // Everything else, one entry per key, for the same reason the two groups above
  // get one: **a curator answers a fact, and a key is a fact.** A single
  // `metadata` entry folds them into one answer — a run proposing inscription
  // criteria and a picture credit together makes taking the criteria mean
  // taking the credit with them — on a split decided here, invisible to the
  // person being asked. Every key has its own answer, as `metadata.inDanger`
  // has had since #600.
  //
  // The stripping the catch-all needed goes with it. Its payload had to be
  // trimmed of the keys reported above, or a curator would read a claimed value
  // inside a row marked applied beside the row saying it was refused (#488); with
  // one key per entry there is no shared payload to disagree with itself.
  // A per-key claim the stored row can no longer honour protects nothing, which
  // is not knowable from a field name, so this decides it — see
  // `RawDiff.protectedByClaim`. The claimed keys the row still carries were
  // reported above, so nothing that remains is protected.
  const reported = new Set(ignoredKeys);
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (reported.has(key)) continue;
    if (sameMetadataValue(key, ownValue(left, key), ownValue(right, key))) continue;
    const passed = metadataPassesTheGate(key, ownValue(left, key), ownValue(right, key), sameImage);
    changes.push({
      field: `${METADATA_CLAIM_PREFIX}${key}`,
      old: ownValue(left, key),
      new: ownValue(right, key),
      significance: 'minor',
      protectedByClaim: false,
      ...(passed ? { passedTheGate: passed } : {}),
    });
  }

  return changes;
}

/**
 * Whether a credit may pass the gate as the same file's: the place keeps its
 * picture, and no curator owns it — a claimed picture's credit is the claim's,
 * as the upsert's last metadata arm puts it back.
 */
function creditMayPass(sameImage: boolean, curatedFields: string[]): boolean {
  return sameImage && !curatedFields.includes('image_url');
}

/**
 * The metadata keys the upsert writes past the gate on a held row (#1353): the
 * per-key rewrites `metadataChanges` files as passed, by the same rule — so the
 * write and the record cannot disagree.
 */
export function passingMetadataKeys(
  before: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
  curatedFields: string[],
  sameImage: boolean,
): string[] {
  return metadataChanges(before, incoming, curatedFields, creditMayPass(sameImage, curatedFields))
    .filter(diff => diff.passedTheGate && !diff.protectedByClaim)
    .map(diff => diff.field.slice(METADATA_CLAIM_PREFIX.length));
}

/**
 * The place's coordinate as a diff, or none within `LOCATION_UNCHANGED_METERS`.
 * A place of several points has no coordinate of its own (ADR-0095): its
 * anchor moving says nothing a reader sees, so it is minor and written past
 * the gate, recorded rather than asked.
 */
function locationDiff(before: ExperienceSnapshot, incoming: ExperienceSnapshot): RawDiff | null {
  const moved = distanceMeters(before.lon, before.lat, incoming.lon, incoming.lat);
  if (moved < LOCATION_UNCHANGED_METERS) return null;
  return {
    field: 'location',
    old: { lon: before.lon, lat: before.lat },
    new: { lon: incoming.lon, lat: incoming.lat },
    significance: !incoming.locationIsAnchor && moved > LOCATION_MAJOR_METERS ? 'major' : 'minor',
    ...(incoming.locationIsAnchor ? { pastTheGate: true } : {}),
  };
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
 * What each entry says is what the card derives for itself with `changedKeys`
 * (`objectDiff.ts`), on the same equality, in the same alphabetical order. So a
 * run files what a reader is shown, and the answer reaches the row rather than
 * the column.
 * Alphabetical because a jsonb column does not keep the order the keys went in,
 * and the same card has to read the same way twice.
 *
 * `jsonEquals` per language rather than `textEquals`, because that is what the
 * card compares — the same import, `@tyr/shared/equality`, in `objectDiff.ts`
 * — and the two agree on a string, while only this one is right about a value
 * that is not one.
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
    const field = `${NAME_LOCAL_CLAIM_PREFIX}${language}`;
    changes.push({
      field,
      old: ownValue(left, language),
      new: ownValue(right, language),
      significance: 'minor',
      ...(passesAsUnseen(field) ? { passedTheGate: 'unseen' as const } : {}),
    });
  }
  return changes;
}

/**
 * Whether a stored type is none, or one the incoming record's kind has no word
 * for, replaced by one it has.
 */
function outsideVocabulary(stored: string | null, incoming: ExperienceSnapshot): boolean {
  const vocabulary = incoming.typeVocabulary;
  if (!vocabulary || incoming.type === null || !vocabulary.includes(incoming.type)) return false;
  return stored === null || !vocabulary.includes(stored);
}

/**
 * The place's own text fields that differ. A subtitle arriving where the place
 * holds none fills a line a visitor sees empty, so it is written past the gate
 * (ADR-0133): a World Heritage site the UNESCO run made, which writes none, and
 * which a Wikidata kind also admits. The upsert's subtitle arm is the same rule.
 * A subtitle replaced or removed stays a question. A type its kind's vocabulary
 * has no word for, or none, replaced by one it has, is written past the gate
 * the same way (ADR-0135); a type moved inside the vocabulary stays a question.
 * A name, subtitle or description rewritten only in its typesetting passes as
 * `typography` (ADR-0139).
 */
function textDifferences(before: ExperienceSnapshot, incoming: ExperienceSnapshot): RawDiff[] {
  const textFields = ['name', 'subtitle', 'description', 'type', 'imageUrl'] as const;
  return textFields
    .filter(field => !textEquals(before[field], incoming[field]))
    .map(field => ({
      field, old: before[field], new: incoming[field], significance: fieldSignificance(field),
      ...textPass(field, before, incoming),
    }));
}

/** The class a text field's rewrite passes the gate as, if any. */
function textPass(
  field: 'name' | 'subtitle' | 'description' | 'type' | 'imageUrl', before: ExperienceSnapshot, incoming: ExperienceSnapshot,
): { passedTheGate?: GatePass } {
  if (field === 'subtitle' && isEmptyValue(before.subtitle)) return { passedTheGate: 'first-subtitle' };
  if (field === 'type' && outsideVocabulary(before.type, incoming)) return { passedTheGate: 'type-outside-vocabulary' };
  if (field !== 'type' && field !== 'imageUrl' && sameTypography(before[field], incoming[field])) {
    return { passedTheGate: 'typography' };
  }
  return {};
}

function collectDifferences(
  before: ExperienceSnapshot,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
): RawDiff[] {
  const diffs: RawDiff[] = textDifferences(before, incoming);

  diffs.push(...nameLocalChanges(before.nameLocal, incoming.nameLocal));

  // Tags are compared nowhere. The import derives them from facts it also
  // stores by name -- `criterion_ii` from the criteria string, `in_danger`
  // from the danger listing, `monument` from the landmark's type -- and no
  // reader-facing read returns them (#570), so a tags row on a card would
  // restate the row beside it to a person who could change nothing a reader
  // sees by answering. The upsert writes them past the
  // gate for the same reason, and keeps a curator's claim on them for a
  // different one: a person's deliberate write is not a measurement. A claimed
  // value the source disagrees with is therefore kept and not reported either
  // -- there is no decision in it, since nobody reads the outcome (#570).

  // A place's countries are shown to no reader (#1579, `@tyr/shared/readerFields`):
  // written past the gate as `unseen`, as the upsert writes them.
  for (const field of ['countryCodes', 'countryNames'] as const) {
    if (!setEquals(before[field], incoming[field])) {
      diffs.push({
        field, old: before[field], new: incoming[field], significance: fieldSignificance(field),
        ...(passesAsUnseen(field) ? { passedTheGate: 'unseen' as const } : {}),
      });
    }
  }

  const location = locationDiff(before, incoming);
  if (location) diffs.push(location);

  // The extent, by the hash of the geometry the writer stores: a re-traced
  // polygon is a change and a re-read of the same one is not. The record
  // carries the area, which is the number a person reads; the hash decides.
  const beforeHash = before.boundary?.hash ?? null;
  const incomingHash = incoming.boundary?.hash ?? null;
  if (beforeHash !== incomingHash) {
    diffs.push({
      field: 'boundary',
      old: before.boundary ? { areaKm2: before.boundary.areaKm2 } : null,
      new: incoming.boundary ? { areaKm2: incoming.boundary.areaKm2 } : null,
      significance: 'minor',
      pastTheGate: true,
    });
  }

  diffs.push(...metadataChanges(
    before.metadata, incoming.metadata, curatedFields, creditMayPass(before.imageUrl === incoming.imageUrl, curatedFields),
  ));

  return diffs;
}

/**
 * The place's columns a held row takes all the same, by the classes that pass
 * (#1834): `passingMetadataKeys`'s counterpart for the guarded columns, by the
 * same diff, so the write and the record cannot disagree. A column passes only
 * when every change filed under it passes and no claim protects it; the local
 * names are one column, reported one language at a time.
 */
const PASSING_COLUMNS: ReadonlySet<string> = new Set([
  'name', 'name_local', 'subtitle', 'description', 'country_codes', 'country_names',
]);

export function passingColumns(
  before: ExperienceSnapshot,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
): string[] {
  const curated = new Set(curatedFields);
  const verdicts = new Map<string, boolean>();
  for (const diff of collectDifferences(before, incoming, curatedFields)) {
    const column = claimKeyFor(diff.field);
    if (!PASSING_COLUMNS.has(column)) continue;
    verdicts.set(column, (verdicts.get(column) ?? true) && diff.passedTheGate !== undefined && !curated.has(column));
  }
  return [...verdicts].filter(([, passes]) => passes).map(([column]) => column);
}

/** Which of the three buckets one difference lands in, and as what (`computeChangeSet`). */
function filed(
  diff: RawDiff, curated: ReadonlySet<string>, held: boolean,
): { change: FieldChange; bucket: 'written' | 'claimed' | 'held' } {
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
  // A field the upsert writes past the gate is not held by it, whatever the
  // row's gate state: filed as written, because it was (`pastTheGate`).
  // A rewrite of a passing class is written past it too, and says why (#1353).
  const passed = held && !isProtected ? diff.passedTheGate : undefined;
  const heldBack = held && !diff.pastTheGate && !passed;
  const change: FieldChange = {
    field: diff.field,
    old: diff.old,
    new: diff.new,
    significance: diff.significance,
    curatedConflict: isProtected,
    held: !isProtected && heldBack,
    ...(passed ? { passedTheGate: passed } : {}),
  };
  if (isProtected) return { change, bucket: 'claimed' };
  return { change, bucket: heldBack ? 'held' : 'written' };
}

/**
 * Diff a stored row against the record the source just produced.
 *
 * Every difference lands in exactly one of three buckets, and which one says why
 * the run did or did not write it. `changedFields` means *written*.
 * `curatedConflicts` means a curator had claimed the field, so the stored value
 * won on purpose and nothing is waiting. `heldFields` means the source's gate
 * kept the write out of a row a reader can already see, so the stored value won
 * provisionally and a verdict **is** waiting (#519).
 *
 * A row whose only differences were refused is `unchanged` — because nothing
 * about it changed. Both refusals are still reported: the value the source
 * proposed exists nowhere else, and it is what a curator is being asked about.
 *
 * `held` is the statement's own answer, not a rule re-applied here: the hold is
 * decided in SQL, against the stored row as the write locked it, and
 * `experienceUpsert.ts` hands that answer back (`was_held`). Re-deriving it on this side
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
    const { change, bucket } = filed(diff, curated, held);
    if (bucket === 'claimed') curatedConflicts.push(change);
    else if (bucket === 'held') heldFields.push(change);
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
