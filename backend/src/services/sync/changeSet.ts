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
 * Held out of the diff on **both sides**, like the major keys and a per-key
 * claim above: a run that moved nothing else is `unchanged` and raises no card,
 * and a run that also changed something real shows a card carrying only the
 * something real. Both sides, because a stored key the catch-all's `old` does
 * not mention is a key the catch-all does not speak for, which is what keeps
 * `publishHeldFields.ts` from wiping the counter when a curator publishes.
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
 * `admittedFor` is derived too and is deliberately not here: it names the most
 * famous work a museum holds, which is the reason the row exists at all, and is
 * worth a look when it changes.
 */
export const SYNC_OWNED_METADATA_KEYS = ['artworkCount', 'totalArtworkSitelinks'] as const;

/** Whether a metadata key belongs to the run rather than to the object. */
function isSyncOwned(key: string): boolean {
  return (SYNC_OWNED_METADATA_KEYS as readonly string[]).includes(key);
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
 * The `curated_fields` entry that protects a given field.
 *
 * The map above answers this for every field that has a column, and the
 * fallback answers it for the ones that do not: `editExperience` claims
 * `metadata.website` per key, and no column matches that name (#488). One
 * function rather than the same `?? field` written out at each site, because
 * every caller — the diff below, the queue's conflict lookup, the publish
 * writer — has to reach the same key or one of them protects nothing.
 */
export function claimKeyFor(field: string): string {
  return CURATED_KEY_BY_FIELD[field] ?? field;
}

interface RawDiff {
  field: string;
  old: unknown;
  new: unknown;
  significance: FieldSignificance;
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
function jsonEquals(a: unknown, b: unknown): boolean {
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
 * A sync-owned key drops out for the same reason a major one does: it is not
 * reported through the catch-all, so it cannot be reported as a claim on the
 * catch-all either. The upsert's re-application of claimed keys carries the
 * identical exclusion, or one of the two would report a conflict over a value
 * the other had just written. Unreachable today — `editExperience` claims only
 * `website`, `wikipediaUrl` and `imageCredit` — but the two sides should agree
 * by construction rather than by what the edit surface happens to offer.
 */
function claimedMetadataKeys(curatedFields: string[]): string[] {
  return curatedFields
    .filter(key => key.startsWith(METADATA_CLAIM_PREFIX))
    .map(key => key.slice(METADATA_CLAIM_PREFIX.length))
    .filter(key => !(MAJOR_METADATA_KEYS as readonly string[]).includes(key))
    .filter(key => !isSyncOwned(key));
}

/**
 * Metadata is diffed in three parts: the keys a product decision hangs on
 * (a site entering the danger list) are reported individually and count as
 * major, a key a curator claimed individually is also reported on its own so
 * a claim on it can be told apart from the catch-all, and everything else
 * collapses into one minor entry.
 *
 * A fourth group is reported nowhere: the keys the run computes about its own
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
    if (!jsonEquals(left[key], right[key])) {
      changes.push({ field: `${METADATA_CLAIM_PREFIX}${key}`, old: left[key], new: right[key], significance: 'major' });
    }
  }

  // A key the curator claimed is reported on its own, so the queue can name it
  // and the upsert's per-key guard (#488) has something to correspond to. Left
  // inside the catch-all it would be invisible: one 'metadata' diff carrying
  // both the key the run kept and the keys it applied.
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
    if (!jsonEquals(left[key], right[key])) {
      changes.push({ field: `${METADATA_CLAIM_PREFIX}${key}`, old: left[key], new: right[key], significance: 'minor' });
    }
  }

  const ignoredKeys = [...MAJOR_METADATA_KEYS, ...SYNC_OWNED_METADATA_KEYS, ...claimed];
  const withoutReportedKeys = (source: Record<string, unknown>) => {
    const copy = { ...source };
    for (const key of ignoredKeys) delete copy[key];
    return copy;
  };

  // Both sides stripped of what this entry does not speak for — reported on its
  // own above, major or individually claimed, or reported nowhere because the
  // run owns it — so the payload matches the label: a key claimed
  // and kept has already had its say in a conflict row above, and carrying
  // its value here too would show a curator that value inside a row marked
  // applied, right next to the row saying it was refused (#488, one layer in:
  // the field was already reported in the right bucket; this is what that
  // bucket's own row says happened).
  const strippedLeft = withoutReportedKeys(left);
  const strippedRight = withoutReportedKeys(right);
  if (!jsonEquals(strippedLeft, strippedRight)) {
    changes.push({ field: 'metadata', old: strippedLeft, new: strippedRight, significance: 'minor' });
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

  if (!jsonEquals(before.nameLocal, incoming.nameLocal)) {
    diffs.push({ field: 'nameLocal', old: before.nameLocal, new: incoming.nameLocal, significance: 'minor' });
  }

  if (!setEquals(before.tags, incoming.tags)) {
    diffs.push({ field: 'tags', old: before.tags, new: incoming.tags, significance: 'minor' });
  }

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
    const isProtected = curated.has(claimKeyFor(diff.field));
    // The claim wins where both are true, and the upsert's `claim OR held` guard
    // is indifferent — it keeps the stored value either way. The claim is the
    // narrower and separately answerable reason: `accept-source` owns it, and
    // publishing deliberately leaves a claimed field alone, so filing it as held
    // would offer a curator their own value back as though a source had sent it.
    const change: FieldChange = {
      ...diff,
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
