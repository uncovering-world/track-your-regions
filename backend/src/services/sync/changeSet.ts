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
  curatedConflict: boolean;
}

export interface ChangeSetResult {
  changeType: 'created' | 'updated' | 'unchanged';
  changedFields: FieldChange[];
  significance: FieldSignificance | null;
  curatedConflicts: FieldChange[];
}

/** Below this, a coordinate difference is source jitter, not a move. */
export const LOCATION_UNCHANGED_METERS = 10;
/** Above this, the object has moved far enough to matter to a traveller. */
export const LOCATION_MAJOR_METERS = 1000;

/** Metadata keys whose change is a product event, not bookkeeping. */
const MAJOR_METADATA_KEYS = ['inDanger', 'dateInscribed'] as const;

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

/** Great-circle distance in metres. */
function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
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
 * Metadata is diffed in two parts: the keys a product decision hangs on
 * (a site entering the danger list) are reported individually and count as
 * major, and everything else collapses into one minor entry.
 */
function metadataChanges(
  before: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
): RawDiff[] {
  const changes: RawDiff[] = [];
  const left = before ?? {};
  const right = incoming ?? {};

  for (const key of MAJOR_METADATA_KEYS) {
    if (!jsonEquals(left[key], right[key])) {
      changes.push({ field: `metadata.${key}`, old: left[key], new: right[key], significance: 'major' });
    }
  }

  const withoutMajorKeys = (source: Record<string, unknown>) => {
    const copy = { ...source };
    for (const key of MAJOR_METADATA_KEYS) delete copy[key];
    return copy;
  };

  if (!jsonEquals(withoutMajorKeys(left), withoutMajorKeys(right))) {
    changes.push({ field: 'metadata', old: before, new: incoming, significance: 'minor' });
  }

  return changes;
}

function collectDifferences(before: ExperienceSnapshot, incoming: ExperienceSnapshot): RawDiff[] {
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

  diffs.push(...metadataChanges(before.metadata, incoming.metadata));

  return diffs;
}

/**
 * Diff a stored row against the record the source just produced.
 *
 * Fields protected by `curated_fields` are reported separately: the upsert will
 * not apply them, so they are a divergence to show a curator rather than a
 * change the run made. A row whose only differences are protected is
 * `unchanged` — because nothing about it changed.
 */
export function computeChangeSet(
  before: ExperienceSnapshot | null,
  incoming: ExperienceSnapshot,
  curatedFields: string[],
): ChangeSetResult {
  if (before === null) {
    return { changeType: 'created', changedFields: [], significance: null, curatedConflicts: [] };
  }

  const curated = new Set(curatedFields);
  const changedFields: FieldChange[] = [];
  const curatedConflicts: FieldChange[] = [];

  for (const diff of collectDifferences(before, incoming)) {
    const protectedBy = CURATED_KEY_BY_FIELD[diff.field];
    const isProtected = protectedBy !== undefined && curated.has(protectedBy);
    const change: FieldChange = { ...diff, curatedConflict: isProtected };
    if (isProtected) curatedConflicts.push(change);
    else changedFields.push(change);
  }

  // Significance covers conflicts as well as applied changes. A row where the
  // source proposed a major change to a curated field and a minor one elsewhere
  // would otherwise be filed as 'minor' and dropped from the default view — the
  // conflict, which is the part needing a decision, would be the hidden half.
  const weighed = [...changedFields, ...curatedConflicts];
  let significance: FieldSignificance | null = null;
  if (weighed.length > 0) {
    significance = weighed.some(f => f.significance === 'major') ? 'major' : 'minor';
  }

  return {
    changeType: changedFields.length === 0 ? 'unchanged' : 'updated',
    changedFields,
    significance,
    curatedConflicts,
  };
}
