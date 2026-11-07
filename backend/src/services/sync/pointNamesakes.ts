/**
 * A rough point's namesakes, asked of the full OpenStreetMap from the
 * approximate-point card (#2243).
 *
 * The hints read OpenStreetMap from the local layer (ADR-0134), which keeps
 * only selected tags. The Cemetery of Congregation, one of Echmiatsin's
 * components, is mapped by that exact name as way 1095868935, a
 * `landuse=cemetery` 244 m from the list's point, and the layer does not hold
 * it, so the card offered nothing. ADR-0134 decision 4 asks such a miss of
 * Overpass. This module asks it for one point, when a curator presses
 * *Ask OpenStreetMap by name* on the card.
 *
 * It is asked from the card rather than from the *Find component items*
 * pass. Measured on 2026-11-02, 60 random points of the 462 with no hint gave
 * one true namesake: the cemetery. Each point took 3–40 s on a free,
 * overloaded instance, and the main instance asks automated clients to run
 * their own. A curator's click is the human-operated use those instances
 * serve.
 *
 * The question is the hint search's own, held to its rules: objects within
 * `OSM_NAME_RADIUS_M` whose `name` or `name:en` contains the longest word of
 * the component's name, kept when trigram similarity reaches
 * `OSM_NAME_SIMILARITY`, never the place the component is named after
 * (`namedAfterSql`), nor the point copied, nor the object already offered by
 * its World Heritage reference. The answer is kept in
 * `experience_point_name_asks`, empty or not, so the point is asked once. It
 * stands while the point keeps the name and coordinate it was asked with, and
 * the next pass carries it into the point's hints (`pointHints.ts`).
 */

import { pool, rollbackQuietly } from '../../db/index.js';
import { approximatePointOpenSql, namedAfterSql, OSM_NAME_HINTS, OSM_NAME_RADIUS_M, OSM_NAME_SIMILARITY } from './pointHints.js';
import { COPIED_COORDINATE_M } from './componentItemMatching.js';
import { shownBySql } from '../../db/placePoints.js';
import { overpassAsker, OverpassInstancesClosedError } from './osm/overpassOsm.js';
import type { OverpassElement } from './osm/overpassGeometry.js';
import { WaitBudget } from './sourceRetry.js';

/**
 * How long one curator's question may wait on the instances, retries included,
 * and, apart from that, for the process's Overpass turn, which a run's question
 * may hold (`OverpassBusyError`, #2356).
 */
const ASK_WAIT_BUDGET_MS = 30000;
/** The run time the question declares: a dense city's 2 km took 17 s on the day it was measured. */
const ASK_TIMEOUT_S = 60;
const LOG_PREFIX = '[Point namesakes]';

/** What a curator's question found: how many namesakes are now hints of the point. */
export interface NamesakesAnswer {
  found: number;
  /** False where the point had been asked already with this name and coordinate. */
  asked: boolean;
}

/** The longest word of a component's name, which every namesake must contain; null where it has none of three letters. */
export function nameWord(name: string): string | null {
  const words = (name.toLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? []).filter(word => word.length >= 3);
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The word as an Overpass regular expression's text: every character that means something there stands for itself. */
function asRegexText(word: string): string {
  return word.replace(/[\\^$.|?*+()[\]{}"]/g, '\\$&');
}

/** The one Overpass question for a point: its 2 km first, then the names in it, `out center` for a way's coordinate. */
export function namesakesQuery(latitude: number, longitude: number, word: string): string {
  const text = asRegexText(word);
  return `[out:json][timeout:${ASK_TIMEOUT_S}][maxsize:33554432];`
    + `nwr(around:${OSM_NAME_RADIUS_M},${latitude},${longitude})->.near;`
    + `nwr.near["name"~"${text}",i]->.byName;nwr.near["name:en"~"${text}",i]->.byEnglish;`
    + '(.byName;.byEnglish;);out tags center;';
}

/** One answered object, as the hints read it: where it stands and what it is called. */
interface Namesake {
  ref: string;
  name: string | null;
  name_en: string | null;
  label: string | null;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

function namesakeOf(element: OverpassElement): Namesake | null {
  const at = element.center ?? (element.lat !== undefined && element.lon !== undefined
    ? { lat: element.lat, lon: element.lon } : null);
  if (!at) return null;
  const tags = element.tags ?? {};
  return {
    ref: `${element.type[0].toUpperCase()}${element.id}`,
    name: tags.name ?? null,
    name_en: tags['name:en'] ?? null,
    label: tags['name:en'] ?? tags.name ?? null,
    latitude: at.lat,
    longitude: at.lon,
    tags,
  };
}

/** One question at a time from every curator, the instances' one request of a client. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * One asker for every curator's question, so the pause between two questions
 * and the instance an earlier question was turned away from hold across them
 * (`overpassAsker`); each question brings its own wait budget.
 */
let cardAsker = newCardAsker();

function newCardAsker(): ReturnType<typeof overpassAsker> {
  return overpassAsker({ cancel: false, statusMessage: '' }, new WaitBudget(ASK_WAIT_BUDGET_MS), LOG_PREFIX, { turnWaitMs: ASK_WAIT_BUDGET_MS });
}

/**
 * A question to the card's asker. One whose every instance has turned the
 * card away fails, and the next question starts again from the first
 * instance, so one bad hour does not close the button for good.
 */
async function askOfTheCard(query: string): Promise<OverpassElement[]> {
  const asker = cardAsker;
  try {
    return await asker(query, new WaitBudget(ASK_WAIT_BUDGET_MS));
  } catch (error) {
    if (error instanceof OverpassInstancesClosedError) cardAsker = newCardAsker();
    throw error;
  }
}

/**
 * Ask the full OpenStreetMap for the namesakes of the open rough point
 * `locationId` of the site `siteId`, keep the answer, and make them its hints.
 * Null where the site shows no such open rough point.
 */
export async function askPointNamesakes(
  siteId: number,
  locationId: number,
  curatorId: number,
  ask: (query: string) => Promise<OverpassElement[]> = askOfTheCard,
): Promise<NamesakesAnswer | null> {
  // The whole question waits its turn, the check that it was not asked
  // already included, so two curators pressing the button on one point ask
  // OpenStreetMap once.
  const turn = queue.then(() => askInTurn(siteId, locationId, curatorId, ask), () => askInTurn(siteId, locationId, curatorId, ask));
  queue = turn.catch(() => undefined);
  return turn;
}

async function askInTurn(
  siteId: number,
  locationId: number,
  curatorId: number,
  ask: (query: string) => Promise<OverpassElement[]>,
): Promise<NamesakesAnswer | null> {
  const point = await pool.query<{ name: string | null; latitude: number; longitude: number; asked: boolean }>(
    `SELECT el.name, ST_Y(el.location) AS latitude, ST_X(el.location) AS longitude,
            EXISTS (SELECT 1 FROM experience_point_name_asks a
                     WHERE a.location_id = el.id AND a.asked_name = el.name
                       AND ST_Equals(a.asked_location, el.location)) AS asked
       FROM experience_locations el
      WHERE el.id = $1 AND ${approximatePointOpenSql('el')} AND ${shownBySql('el', 'ARRAY[$2::int]')}`,
    [locationId, siteId],
  );
  const row = point.rows[0];
  if (!row || row.name === null) return null;
  if (row.asked) {
    const kept = await pool.query<{ found: number }>(
      'SELECT jsonb_array_length(objects) AS found FROM experience_point_name_asks WHERE location_id = $1', [locationId],
    );
    return { found: kept.rows[0]?.found ?? 0, asked: false };
  }

  const word = nameWord(row.name);
  const elements = word === null ? [] : await ask(namesakesQuery(row.latitude, row.longitude, word));
  const answered = elements.map(namesakeOf).filter((namesake): namesake is Namesake => namesake !== null);

  // The hint search's rules, in SQL where the point is: the radius, the copied
  // point, the place a component is named after, the reference already
  // offered, the likeness of the name; the nearest first, as many as a point
  // is offered.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const kept = await client.query<{ objects: unknown[] }>(
      `WITH answered AS (
         SELECT o.ref, o.label, o.latitude, o.longitude, o.tags,
                ST_Distance(ST_SetSRID(ST_MakePoint(o.longitude, o.latitude), 4326)::geography,
                            el.location::geography) AS metres
           FROM jsonb_to_recordset($2::jsonb)
                AS o(ref text, name text, name_en text, label text, latitude float8, longitude float8, tags jsonb),
                experience_locations el
          WHERE el.id = $1
            AND NOT ${namedAfterSql('o.tags')}
            AND o.tags->>'ref:whc' IS DISTINCT FROM el.external_ref
            AND (similarity(lower(o.name), lower(el.name)) >= ${OSM_NAME_SIMILARITY}
                 OR similarity(lower(o.name_en), lower(el.name)) >= ${OSM_NAME_SIMILARITY})
       ), near AS (
         SELECT * FROM answered
          WHERE metres <= ${OSM_NAME_RADIUS_M} AND metres >= ${COPIED_COORDINATE_M}
          ORDER BY metres LIMIT ${OSM_NAME_HINTS}
       )
       INSERT INTO experience_point_name_asks (location_id, asked_name, asked_location, asked_by, objects)
       SELECT el.id, el.name, el.location, $3,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('ref', n.ref, 'label', n.label,
                          'latitude', n.latitude, 'longitude', n.longitude, 'tags', n.tags) ORDER BY n.metres)
                          FROM near n), '[]'::jsonb)
         FROM experience_locations el WHERE el.id = $1
       ON CONFLICT (location_id) DO UPDATE
         SET asked_name = EXCLUDED.asked_name, asked_location = EXCLUDED.asked_location,
             asked_at = NOW(), asked_by = EXCLUDED.asked_by, objects = EXCLUDED.objects
       RETURNING objects`,
      [locationId, JSON.stringify(answered), curatorId],
    );
    const objects = kept.rows[0]?.objects ?? [];
    // The card shows them now, as the next pass would: in place of the point's
    // namesakes, so an object the layer offered too is not listed twice.
    await client.query(
      `DELETE FROM experience_point_hints h
        WHERE h.location_id = $1 AND h.source = 'osm-name' AND h.ref IN (SELECT o->>'ref' FROM jsonb_array_elements($2::jsonb) o)`,
      [locationId, JSON.stringify(objects)],
    );
    await client.query(
      `INSERT INTO experience_point_hints (location_id, source, ref, label, location, metres, tags)
       SELECT el.id, 'osm-name', o->>'ref', o->>'label', p.at,
              round(ST_Distance(p.at::geography, el.location::geography))::int, o->'tags'
         FROM experience_locations el, jsonb_array_elements($2::jsonb) o,
              LATERAL (SELECT ST_SetSRID(ST_MakePoint((o->>'longitude')::float8, (o->>'latitude')::float8), 4326) AS at) p
        WHERE el.id = $1`,
      [locationId, JSON.stringify(objects)],
    );
    await client.query('COMMIT');
    return { found: objects.length, asked: true };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
