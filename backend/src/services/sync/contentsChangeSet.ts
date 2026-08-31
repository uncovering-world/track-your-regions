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
import { sameLabel, sameLabelSet } from './labelFold.js';

/** A point as the diff sees it. `ref` and `ordinal` are identity, so neither is here. */
export interface PointSnapshot {
  name: string | null;
  lon: number;
  lat: number;
}

/** A work as the diff sees it. `externalId` is identity; the counts are measurements. */
export interface WorkSnapshot {
  name: string | null;
  /** Every maker the source names, in no asserted order. Empty where none is recorded (#720). */
  artists: string[];
  year: number | null;
  imageUrl: string | null;
}

/** A change with no claim and no hold, which is what most of them are. */
function plain(field: string, before: unknown, after: unknown,
  significance: FieldChange['significance']): FieldChange {
  return { field, old: before, new: after, significance, curatedConflict: false, held: false };
}

/**
 * Mark the changes a curator's claim refused, and the ones the gate held.
 *
 * The claim keys are the column names `experience_locations.curated_fields` and
 * `treasures.curated_fields` hold (ADR-0029), and the field names below are those
 * columns — so unlike the object's diff, which maps `imageUrl` to `image_url` and
 * `metadata.website` to `metadata`, there is nothing to translate here.
 *
 * `heldFields` is the writer's own answer about the row, not a rule re-applied here
 * — the same arrangement `computeChangeSet` has with `syncUtils`: the hold is
 * decided in SQL against the stored row as the write locked it, and the diff takes
 * the answer as given. The gate holds a contents *row* by writing it invisible
 * (ADR-0025 decision 5) and, since ADR-0037, holds a *field* of a row readers can
 * already see exactly as it holds the object's own fields. The claim wins where
 * both are true, for the reason `changeSet.ts` gives: the two are answered by
 * different endpoints, and a field carrying both would raise two contradictory
 * cards over one value.
 *
 * Stamped per field rather than per row, because the writers' guards are per
 * column and the two do not always coincide — see `pointChanges`. A field marked
 * held that the writer wrote is a proposal publishing cannot apply, and the card
 * that carries it can never be cleared.
 */
function underClaims(
  changes: FieldChange[], curatedFields: readonly string[], heldFields: ReadonlySet<string>,
): FieldChange[] {
  const claimed = new Set(curatedFields);
  return changes.map(change => (claimed.has(change.field)
    ? { ...change, curatedConflict: true }
    : { ...change, held: heldFields.has(change.field) }));
}

/**
 * What the location writer's guard covers when the row is held: the name alone.
 *
 * The keeping arm adopts the source's coordinate whatever the gate says — a kept
 * row is within the pairing's ten metres, the same point written more precisely
 * (ADR-0027 decision 4). The pairing measures that on the spheroid (`ST_DWithin`
 * on `geography`) and this diff on a sphere (`distanceMeters`), and the two can
 * disagree by up to 0.6 %, so a point kept at 9.95 m can still report a move
 * here; stamped held, that entry would be one publishing refuses to write.
 */
const POINT_HELD_FIELDS: ReadonlySet<string> = new Set(['name']);

/** What the treasures upsert's guard covers: every field the diff reports. */
const WORK_HELD_FIELDS: ReadonlySet<string> = new Set(['name', 'artists', 'year', 'image_url']);

const NONE_HELD: ReadonlySet<string> = new Set();

/**
 * What a run would change about one point it already holds.
 *
 * `location` carries the object's own thresholds, and for the same reasons: under
 * ten metres is the source rewriting a coordinate more precisely (ADR-0027), and a
 * kilometre is a traveller in the wrong place. A rename is minor — a component that
 * became a *different* place arrives with a different reference, which is a new row
 * and not a change to this one.
 *
 * `held` is whether the writer kept the stored values because the row is visible
 * under a gated source (ADR-0037); the writer knows, this does not.
 */
export function pointChanges(
  before: PointSnapshot,
  after: PointSnapshot,
  curatedFields: readonly string[] = [],
  held = false,
): FieldChange[] {
  const changes: FieldChange[] = [];

  // A source that offers a point without a name has said nothing about its
  // label, and a claimed name must not be reported as an argument with silence.
  // The shape is not hypothetical: `upsertSingleLocation` writes `name: null` for
  // the single point of every museum and every landmark, because a venue's point
  // has no name of its own — so a curator who names one would otherwise produce
  // `renamed (1 kept over the source, claimed)` on every run for ever, about a
  // proposal Wikidata never made. Unclaimed, an incoming null still reports:
  // there the writer really does blank the stored name, and a record that hid it
  // would describe a run that did something else.
  const noNameOffered = (after.name ?? '') === '' && curatedFields.includes('name');
  if (!noNameOffered && !sameLabel(before.name, after.name)) {
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

  return underClaims(changes, curatedFields, held ? POINT_HELD_FIELDS : NONE_HELD);
}

/**
 * What a run would change about one work it already holds.
 *
 * `artists` is the major one, and it is the only field here a traveller plans
 * around: a work whose attribution changed is a different reason to stand in front
 * of it. A title is usually a translation settling down, and a year and a
 * photograph are description.
 *
 * The makers are compared as a **set** (#720). The source states them in an order
 * and can restate them in another, and a run that reordered co-authors has changed
 * nothing about the work — asking a curator which of "Shishkin and Savitsky" or
 * "Savitsky and Shishkin" is right is a card about nothing. A name added or
 * dropped is a real change and is reported. The writer's guard asks the same
 * question of the same pair, so the row cannot move while the record says it did.
 *
 * `held` as on `pointChanges`: the writer's answer about the row, taken as given.
 */
export function workChanges(
  before: WorkSnapshot,
  after: WorkSnapshot,
  curatedFields: readonly string[] = [],
  held = false,
): FieldChange[] {
  const changes: FieldChange[] = [];

  if (!sameLabel(before.name, after.name)) {
    changes.push(plain('name', before.name, after.name, 'minor'));
  }
  if (!sameLabelSet(before.artists, after.artists)) {
    changes.push(plain('artists', before.artists, after.artists, 'major'));
  }
  if ((before.year ?? null) !== (after.year ?? null)) {
    changes.push(plain('year', before.year, after.year, 'minor'));
  }
  if ((before.imageUrl ?? null) !== (after.imageUrl ?? null)) {
    changes.push(plain('image_url', before.imageUrl, after.imageUrl, 'minor'));
  }

  return underClaims(changes, curatedFields, held ? WORK_HELD_FIELDS : NONE_HELD);
}
