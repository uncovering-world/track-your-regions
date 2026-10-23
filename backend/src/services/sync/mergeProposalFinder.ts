/**
 * Two places near each other with similar names are proposed as one place,
 * and a person answers (#1249, ADR-0046 decisions 2 to 4, ADR-0120).
 *
 * Two rules find a pair (`found_by`). Names alike by trigrams, below; and one
 * name's significant words all standing in the other's (#1652), since a short
 * name drowns in a long World Heritage title: Geghard and "Monastery of
 * Geghard and the Upper Azat Valley", 7 m apart, are 0.17 alike. On the
 * development catalogue on 2026-10-18 the second rule found 43 pairs the first
 * did not, most a World Heritage property and the monument inside it (Córdoba's
 * Mosque-Cathedral, Westminster Abbey, Florence Cathedral), some one place
 * (Tikal, Machu Picchu) and a few two places that share a town's name (the
 * Bremen Roland and Bremen Cathedral), which a curator answers. ADR-0120
 * makes it the third universal signal and records why no guard narrows it.
 *
 * An equal Wikidata item never reaches a proposal: a run finds the place its
 * item names before it creates one (ADR-0143), and an item recorded on a place
 * that exists is joined without a question (`equalItemMerges.ts`).
 * The second universal signal is weaker and is a proposal: two places whose
 * nearest points stand within the pair's reach and whose names reach a
 * trigram similarity of 0.5 on unaccented lower case — the Statue of Liberty
 * as a World Heritage site and as public art, Durham Cathedral beside the
 * site "Durham Castle and Cathedral", the National Gallery of Ireland 160 m
 * from the National Museum of Ireland. Which of the three they are — one
 * place, two places, or one part of the other — is a person's to give, and
 * an answered pair is kept so it is never proposed again.
 *
 * The reach is the place's (ADR-0046 decision 3): 300 m, and for a World
 * Heritage property the radius of a circle of its inscribed area up to 3 km,
 * since a mining landscape or a city wall is one place over kilometres; a pair
 * is found under the larger reach of its two places. No kind declares a reach
 * of its own yet.
 *
 * Left out, on purpose: a place that has parts or is one — a serial site is
 * never merged as a whole with one of its parts' twins (ADR-0100 decision 6),
 * and a part's twin is #1250's, once the merge moves the part relations; a
 * pair in one kind, which one place cannot hold twice (ADR-0086 decision 4),
 * reported with the pass so a person sees what the rule leaves apart; and a
 * place no reader sees yet, which has an arrival card of its own.
 *
 * The whole pass runs from the admin panel, after a rule changes. A place a
 * reader can newly see is paired by itself (#1800): after every real run, the
 * places it created (`proposeMergesOfRun`), and when a curator publishes an
 * arrival, that place (`proposeMergesOfPlaces`). Both are the whole pass's
 * statements, kept to the pairs that hold one of those places, so a pair is
 * never answered two ways.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, placeOfferedSql } from '../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';
import type { MergeProposalPass } from '../../api/responses/admin.js';

/** The reach every place has. */
export const BASE_REACH_M = 300;
/** The widest reach a property's area can give it. */
export const WIDEST_REACH_M = 3000;
/** Two places carrying one folded name this close are an exact pair, the ones a batch confirms. */
export const EXACT_DISTANCE_M = 50;
/** The trigram similarity two names must reach (ADR-0046 decision 2). */
export const MIN_SIMILARITY = 0.5;
/** The shortest word a name's words are compared by: shorter ones are articles and connectives. */
export const MIN_WORD_LENGTH = 3;

/**
 * The words a name is not compared by, because they say what kind of thing a
 * place is or connect its parts rather than which place it is (#1652): with
 * them, "Toledo Cathedral" would not stand inside "Historic City of Toledo",
 * nor "Mosque-Cathedral of Cordoba" inside "Historic Centre of Cordoba", though
 * each is a monument of the property its town names.
 * Each group is one reason:
 * - connectives and articles of the languages a name arrives in, over the
 *   length line: *and*, *with*, *the*, *del*, *und*, *von*, *los*;
 * - what a place is: a monument's kind (*cathedral*, *mosque*, *temple*,
 *   *monastery*, *palace*, *castle*, *museum*), and a site's (*complex*,
 *   *ensemble*, *remains*, *ruins*, *landscape*);
 * - what a World Heritage title adds around the place's name: *historic*,
 *   *centre*, *city*, *town*, *old*, *site*, *area*, *archaeological*,
 *   *national*, *park*;
 * - the saint's word of a church's name (*saint*, *san*, *santa*), which
 *   names its patron, never the place.
 * Folded as the names are: unaccented, lower case.
 */
export const GENERIC_NAME_WORDS: readonly string[] = [
  'and', 'with', 'the', 'its', 'for', 'from', 'del', 'des', 'der', 'die', 'das', 'den', 'und', 'von', 'van',
  'les', 'los', 'las', 'sur', 'dei', 'della', 'delle',
  'cathedral', 'basilica', 'church', 'churches', 'chapel', 'mosque', 'mosques', 'temple', 'temples', 'shrine',
  'monastery', 'monasteries', 'abbey', 'convent', 'palace', 'castle', 'fortress', 'fort', 'citadel', 'tower',
  'museum', 'museums', 'gallery', 'complex', 'ensemble', 'remains', 'ruins', 'landscape', 'cultural',
  'historic', 'historical', 'centre', 'center', 'city', 'town', 'old', 'site', 'sites', 'area', 'archaeological',
  'ancient', 'national', 'park', 'saint', 'san', 'santa', 'sant',
];

/** The generic words as a list of SQL literals: fixed words of this file, never input. */
const GENERIC_WORDS_SQL = GENERIC_NAME_WORDS.map(word => "'" + word + "'").join(', ');

/**
 * A name's words as the containment rule reads them: split on anything not a
 * letter or a digit, at `MIN_WORD_LENGTH` or longer, less `GENERIC_NAME_WORDS`.
 * `name` is a folded name (`foldedNamesSql`).
 */
function wordsSql(name: string): string {
  return `ARRAY(SELECT DISTINCT w FROM regexp_split_to_table(${name}, '[^[:alnum:]]+') AS w
                 WHERE length(w) >= ${MIN_WORD_LENGTH}
                   AND w <> ALL (ARRAY[${GENERIC_WORDS_SQL}]))`;
}

/**
 * Whether one of a place's names has every word of one of the other's (#1652):
 * "Geghard" within "Monastery of Geghard and the Upper Azat Valley", "Westminster
 * Abbey" within "Palace of Westminster and Westminster Abbey including Saint
 * Margaret's Church". A name left with no word after the generic ones are taken
 * out says nothing and matches nothing.
 */
function nameWithinSql(a: string, b: string): string {
  return `EXISTS (SELECT 1 FROM unnest(${a}) AS an, unnest(${b}) AS bn,
                  LATERAL (SELECT ${wordsSql('an')} AS wa, ${wordsSql('bn')} AS wb) AS words
                  WHERE cardinality(words.wa) > 0 AND cardinality(words.wb) > 0
                    AND (words.wa <@ words.wb OR words.wb <@ words.wa))`;
}

/**
 * A place's reach in metres: `BASE_REACH_M`, or the radius of a circle of its
 * inscribed area (`metadata.areaHectares`, a World Heritage row's) where that
 * is wider, up to `WIDEST_REACH_M`.
 */
export function reachSql(e = 'e'): string {
  return `GREATEST(${BASE_REACH_M}, LEAST(${WIDEST_REACH_M},
            sqrt(COALESCE((${e}.metadata->>'areaHectares')::numeric, 0) * 10000 / pi())))::int`;
}

/**
 * The names a place is known by, folded for comparison: its own name, each
 * source's view of it (`reported_name`) and its names in other languages
 * (`name_local`), unaccented and in lower case, as an array of distinct
 * strings.
 */
export function foldedNamesSql(e = 'e'): string {
  return `ARRAY(SELECT DISTINCT unaccent(lower(btrim(named.n)))
            FROM (SELECT ${e}.name AS n
                  UNION ALL SELECT rn.reported_name FROM ${MEMBERSHIPS} rn WHERE rn.experience_id = ${e}.id
                  UNION ALL SELECT loc.v FROM jsonb_each_text(
                    CASE WHEN jsonb_typeof(${e}.name_local) = 'object' THEN ${e}.name_local ELSE '{}'::jsonb END) AS loc(k, v)
                 ) named
           WHERE named.n IS NOT NULL AND btrim(named.n) <> '')`;
}

/**
 * The places a pair may be made of: offered to readers, not folded into
 * another, neither a whole of parts nor a part (ADR-0100), with the kinds
 * every membership gives them, their folded names and their reach.
 */
const PLACES_SQL = `
  SELECT e.id, e.name, ${reachSql('e')} AS reach_m, ${foldedNamesSql('e')} AS names,
         ARRAY(SELECT DISTINCT km.kind_id FROM ${MEMBERSHIPS} km WHERE km.experience_id = e.id) AS kind_ids
    FROM experiences e
   WHERE e.merged_into_id IS NULL
     AND ${placeOfferedSql('e')}
     AND NOT EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = e.id OR prt.part_id = e.id)`;

/**
 * The pairs within reach of each other, by their nearest offered points, with
 * the distance between those points: the prefilter in degrees first, served
 * by the points' spatial index — a degree of longitude shrinks with the
 * cosine of the latitude, near a pole the circle is drawn over the whole
 * world, and a point's twin across the antimeridian is tested too, as the
 * coverage report draws its reach — and the metre test on the geography
 * second. Both arms of the prefilter read the inner point's own column, so
 * the index answers either.
 */
const NEAR_SQL = `
  SELECT pa.place_id AS place_a, pb.place_id AS place_b,
         min(round(ST_Distance(pa.location::geography, pb.location::geography)))::int AS distance_m,
         GREATEST(pa.reach_m, pb.reach_m) AS reach_m
    FROM points pa
    JOIN points pb
      ON pa.place_id < pb.place_id
     AND (ST_DWithin(pb.location, pa.location, pa.degrees) OR ST_DWithin(pb.location, pa.twin, pa.degrees))
     AND ST_DWithin(pa.location::geography, pb.location::geography, GREATEST(pa.reach_m, pb.reach_m))
   GROUP BY pa.place_id, pb.place_id, GREATEST(pa.reach_m, pb.reach_m)`;

/**
 * Every pair the rule finds, one row each in id order: how far apart, how
 * alike, whether exact, under what reach, and whether the two share a kind.
 */
export function candidatePairsSql(): string {
  return `
  WITH places AS (${PLACES_SQL}
  ), points AS NOT MATERIALIZED (
    -- Inlined on purpose: a CTE read twice is materialized, and the self-join
    -- below then runs as a nested loop over every pair of points with no
    -- index; inlined, the inner side is an index probe (2.7 s against 0.5 s on
    -- the 8 527 offered points of 2026-10-17).
    SELECT p.id AS place_id, el.location, p.reach_m,
           CASE WHEN abs(ST_Y(el.location)) + ${WIDEST_REACH_M} / 111000.0 >= 84 THEN 360
                ELSE ${WIDEST_REACH_M} / 111000.0 / cos(radians(ST_Y(el.location))) * 1.1 END AS degrees,
           ST_Translate(el.location, CASE WHEN ST_X(el.location) >= 0 THEN -360 ELSE 360 END, 0) AS twin
      FROM places p
      JOIN experience_locations el ON el.experience_id = p.id
     WHERE ${offeredLocationSql('el')} AND ${publishedContentSql('el')}
  ), near AS (${NEAR_SQL}
  ), measured AS (
    SELECT n.place_a, n.place_b, n.distance_m, n.reach_m,
           (SELECT max(similarity(an, bn)) FROM unnest(a.names) AS an, unnest(b.names) AS bn)::real AS name_similarity,
           (n.distance_m <= ${EXACT_DISTANCE_M}
            AND EXISTS (SELECT 1 FROM unnest(a.names) AS an JOIN unnest(b.names) AS bn ON an = bn)) AS exact,
           a.kind_ids && b.kind_ids AS shared_kind,
           a.names AS a_names, b.names AS b_names
      FROM near n
      JOIN places a ON a.id = n.place_a
      JOIN places b ON b.id = n.place_b
  )
  SELECT m.place_a, m.place_b, m.distance_m, m.reach_m, m.name_similarity, m.exact, m.shared_kind,
         CASE WHEN m.name_similarity >= ${MIN_SIMILARITY} THEN 'similar' ELSE 'words' END AS found_by
    FROM measured m
   WHERE (m.name_similarity >= ${MIN_SIMILARITY} OR ${nameWithinSql('m.a_names', 'm.b_names')})
     -- Two places a curator separated are two places (ADR-0144): never proposed as one.
     AND NOT EXISTS (SELECT 1 FROM experience_separations sep
                      WHERE sep.undone_at IS NULL
                        AND ((sep.original_id = m.place_a AND sep.separated_id = m.place_b)
                          OR (sep.original_id = m.place_b AND sep.separated_id = m.place_a)))`;
}

/** A proposal as the pass and the check read it, with both places named. */
export const PROPOSAL_ROWS_SQL = `
  SELECT p.id, p.distance_m, p.name_similarity, p.exact, p.reach_m, p.found_by, p.proposed_at, p.answer,
         a.id AS a_id, a.name AS a_name, ${kindNamesSql('a')} AS a_kinds,
         b.id AS b_id, b.name AS b_name, ${kindNamesSql('b')} AS b_kinds
    FROM experience_merge_proposals p
    JOIN experiences a ON a.id = p.place_a
    JOIN experiences b ON b.id = p.place_b`;

/** The names of the kinds a place's memberships give it, in display order. */
function kindNamesSql(e: string): string {
  return `ARRAY(SELECT k.name FROM ${MEMBERSHIPS} km JOIN ${KINDS} k ON k.id = km.kind_id
                 WHERE km.experience_id = ${e}.id ORDER BY k.display_priority, k.id)`;
}

interface ProposalRow {
  id: number;
  distance_m: number;
  name_similarity: number;
  exact: boolean;
  reach_m: number;
  found_by: 'similar' | 'words';
  proposed_at: Date;
  a_id: number;
  a_name: string;
  a_kinds: string[];
  b_id: number;
  b_name: string;
  b_kinds: string[];
}

interface LeftApartRow {
  a_name: string;
  a_kinds: string[];
  b_name: string;
  b_kinds: string[];
  distance_m: number;
  name_similarity: number;
  found_by: 'similar' | 'words';
}

const placeOf = (row: ProposalRow, side: 'a' | 'b') => ({
  id: row[`${side}_id`], name: row[`${side}_name`], kinds: row[`${side}_kinds`],
});

/**
 * Find the pairs and write them, inside the caller's transaction: forget the
 * open proposals the rule no longer finds, propose the new ones and refresh the
 * measures of the open ones; an answered pair is left as it is, which is what
 * keeps a refused pair from coming back. `among` keeps the pass to the pairs
 * holding one of those places, and every other pair stands as it was. Leaves
 * what it found in the temporary table `found`, until the commit.
 */
async function writeProposals(client: PoolClient, among: readonly number[] | null): Promise<void> {
  const params = among === null ? [] : [among];
  const holdsOne = (row: string) => `(${row}.place_a = ANY($1::int[]) OR ${row}.place_b = ANY($1::int[]))`;
  // Every pair, then the ones kept: the same statement as the whole pass, which
  // reads the catalogue in a fraction of a second (0.18 s on the development
  // catalogue on 2026-10-21), so the two cannot measure a pair differently.
  await client.query(`CREATE TEMP TABLE found ON COMMIT DROP AS ${candidatePairsSql()}`);
  if (among !== null) await client.query(`DELETE FROM found f WHERE NOT ${holdsOne('f')}`, params);
  await client.query(
    `DELETE FROM experience_merge_proposals p
      WHERE p.answer IS NULL ${among === null ? '' : `AND ${holdsOne('p')}`}
        AND NOT EXISTS (SELECT 1 FROM found f WHERE f.place_a = p.place_a AND f.place_b = p.place_b AND NOT f.shared_kind)`,
    params,
  );
  await client.query(
    `INSERT INTO experience_merge_proposals AS p (place_a, place_b, distance_m, name_similarity, exact, reach_m, found_by)
     SELECT f.place_a, f.place_b, f.distance_m, f.name_similarity, f.exact, f.reach_m, f.found_by
       FROM found f
      WHERE NOT f.shared_kind
     ON CONFLICT (place_a, place_b) DO UPDATE
        SET distance_m = EXCLUDED.distance_m, name_similarity = EXCLUDED.name_similarity,
            exact = EXCLUDED.exact, reach_m = EXCLUDED.reach_m, found_by = EXCLUDED.found_by, proposed_at = NOW()
      WHERE p.answer IS NULL`,
  );
}

/**
 * The pass over the whole catalogue, from the admin panel (`writeProposals`).
 * Returns what is open afterwards, how many pairs have been answered and how,
 * and the pairs in one kind the rule left apart.
 */
export async function findMergeProposals(): Promise<MergeProposalPass> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeProposals(client, null);
    const leftApart = await client.query<LeftApartRow>(
      `SELECT a.name AS a_name, ${kindNamesSql('a')} AS a_kinds, b.name AS b_name, ${kindNamesSql('b')} AS b_kinds,
              f.distance_m, f.name_similarity, f.found_by
         FROM found f
         JOIN experiences a ON a.id = f.place_a
         JOIN experiences b ON b.id = f.place_b
        WHERE f.shared_kind
        ORDER BY f.name_similarity DESC, a.name`,
    );
    await client.query('COMMIT');
    const open = await pool.query<ProposalRow>(
      `${PROPOSAL_ROWS_SQL} WHERE p.answer IS NULL ORDER BY p.name_similarity DESC, p.distance_m, a.name`,
    );
    const answered = await pool.query<{ answer: 'one' | 'two' | 'part_of'; n: number }>(
      `SELECT p.answer, count(*)::int AS n FROM experience_merge_proposals p WHERE p.answer IS NOT NULL GROUP BY p.answer`,
    );
    const by = (answer: string) => answered.rows.find(row => row.answer === answer)?.n ?? 0;
    return {
      open: open.rows.map(row => ({
        id: row.id,
        placeA: placeOf(row, 'a'),
        placeB: placeOf(row, 'b'),
        distanceM: row.distance_m,
        nameSimilarity: row.name_similarity,
        exact: row.exact,
        reachM: row.reach_m,
        foundBy: row.found_by,
        proposedAt: row.proposed_at.toISOString(),
      })),
      foundBy: {
        similar: open.rows.filter(row => row.found_by === 'similar').length,
        words: open.rows.filter(row => row.found_by === 'words').length,
      },
      answered: { one: by('one'), two: by('two'), partOf: by('part_of') },
      leftApart: leftApart.rows.map(row => ({
        placeA: { name: row.a_name, kinds: row.a_kinds },
        placeB: { name: row.b_name, kinds: row.b_kinds },
        distanceM: row.distance_m,
        nameSimilarity: row.name_similarity,
        foundBy: row.found_by,
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The pass kept to the pairs that hold one of these places, for a place a reader
 * can newly see: a published arrival (#1800). A place no reader sees is in no
 * pair, so naming one changes nothing. Called once the place's own write has
 * committed, so a failure is logged and leaves the pair for the next pass, never
 * undoing what the caller wrote. Returns how many open pairs hold one of the
 * places afterwards, or null where the pass failed.
 */
export async function proposeMergesOfPlaces(placeIds: readonly number[]): Promise<number | null> {
  if (placeIds.length === 0) return 0;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await writeProposals(client, placeIds);
    // Counted inside the transaction, so a failure here rolls the pass back
    // rather than reporting a committed pass as failed.
    const open = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM experience_merge_proposals p
        WHERE p.answer IS NULL AND (p.place_a = ANY($1::int[]) OR p.place_b = ANY($1::int[]))`,
      [placeIds],
    );
    await client.query('COMMIT');
    return open.rows[0].n;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    console.error('[merge] pairing places %s with near places failed:', placeIds.join(', '), error);
    return null;
  } finally {
    client?.release();
  }
}

/**
 * The pass for the places a run created (#1800), read off its changeset after
 * the run's join (`joinPlacesClaimingOneItem`): a created place a merge has
 * since folded into another is paired as the place it is now part of.
 */
export async function proposeMergesOfRun(syncLogId: number): Promise<number | null> {
  try {
    const created = await pool.query<{ id: number }>(
      `SELECT DISTINCT COALESCE(e.merged_into_id, e.id) AS id
         FROM experience_sync_changes c
         JOIN experience_sync_logs run ON run.id = c.sync_log_id AND NOT run.is_dry_run
         JOIN ${MEMBERSHIPS} m ON m.source_id = run.source_id AND m.external_id = c.external_id
         JOIN experiences e ON e.id = m.experience_id
        WHERE c.sync_log_id = $1 AND c.change_type = 'created'`,
      [syncLogId],
    );
    return await proposeMergesOfPlaces(created.rows.map(row => row.id));
  } catch (error) {
    console.error('[merge] pairing the places run %d created failed:', syncLogId, error);
    return null;
  }
}
