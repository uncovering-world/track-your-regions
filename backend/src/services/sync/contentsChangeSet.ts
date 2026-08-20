/**
 * What changed about one point or one work — the object's change set, a level down.
 *
 * Pure: no database, no network. `changeSet.ts` answers this for an experience and
 * this answers it for what an experience is made of, deliberately in the same
 * vocabulary (`FieldChange`, `FieldSignificance`, a claim key per field), because
 * ADR-0029 decided contents are curated the way objects are rather than through a
 * second mechanism beside it.
 *
 * The normalisation is the point, as it is upstairs, and the measurement that sets
 * it is small enough to state. Across 6264 stored UNESCO components re-compared
 * against the live source on 2026-08-20, exactly two had been renamed: one dropped a
 * subtitle, and the other replaced a hyphen with an en dash. Reporting the second as
 * a question a curator must answer is how a queue teaches people to stop reading it.
 */

import { distanceMeters, LOCATION_MAJOR_METERS, LOCATION_UNCHANGED_METERS } from './changeSet.js';
import type { FieldChange } from './changeSet.js';

/** A point as the diff sees it. `ref` and `ordinal` are identity, so neither is here. */
export interface PointSnapshot {
  name: string | null;
  lon: number;
  lat: number;
}

/** A work as the diff sees it. `externalId` is identity; the counts are measurements. */
export interface WorkSnapshot {
  name: string | null;
  artist: string | null;
  year: number | null;
  imageUrl: string | null;
}

/**
 * Two labels that name the same thing.
 *
 * Unicode-normalised, dashes folded together, whitespace collapsed, compared
 * case-insensitively. Everything folded here is a typographic rewrite of one name:
 * `Boma-Badingilo` becoming `Boma–Badingilo` is the source's typesetting, not a
 * decision about a place, and nobody can answer a card that asks about it.
 *
 * Case is folded for the same reason and no further: a name that differs by more
 * than its punctuation is a real rename and is reported, minor.
 */
function sameLabel(a: string | null, b: string | null): boolean {
  const fold = (value: string | null) => (value ?? '')
    .normalize('NFKC')
    // Every dash Unicode offers, to the plain one. `‐-―` covers hyphen
    // through horizontal bar; `−` is the minus sign, which sources use too.
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return fold(a) === fold(b);
}

/** A change with no claim and no hold, which is what most of them are. */
function plain(field: string, before: unknown, after: unknown,
  significance: FieldChange['significance']): FieldChange {
  return { field, old: before, new: after, significance, curatedConflict: false, held: false };
}

/**
 * Mark the changes a curator's claim refused.
 *
 * The claim keys are the column names `experience_locations.curated_fields` and
 * `treasures.curated_fields` hold (ADR-0029), and the field names below are those
 * columns — so unlike the object's diff, which maps `imageUrl` to `image_url` and
 * `metadata.website` to `metadata`, there is nothing to translate here. `held` stays
 * false throughout: the gate holds contents by writing a *row* invisible rather than
 * by refusing a field on a row that already exists (ADR-0025 § 3.1), so a field
 * change on a stored point or work is never the thing waiting for a publication.
 */
function underClaims(changes: FieldChange[], curatedFields: readonly string[]): FieldChange[] {
  const claimed = new Set(curatedFields);
  return changes.map(change => (claimed.has(change.field)
    ? { ...change, curatedConflict: true }
    : change));
}

/**
 * What a run would change about one point it already holds.
 *
 * `location` carries the object's own thresholds, and for the same reasons: under
 * ten metres is the source rewriting a coordinate more precisely (ADR-0027), and a
 * kilometre is a traveller in the wrong place. A rename is minor — a component that
 * became a *different* place arrives with a different reference, which is a new row
 * and not a change to this one.
 */
export function pointChanges(
  before: PointSnapshot,
  after: PointSnapshot,
  curatedFields: readonly string[] = [],
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (!sameLabel(before.name, after.name)) {
    changes.push(plain('name', before.name, after.name, 'minor'));
  }

  const moved = distanceMeters(before.lon, before.lat, after.lon, after.lat);
  if (moved >= LOCATION_UNCHANGED_METERS) {
    changes.push(plain(
      'location',
      { lon: before.lon, lat: before.lat },
      { lon: after.lon, lat: after.lat },
      moved > LOCATION_MAJOR_METERS ? 'major' : 'minor',
    ));
  }

  return underClaims(changes, curatedFields);
}

/**
 * What a run would change about one work it already holds.
 *
 * `artist` is the major one, and it is the only field here a traveller plans
 * around: a work whose attribution changed is a different reason to stand in front
 * of it. A title is usually a translation settling down, and a year and a
 * photograph are description.
 */
export function workChanges(
  before: WorkSnapshot,
  after: WorkSnapshot,
  curatedFields: readonly string[] = [],
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (!sameLabel(before.name, after.name)) {
    changes.push(plain('name', before.name, after.name, 'minor'));
  }
  if (!sameLabel(before.artist, after.artist)) {
    changes.push(plain('artist', before.artist, after.artist, 'major'));
  }
  if ((before.year ?? null) !== (after.year ?? null)) {
    changes.push(plain('year', before.year, after.year, 'minor'));
  }
  if ((before.imageUrl ?? null) !== (after.imageUrl ?? null)) {
    changes.push(plain('image_url', before.imageUrl, after.imageUrl, 'minor'));
  }

  return underClaims(changes, curatedFields);
}
