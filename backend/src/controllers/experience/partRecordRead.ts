/**
 * What the curator's *Parts* and *Part of* sections read on a place's card
 * (#2118).
 *
 * GET /api/experiences/:id/parts                         the place's parts and wholes
 * GET /api/experiences/:id/part-candidates?role=&q=      the places a curator may choose
 *
 * A row says whose word makes the pair: UNESCO's list (a record of World
 * Heritage components, with the reference and the name the list gives the
 * line — Thessaloniki's "Rotunda" held by the Arch of Galerius and Rotunda), a
 * Wikidata statement, or a curator (`partRecordController.ts`). A pair a
 * curator keeps out is listed after the standing ones, so it can be put back.
 *
 * The search offers, with no name asked, the places within a kilometre of the
 * whole's parts — or of the place itself while it has none, the three works
 * near the Brâncuși ensemble — and the wholes near a place; with a name, the
 * places so named, nearest first. A candidate that cannot be chosen says why
 * (`taken`); one the write would refuse for its depth is refused there, with
 * the chain.
 *
 * Every row, of either read, names a place the caller may be shown: one
 * readers are offered, or one in the caller's scope; so does every distance,
 * measured only from parts the caller may be shown. An unread place outside
 * it is left out, as the review queue and the crowding reads leave it out; an
 * offered one outside it is listed as not the caller's to answer (`in_scope`,
 * `taken: 'scope'`), since the write asks the caller's scope over both places.
 */

import type { z } from 'zod/v4';
import type { PartCandidates, PlaceParts } from '../../api/responses/parts.js';
import { pool } from '../../db/index.js';
import {
  COMPONENT_SOURCE_ID, CURATOR_SOURCE_ID, KINDS, MEMBERSHIPS, kindRecordSql, placeHoldsKindSql, placeOfferedSql,
} from '../../db/membership.js';
import { CURATOR_PLACE_SCOPE_EXISTS, CURATOR_SCOPED_REGIONS_CTE, canCurateExperienceSql } from '../../middleware/auth.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { placeOrPartOfferedSql } from '../../db/readerPredicates.js';
import type { idParamSchema } from '../../types/index.js';
import type { partCandidatesQuerySchema } from '../../types/partSchemas.js';
import { creditOf } from './experienceAnswerRows.js';
import { resolveExperienceScope } from './experienceScope.js';
import { likeParam } from './reviewQueueKeys.js';

/** How far, in metres, the search offers a place near a whole's parts with no name asked. */
const NEAR_PARTS_M = 1000;
/** How far, in metres, it offers a whole near a place. */
const NEAR_WHOLES_M = 5000;
const MOST_CANDIDATES = 10;

/**
 * Whether `target` lies in the box, in degrees, that holds every point within
 * `metres` of `point`: the index's filter before `ST_DWithin` decides in
 * metres. A degree of latitude is at least 110 km, and a circle of that radius
 * spans more degrees of longitude the nearer it stands to a pole, so the box
 * widens east and west: at the Solovetsky Islands (65°N) 5 km is 0.106° of longitude,
 * where a fixed 0.1° box would leave out a whole 4.7 km away. A box that
 * reaches past ±180° is asked again shifted by a turn of the globe, so a place
 * just west of the antimeridian is found from one just east of it, as on
 * Taveuni in Fiji. Where the radius reaches a pole, every longitude is within
 * it, so the box spans them all: at the South Pole the ceremonial and the
 * geographic markers stand about 100 m apart and any number of degrees east.
 */
function nearBoxSql(target: string, point: string, metres: string): string {
  const degrees = `(${metres}::float8 / 110000)`;
  const latitude = `ST_Y(${point})`;
  // The widest longitude a circle of that radius spans: asin(sin r / cos φ),
  // which grows faster than r / cos φ as the circle nears a pole.
  const eastWest = `CASE WHEN abs(${latitude}) + ${degrees} >= 90 THEN 180`
    + ` ELSE degrees(asin(LEAST(1, sin(radians(${degrees})) / cos(radians(${latitude}))))) END`;
  const box = `ST_Expand(${point}, ${eastWest}, ${degrees})`;
  return `(${target} && ${box} OR ${target} && ST_Translate(${box}, 360, 0) OR ${target} && ST_Translate(${box}, -360, 0))`;
}

/** Who asks, as a statement binds it: the caller's id, and whether the caller is an admin. */
interface CallerParams { user: '$1' | '$4'; admin: string }

/**
 * The caller's scope reaches the place `alias`, so a word on it is theirs to
 * give: the scope the write asks of both places (`resolveExperienceScope`),
 * asked of a row (`canCurateExperienceSql`).
 */
function inScopeSql(alias: string, { user, admin }: CallerParams): string {
  return `(${admin} OR ${canCurateExperienceSql(user, alias)})`;
}

/**
 * The places a caller may be shown on these sections, over the experience
 * `alias`: one a reader is offered (`placeOrPartOfferedSql`), or one in the
 * caller's scope, as a place read shows a curator an unread place only in
 * scope (ADR-0025). An unread place outside it is left out.
 */
function shownToCallerSql(alias: string, caller: CallerParams): string {
  return `(${placeOrPartOfferedSql(alias)} OR ${inScopeSql(alias, caller)})`;
}

/** A place as a row shows it, read off `experiences` under `alias`. */
function partPlaceSql(alias: string): string {
  return `json_build_object(
    'id', ${alias}.id, 'name', ${alias}.name, 'subtitle', ${alias}.subtitle,
    'kind_name', (SELECT kd.name FROM ${MEMBERSHIPS} own JOIN ${KINDS} kd ON kd.id = own.kind_id
                   WHERE own.experience_id = ${alias}.id ORDER BY kd.display_priority, kd.id LIMIT 1),
    'waiting', ${placeHoldsKindSql(`${alias}.id`)} AND NOT ${placeOfferedSql(alias)},
    'image_url', ${alias}.image_url, 'image_credit', ${alias}.metadata->'imageCredit',
    'longitude', ST_X(${alias}.location), 'latitude', ST_Y(${alias}.location))`;
}

interface PartPlaceRow {
  id: number;
  name: string;
  subtitle: string | null;
  kind_name: string | null;
  waiting: boolean;
  image_url: string | null;
  image_credit: Parameters<typeof creditOf>[0];
  longitude: number | null;
  latitude: number | null;
}

function placeOf(row: PartPlaceRow): PlaceParts['parts'][number]['place'] {
  return { ...row, image_credit: creditOf(row.image_credit) };
}

async function requirePlaceScope(id: number, caller: Express.User): Promise<string> {
  const found = await pool.query<{ name: string }>('SELECT name FROM experiences WHERE id = $1', [id]);
  if (found.rowCount === 0) throw notFound('Experience not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  return found.rows[0].name;
}

interface PairRow {
  side: 'part' | 'whole';
  place: PartPlaceRow;
  in_scope: boolean;
  standing: boolean;
  list: { reference: string; name: string | null } | null;
  statement: boolean;
  admission: 'admitted' | 'refused' | null;
  answered_at: Date | null;
  last_curator: number | null;
  note: string | null;
}

export async function listPlaceParts(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<PlaceParts> {
  const name = await requirePlaceScope(id, caller);
  const facts = await pool.query<{ in_kind: boolean; merged_onto: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${MEMBERSHIPS} own WHERE own.experience_id = $1 AND ${kindRecordSql('own')}) AS in_kind,
            EXISTS (SELECT 1 FROM experience_merges m WHERE m.survivor_id = $1 AND m.undone_at IS NULL) AS merged_onto`,
    [id],
  );
  // Every pair a record names, from either end, a place's record of itself
  // aside; a pair stands when the relation does, and is kept out otherwise.
  // $1 is the caller, as the scope's prelude and the per-row forms read it.
  const asked: CallerParams = { user: '$1', admin: '$3::boolean' };
  const pairs = await pool.query<PairRow>(
    `${CURATOR_SCOPED_REGIONS_CTE}, pairs AS (
       SELECT DISTINCT 'part' AS side, rec.whole_id, rec.experience_id AS part_id FROM ${MEMBERSHIPS} rec
        WHERE rec.whole_id = $2 AND rec.experience_id <> $2
       UNION
       SELECT DISTINCT 'whole', rec.whole_id, rec.experience_id FROM ${MEMBERSHIPS} rec
        WHERE rec.experience_id = $2 AND rec.whole_id IS NOT NULL AND rec.whole_id <> $2
     )
     SELECT p.side, ${partPlaceSql('other')} AS place, ${inScopeSql('other', asked)} AS in_scope,
            EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = p.whole_id AND prt.part_id = p.part_id) AS standing,
            (SELECT json_build_object('reference', line.external_id,
                      'name', CASE WHEN line.reported_name IS DISTINCT FROM
                                      (SELECT part_name.name FROM experiences part_name WHERE part_name.id = p.part_id)
                                    THEN line.reported_name END)
               FROM ${MEMBERSHIPS} line
              WHERE line.source_id = ${COMPONENT_SOURCE_ID} AND line.whole_id = p.whole_id AND line.experience_id = p.part_id
              LIMIT 1) AS list,
            EXISTS (SELECT 1 FROM ${MEMBERSHIPS} said JOIN experience_sources s ON s.id = said.source_id
                     WHERE said.whole_id = p.whole_id AND said.experience_id = p.part_id
                       AND s.id_scheme = 'wikidata-statement') AS statement,
            word.admission, word.admission_answered_at AS answered_at,
            -- The note as the place's own history shows it to the caller: a row
            -- naming a region outside a region-scoped caller's reads as none.
            CASE WHEN said_last.visible THEN said_last.curator_id END AS last_curator,
            CASE WHEN said_last.visible THEN said_last.note END AS note
       FROM pairs p
       JOIN experiences other ON other.id = CASE p.side WHEN 'part' THEN p.part_id ELSE p.whole_id END
       LEFT JOIN ${MEMBERSHIPS} word
         ON word.source_id = ${CURATOR_SOURCE_ID} AND word.whole_id = p.whole_id AND word.experience_id = p.part_id
       -- The curator's last word on the pair, read off this place's own
       -- history, where it stands as on the other place's, under the curation
       -- log's own rule for a row (curationLogController.ts).
       LEFT JOIN LATERAL (
         SELECT l.curator_id, NULLIF(l.details->>'note', '') AS note,
                ($3::boolean OR ${CURATOR_PLACE_SCOPE_EXISTS} OR l.region_id IS NULL
                 OR l.region_id IN (SELECT id FROM curator_scoped_regions)) AS visible
           FROM experience_curation_log l
          WHERE l.experience_id = $2 AND l.action IN ('part_added', 'part_taken_out', 'part_put_back')
            AND l.details->>'wholeId' = p.whole_id::text AND l.details->>'partId' = p.part_id::text
          ORDER BY l.id DESC LIMIT 1) said_last ON word.id IS NOT NULL
      WHERE ${shownToCallerSql('other', asked)}
      ORDER BY p.side, standing DESC, other.name, other.id`,
    [caller.id, id, caller.role === 'admin'],
  );
  const rowOf = (row: PairRow): PlaceParts['parts'][number] => ({
    place: placeOf(row.place),
    in_scope: row.in_scope,
    standing: row.standing,
    list: row.list,
    statement: row.statement,
    curator: row.admission === null ? null : {
      admission: row.admission,
      answered_at: row.answered_at?.toISOString() ?? null,
      by_you: row.last_curator === caller.id,
      note: row.note,
    },
  });
  return {
    experienceId: id,
    name,
    in_kind: facts.rows[0].in_kind,
    merged_onto: facts.rows[0].merged_onto,
    parts: pairs.rows.filter(row => row.side === 'part').map(rowOf),
    wholes: pairs.rows.filter(row => row.side === 'whole').map(rowOf),
  };
}

interface CandidateRow {
  place: PartPlaceRow;
  distance_m: number | null;
  near_name: string | null;
  taken: 'self' | 'already' | 'loop' | 'scope' | null;
  kept_out: boolean;
  also_part_of: string | null;
}

export async function findPartCandidates(
  { params: { id }, query: { role, q }, caller }: {
    params: z.output<typeof idParamSchema>;
    query: z.output<typeof partCandidatesQuerySchema>;
    caller: Express.User;
  },
): Promise<PartCandidates> {
  await requirePlaceScope(id, caller);
  const asPart = role === 'part';
  // The whole and the part of each candidate pair, as SQL over the place ($1)
  // and the candidate (c.id).
  const [whole, part] = asPart ? ['$1::int', 'c.id'] : ['c.id', '$1::int'];
  // $4 is the caller, $6 whether the caller is an admin.
  const asked: CallerParams = { user: '$4', admin: '$6::boolean' };
  const result = await pool.query<CandidateRow>(
    `WITH RECURSIVE anchors AS (
       -- What a distance is measured from: the whole's parts the caller may be
       -- shown, or the place itself where there is none. A part the caller may
       -- not see is neither named nor measured from, since a distance to it
       -- would place it.
       SELECT a.location, a.name FROM experience_parts prt JOIN experiences a ON a.id = prt.part_id
        WHERE $2::boolean AND prt.whole_id = $1 AND a.location IS NOT NULL AND ${shownToCallerSql('a', asked)}
       UNION ALL
       SELECT self.location, NULL FROM experiences self
        WHERE self.id = $1 AND self.location IS NOT NULL
          AND NOT ($2::boolean AND EXISTS (SELECT 1 FROM experience_parts prt JOIN experiences shown ON shown.id = prt.part_id
                                            WHERE prt.whole_id = $1 AND ${shownToCallerSql('shown', asked)}))
     ), related AS (
       -- The place's wholes, at every level, for a part's search; its parts,
       -- at every level, for a whole's: choosing one would close a loop.
       SELECT $1::int AS id, 0 AS depth
       UNION
       SELECT CASE WHEN $2::boolean THEN prt.whole_id ELSE prt.part_id END, r.depth + 1
         FROM experience_parts prt JOIN related r
           ON r.id = CASE WHEN $2::boolean THEN prt.part_id ELSE prt.whole_id END
        WHERE r.depth < 8
     ), found AS (
       SELECT c.id, near.distance_m, near.name AS near_name
         FROM experiences c
         -- The part nearest in metres: an order in degrees would name another
         -- at a high latitude, where a degree east is shorter than one north.
         CROSS JOIN LATERAL (
           SELECT ST_Distance(c.location::geography, a.location::geography) AS distance_m, a.name
             FROM anchors a ORDER BY 1 LIMIT 1) near
        WHERE c.merged_into_id IS NULL AND c.location IS NOT NULL
          AND EXISTS (SELECT 1 FROM ${MEMBERSHIPS} held WHERE held.experience_id = c.id)
          AND CASE WHEN $3::text IS NOT NULL THEN c.name ILIKE $3
                   ELSE c.id <> $1
                        AND NOT EXISTS (SELECT 1 FROM experience_parts prt
                                         WHERE prt.whole_id = ${whole} AND prt.part_id = ${part})
                        -- Driven from the anchors through the location index: a whole of 420
                        -- parts would otherwise test every place against every part.
                        AND c.id IN (SELECT near_c.id FROM anchors a JOIN experiences near_c
                                       ON ${nearBoxSql('near_c.location', 'a.location', '$5')}
                                      AND ST_DWithin(near_c.location::geography, a.location::geography, $5))
                        AND ($2::boolean OR EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = c.id)) END
          -- A place no reader is offered is a candidate only in the caller's
          -- scope, before the limit, so a left-out one takes no slot.
          AND ${shownToCallerSql('c', asked)}
        ORDER BY near.distance_m NULLS LAST, c.name, c.id
        LIMIT ${MOST_CANDIDATES}
     )
     SELECT ${partPlaceSql('c')} AS place,
            round(f.distance_m)::int AS distance_m, f.near_name,
            CASE WHEN c.id = $1 THEN 'self'
                 WHEN EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = ${whole} AND prt.part_id = ${part})
                   THEN 'already'
                 WHEN c.id IN (SELECT id FROM related) THEN 'loop'
                 -- Offered to readers but outside the caller's scope: the write
                 -- asks the caller's scope over both places, so it cannot be chosen.
                 WHEN NOT ${inScopeSql('c', asked)} THEN 'scope' END AS taken,
            EXISTS (SELECT 1 FROM ${MEMBERSHIPS} word
                     WHERE word.source_id = ${CURATOR_SOURCE_ID} AND word.admission = 'refused'
                       AND word.whole_id = ${whole} AND word.experience_id = ${part}) AS kept_out,
            CASE WHEN $2::boolean THEN
              (SELECT other.name FROM experience_parts prt JOIN experiences other ON other.id = prt.whole_id
                WHERE prt.part_id = c.id AND prt.whole_id <> $1 AND ${shownToCallerSql('other', asked)}
                ORDER BY other.name LIMIT 1) END AS also_part_of
       FROM found f JOIN experiences c ON c.id = f.id
      ORDER BY f.distance_m NULLS LAST, c.name, c.id`,
    [id, asPart, q ? likeParam(q) : null, caller.id, asPart ? NEAR_PARTS_M : NEAR_WHOLES_M, caller.role === 'admin'],
  );
  return {
    experienceId: id,
    role,
    near: !q,
    candidates: result.rows.map(row => ({
      place: placeOf(row.place),
      distance_m: row.distance_m,
      near_name: row.near_name,
      taken: row.taken,
      kept_out: row.kept_out,
      also_part_of: row.also_part_of,
    })),
  };
}
