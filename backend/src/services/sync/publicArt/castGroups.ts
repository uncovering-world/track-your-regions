/**
 * A group of casts is one place with a point at every cast (#880, ADR-0145
 * decision 2b). Wikidata keeps Rodin's *The Burghers of Calais* as a "group of
 * casts" with one coordinate of its own and the casts as parts (`P527`), each
 * an item with its own coordinate — Calais, Victoria Tower Gardens, Stanford —
 * and *The Thinker* as a group with no coordinate at all, over cast items that
 * name it as what they are part of (`P361`). The group carries the fame; the
 * casts carry the points.
 *
 * A cast is a part, or an item naming the group by `P361` or `P144`, that has
 * a coordinate of its own and a placement that has not ended: a part with no
 * coordinate — the study of one figure — is no cast, and a cast whose every
 * `P276` carries an end time has left. It is called by where it stands, the
 * placement that holds, else by its own label, and judged by where it stands
 * (`placements`): the group is somebody else's only when every cast is (#2036).
 *
 * `fetchCastItems` is the live reader; `subsetCastItems` (`subset/castGroups.ts`)
 * the dump's; `attachCasts` writes what either read onto the pool entity.
 */

import { type Door, doorOf, values } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import { subsetCastItems } from '../subset/castGroups.js';
import { extractQid, isQid, parseWktPoint, preferredCoordinate, LABEL_LANGS, type SparqlBinding } from '../wikidataUtils.js';
import type { CastItemReading } from '../subset/castGroups.js';
import { namingPart } from './castNaming.js';
import type { EntityFacts, PoolEntity } from './queries.js';

/** One cast of a group, standing where its point is. */
export interface CastItem {
  qid: string;
  lat: number;
  lon: number;
  name: string | null;
  countryLabel: string | null;
  /** The cast's classes — what the group is read as, since its own say only "group of casts". */
  classes: string[];
  /** Where the cast stands (`P276`, the placements that hold): what the rule judges it by (#2036). */
  placements: string[];
}

interface CastReading {
  wkt: string | null;
  label: string | null;
  classes: Set<string>;
  /** Each placement named, and whether any best-rank statement still places the cast there. */
  placements: Map<string, { label: string | null; standing: boolean }>;
  countries: Set<string>;
}

function castOf(qid: string, reading: CastReading): CastItem | null {
  const at = reading.wkt ? parseWktPoint(reading.wkt) : null;
  if (!at) return null;
  const standing = [...reading.placements].filter(([, p]) => p.standing).map(([id]) => id);
  if (reading.placements.size && !standing.length) return null;
  const place = standing.length ? namingPart(standing) : null;
  return {
    qid,
    lat: at.lat,
    lon: at.lon,
    name: (place ? reading.placements.get(place)?.label : undefined) ?? reading.label,
    countryLabel: [...reading.countries].sort((a, b) => a.localeCompare(b))[0] ?? null,
    classes: [...reading.classes],
    placements: standing,
  };
}

/** A subset reading as the live reader answers it: the point parsed, the rest as read. */
function castFromSubset(reading: CastItemReading): CastItem | null {
  const at = parseWktPoint(reading.wkt);
  if (!at) return null;
  const { qid, name, countryLabel, classes, placements } = reading;
  return { qid, lat: at.lat, lon: at.lon, name, countryLabel, classes, placements };
}

/** One more row of the casts question folded into what is read of its cast. */
function readCastRow(reading: CastReading, cast: string, row: SparqlBinding): void {
  reading.wkt = preferredCoordinate(reading.wkt, row.coord?.value || null);
  reading.label ??= row.castLabel?.value && row.castLabel.value !== cast ? row.castLabel.value : null;
  const cls = extractQid(row.cls?.value ?? '');
  if (isQid(cls)) reading.classes.add(cls);
  const at = extractQid(row.at?.value ?? '');
  if (isQid(at)) {
    const placement = reading.placements.get(at) ?? { label: null, standing: false };
    if (row.atLabel?.value && !isQid(row.atLabel.value)) placement.label ??= row.atLabel.value;
    placement.standing = placement.standing || !row.ended?.value;
    reading.placements.set(at, placement);
  }
  if (row.countryLabel?.value && !isQid(row.countryLabel.value)) reading.countries.add(row.countryLabel.value);
}

/** The rows of the casts question, grouped by group and cast. */
function readCastRows(rows: SparqlBinding[]): Map<string, Map<string, CastReading>> {
  const readings = new Map<string, Map<string, CastReading>>();
  for (const row of rows) {
    const group = extractQid(row.g?.value ?? '');
    const cast = extractQid(row.cast?.value ?? '');
    if (!isQid(group) || !isQid(cast)) continue;
    const ofGroup = readings.get(group) ?? new Map<string, CastReading>();
    const reading = ofGroup.get(cast) ?? { wkt: null, label: null, classes: new Set(), placements: new Map(), countries: new Set() };
    readCastRow(reading, cast, row);
    ofGroup.set(cast, reading);
    readings.set(group, ofGroup);
  }
  return readings;
}

/** The casts of each of `groups`, by group; a group with none has no entry. */
export async function fetchCastItems(door: Door, groups: string[]): Promise<Map<string, CastItem[]>> {
  const asked = groups.filter(isQid);
  const out = new Map<string, CastItem[]>();
  if (!asked.length) return out;
  const { sparql, step } = doorOf(door);
  await step();
  if (readsSubset(sparql)) {
    for (const [group, readings] of await subsetCastItems(asked)) {
      const casts = readings.flatMap((reading) => castFromSubset(reading) ?? []);
      if (casts.length) out.set(group, casts);
    }
    return out;
  }
  const rows = await sparql(`
    SELECT ?g ?cast ?castLabel ?coord ?cls ?at ?atLabel ?ended ?countryLabel WHERE {
      VALUES ?g { ${values(asked)} }
      { ?g wdt:P527 ?cast } UNION { ?cast wdt:P361 ?g } UNION { ?cast wdt:P144 ?g }
      ?cast wdt:P625 ?coord .
      OPTIONAL { ?cast wdt:P31 ?cls }
      OPTIONAL { ?cast p:P276 ?placement . ?placement a wikibase:BestRank ; ps:P276 ?at .
                 OPTIONAL { ?placement pq:P582 ?ended } }
      OPTIONAL { ?cast wdt:P17 ?country }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }`, { kind: 'edges', label: `the casts of ${asked.length} groups of casts` });
  for (const [group, ofGroup] of readCastRows(rows)) {
    const casts = [...ofGroup].flatMap(([qid, reading]) => castOf(qid, reading) ?? []);
    if (casts.length) out.set(group, casts);
  }
  return out;
}

/**
 * Write a group's casts onto its pool entity: every cast a `PoolCast`, the
 * casts' classes onto the group's facts (so the rule reads the Burghers as the
 * sculptures its casts are), and the first cast's point where the group has
 * none of its own, with that cast's country, since the verdict reads a point.
 * Casts follow numeric item order so an equal-distance anchor is stable. The
 * group's own coordinate is not a cast: it stands on one of them.
 */
export function attachCasts(entity: PoolEntity, facts: EntityFacts | undefined, casts: readonly CastItem[]): void {
  if (!casts.length) return;
  const ordered = [...casts].sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)));
  entity.casts = ordered.map(cast => ({
    lat: cast.lat, lon: cast.lon, placeQid: cast.qid, placeLabel: cast.name, countryLabel: cast.countryLabel,
    placements: cast.placements, classes: cast.classes,
  }));
  if (entity.lat === null || entity.lon === null) {
    entity.lat = ordered[0].lat;
    entity.lon = ordered[0].lon;
    entity.countryLabel = ordered[0].countryLabel;
    entity.countryOptions = null;
    entity.onEarth = true;
  }
  if (facts) {
    for (const cls of ordered.flatMap(cast => cast.classes)) {
      if (!facts.classes.includes(cls)) facts.classes.push(cls);
    }
  }
}
