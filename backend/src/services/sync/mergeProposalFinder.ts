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
 * A serial site's part is a place like any other (ADR-0100, #1250), offered
 * through its site, and is paired by the same rule: Svetitskhoveli Cathedral,
 * a part of the Historical Monuments of Mtskheta, 62 m from the Places of
 * worship row of the same name; the merge moves the part's relations onto the
 * place that stays. Left out, on purpose: a place that has parts — a serial
 * site is never merged as a whole with one of its parts' twins (ADR-0100
 * decision 6); a pair in one kind, which one place cannot hold twice (ADR-0086
 * decision 4), found and not proposed, two parts among them, since each holds
 * its record in World Heritage components (ADR-0156); and a place no reader
 * sees yet, which has an arrival card of its own.
 *
 * Nobody runs the pass (#1950). A trigger on every table the rule reads marks
 * a place whose inputs change (`mark_pairing_due()`), and the backend drains
 * the marks (`drainPairing`) after every real run, after a curator's publish
 * or override, at startup and every few minutes: the whole pass's statements,
 * kept to the pairs that hold a marked place, so a pair is never answered two
 * ways. A change of the rule raises `PAIRING_RULE_VERSION`, and the first
 * drain that finds the database's version different pairs the whole
 * catalogue.
 *
 * A proposal records which rule found it (`found_by`) and, for the words rule,
 * the words that matched (`matched_words`, #2194), so the card says the word
 * rather than "one name within the other", which overstates a match on a town's
 * name alone: on the development catalogue on 2026-10-31, 53 of the 56 open
 * pairs so found stood on one word both names carry — "Historic Centre (Old
 * Town) of Tallinn" beside "Freedom Square (Tallinn)".
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { KINDS, MEMBERSHIPS, kindIsRealSql } from '../../db/membership.js';
import { inscribedAreaSql } from '../../db/inscription.js';
import { offeredLocationSql, placeOrPartOfferedSql, publishedContentSql } from '../../db/readerPredicates.js';
import { partOfNameSql } from '../../db/placePoints.js';
import { BEST } from './subset/entities.js';

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
  // In the order the name says them, each once: what the card prints as the matched words (#2194).
  return `ARRAY(SELECT t.w FROM regexp_split_to_table(${name}, '[^[:alnum:]]+') WITH ORDINALITY AS t(w, n)
                 WHERE length(t.w) >= ${MIN_WORD_LENGTH}
                   AND t.w <> ALL (ARRAY[${GENERIC_WORDS_SQL}])
                 GROUP BY t.w ORDER BY min(t.n))`;
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
 * The words the containment stands on (#2194): the contained name's words,
 * the fewest over every pair of names that matches, so the card says what
 * matched rather than "one name within the other" — one word where a town's
 * name is all two names share ("tallinn", 53 of the 56 open pairs so found on
 * the development catalogue on 2026-10-31), several where a name stands whole
 * in a title ("westminster", "abbey"). Null where no pair of names matches.
 */
function matchedWordsSql(a: string, b: string): string {
  return `(SELECT CASE WHEN words.wa <@ words.wb THEN words.wa ELSE words.wb END
             FROM unnest(${a}) AS an, unnest(${b}) AS bn,
                  LATERAL (SELECT ${wordsSql('an')} AS wa, ${wordsSql('bn')} AS wb) AS words
            WHERE cardinality(words.wa) > 0 AND cardinality(words.wb) > 0
              AND (words.wa <@ words.wb OR words.wb <@ words.wa)
            ORDER BY cardinality(CASE WHEN words.wa <@ words.wb THEN words.wa ELSE words.wb END), 1
            LIMIT 1)`;
}

/**
 * A place's reach in metres: `BASE_REACH_M`, or the radius of a circle of its
 * inscribed area (`inscribedAreaSql`, its World Heritage membership's) where
 * that is wider, up to `WIDEST_REACH_M`.
 */
export function reachSql(e = 'e'): string {
  return `GREATEST(${BASE_REACH_M}, LEAST(${WIDEST_REACH_M},
            sqrt(COALESCE(${inscribedAreaSql(e)}, 0) * 10000 / pi())))::int`;
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
 * The places a pair may be made of: offered to readers, a serial site's part
 * through its site, not folded into another and no whole of parts (ADR-0100),
 * with the kinds every membership gives them, their folded names and their
 * reach.
 */
const PLACES_SQL = `
  SELECT e.id, e.name, ${reachSql('e')} AS reach_m, ${foldedNamesSql('e')} AS names,
         ARRAY(SELECT DISTINCT km.kind_id FROM ${MEMBERSHIPS} km WHERE km.experience_id = e.id) AS kind_ids
    FROM experiences e
   WHERE e.merged_into_id IS NULL
     AND ${placeOrPartOfferedSql('e')}
     AND NOT EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = e.id)`;

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
         CASE WHEN m.name_similarity >= ${MIN_SIMILARITY} THEN 'similar' ELSE 'words' END AS found_by,
         CASE WHEN m.name_similarity >= ${MIN_SIMILARITY} THEN NULL ELSE ${matchedWordsSql('m.a_names', 'm.b_names')} END AS matched_words
    FROM measured m
   WHERE (m.name_similarity >= ${MIN_SIMILARITY} OR ${nameWithinSql('m.a_names', 'm.b_names')})
     -- Two places a curator separated are two places (ADR-0144): never proposed as one.
     AND NOT EXISTS (SELECT 1 FROM experience_separations sep
                      WHERE sep.undone_at IS NULL
                        AND ((sep.original_id = m.place_a AND sep.separated_id = m.place_b)
                          OR (sep.original_id = m.place_b AND sep.separated_id = m.place_a)))`;
}

/** A proposal as the check lists it, with both places named; the drain writes these rows (`writeProposals`). */
export const PROPOSAL_ROWS_SQL = `
  SELECT p.id, p.distance_m, p.name_similarity, p.exact, p.reach_m, p.found_by, p.matched_words, p.proposed_at, p.answer,
         a.id AS a_id, a.name AS a_name, ${kindNamesSql('a')} AS a_kinds, ${partOfNameSql('a.id')} AS a_part_of,
         b.id AS b_id, b.name AS b_name, ${kindNamesSql('b')} AS b_kinds, ${partOfNameSql('b.id')} AS b_part_of
    FROM experience_merge_proposals p
    JOIN experiences a ON a.id = p.place_a
    JOIN experiences b ON b.id = p.place_b`;

/** The names of the kinds a place's memberships give it, in display order. */
function kindNamesSql(e: string): string {
  return `ARRAY(SELECT k.name FROM ${MEMBERSHIPS} km JOIN ${KINDS} k ON k.id = km.kind_id AND ${kindIsRealSql('k')}
                 WHERE km.experience_id = ${e}.id ORDER BY k.display_priority, k.id)`;
}

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
    `INSERT INTO experience_merge_proposals AS p (place_a, place_b, distance_m, name_similarity, exact, reach_m, found_by, matched_words)
     SELECT f.place_a, f.place_b, f.distance_m, f.name_similarity, f.exact, f.reach_m, f.found_by, f.matched_words
       FROM found f
      WHERE NOT f.shared_kind
     ON CONFLICT (place_a, place_b) DO UPDATE
        SET distance_m = EXCLUDED.distance_m, name_similarity = EXCLUDED.name_similarity,
            exact = EXCLUDED.exact, reach_m = EXCLUDED.reach_m, found_by = EXCLUDED.found_by,
            matched_words = EXCLUDED.matched_words, proposed_at = NOW()
      WHERE p.answer IS NULL`,
  );
}

/**
 * The open pairs Wikidata answers, with the part it names and the statement
 * that names it (#1991, ADR-0150): one place's item states P361 "part of"
 * toward the other's, or the other's states P527 "has part" toward it, read
 * on each place's items that claim its identity (`place_identifiers`) and on
 * the local subset's best statements. A pair whose statements name both places
 * as the part is asked, as is one with only P276 "location", one with none,
 * one a curator took back, and every pair where the subset is absent. P361 is
 * the statement recorded where both state the one relation.
 */
function wikidataPartsSql(scope: string): string {
  return `
  WITH items AS (
    SELECT pi.experience_id AS place, pi.value AS item
      FROM place_identifiers pi
     WHERE pi.scheme = 'wikidata' AND pi.claims_identity
  ), statements AS (
    SELECT p.id, part.place AS part_id,
           jsonb_build_object('property', c.property, 'subject', c.subject, 'value', c.value_item) AS statement
      FROM experience_merge_proposals p
      JOIN items part ON part.place IN (p.place_a, p.place_b)
      JOIN items whole ON whole.place IN (p.place_a, p.place_b) AND whole.place <> part.place
      JOIN wikidata_claims c
        ON (c.property = 'P361' AND c.subject = part.item AND c.value_item = whole.item)
        OR (c.property = 'P527' AND c.subject = whole.item AND c.value_item = part.item)
     WHERE p.answer IS NULL AND p.taken_back_at IS NULL AND ${scope}
       AND c.rank >= 0 AND ${BEST('c')}
  )
  SELECT s.id, min(s.part_id) AS part_id,
         (array_agg(s.statement ORDER BY s.statement->>'property', s.statement->>'subject', s.statement->>'value'))[1] AS statement
    FROM statements s
   GROUP BY s.id
  HAVING count(DISTINCT s.part_id) = 1`;
}

/**
 * Answer "part of" every open pair Wikidata answers (`wikidataPartsSql`),
 * inside the drain's transaction, each with its row in the curation history
 * naming no curator. A pair a curator is answering at that moment holds its
 * advisory lock (`answerOnePair`) and is left for the curator. Answers how
 * many pairs it answered.
 */
async function answerFromWikidata(client: PoolClient, among: readonly number[] | null): Promise<number> {
  const scope = among === null ? 'true' : '(p.place_a = ANY($1::int[]) OR p.place_b = ANY($1::int[]))';
  const result = await client.query(
    `WITH answered AS (
       UPDATE experience_merge_proposals p
          SET answer = 'part_of', part_id = d.part_id, answered_by = NULL, answered_at = NOW(),
              answered_by_catalogue = true, answer_statement = d.statement
         FROM (${wikidataPartsSql(scope)}) d
        WHERE p.id = d.id AND p.answer IS NULL
          AND pg_try_advisory_xact_lock(hashtext('merge_proposal:' || p.id))
        RETURNING p.id, p.place_a, p.place_b, p.part_id, p.answer_statement
     )
     INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
     SELECT a.place_a, NULL, 'merge_proposal_answered', NULL,
            jsonb_build_object('proposalId', a.id, 'otherId', a.place_b, 'otherName', b.name, 'answer', 'part_of',
                               'partId', a.part_id, 'catalogue', 'wikidata', 'statement', a.answer_statement)
       FROM answered a
       JOIN experiences b ON b.id = a.place_b`,
    among === null ? [] : [among],
  );
  return result.rowCount ?? 0;
}

/**
 * The version of the rule above. Raise it with any change to what pairs two
 * places — a reach, a threshold, a word list, a name the rule reads — and the
 * next drain pairs the whole catalogue under the new rule by itself: the
 * database records the version its proposals were found under
 * (`experience_pairing_rule`). 1 is the trigram rule of #1249; 2 adds one
 * name's words standing in the other's (ADR-0120); 3 answers "part of"
 * from Wikidata (ADR-0150); 4 pairs a serial site's part like any place
 * (#1250); 5 records the words a containment stands on (#2194), which pairs
 * nothing new and fills `matched_words` on every open pair.
 */
export const PAIRING_RULE_VERSION = 5;

/**
 * What one drain did: how many marked places it paired again, whether it ran
 * over the whole catalogue, how many pairs it left open among them, and how
 * many it answered "part of" from Wikidata.
 */
export interface PairingDrain {
  places: number;
  wholeCatalogue: boolean;
  open: number;
  fromWikidata: number;
}

/**
 * Pair again every place whose pairing inputs changed since the last drain
 * (#1950): the places `mark_pairing_due()` marked — a renamed place, a moved
 * point, a refusal taken back, a pin that admits a place, a publish, a part
 * added, a merge or its undo, a separation — through the one statement the
 * whole pass uses (`writeProposals`), so the narrowed and the whole pass never
 * measure a pair differently. When the database's rule version differs from
 * `PAIRING_RULE_VERSION` it is the whole pass, and the version is recorded.
 *
 * One drain at a time: the rule's row is held for the drain's transaction. A
 * mark a writer still holds uncommitted is skipped and stays for the next
 * drain, which pairs the place as that writer left it. A failure rolls the
 * marks back and is logged, never undoing what the caller wrote; it returns
 * null.
 */
export async function drainPairing(): Promise<PairingDrain | null> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const rule = await client.query<{ rule_version: number }>(
      'SELECT rule_version FROM experience_pairing_rule FOR UPDATE',
    );
    const wholeCatalogue = rule.rows[0]?.rule_version !== PAIRING_RULE_VERSION;
    const marked = await client.query<{ experience_id: number }>(
      `DELETE FROM experience_pairing_due d
        WHERE d.experience_id IN (SELECT experience_id FROM experience_pairing_due FOR UPDATE SKIP LOCKED)
       RETURNING d.experience_id`,
    );
    // A part is paired while its whole is offered (`placeOrPartOfferedSql`, any
    // relation), so a whole marked for a change of its own state is paired with
    // its parts: published, refused or taken back, the whole itself is in no
    // pair (#1250).
    const parts = await client.query<{ part_id: number }>(
      `SELECT DISTINCT part_id FROM experience_parts WHERE whole_id = ANY($1::int[])`,
      [marked.rows.map(row => row.experience_id)],
    );
    const places = [...new Set([...marked.rows.map(row => row.experience_id), ...parts.rows.map(row => row.part_id)])];
    if (!wholeCatalogue && places.length === 0) {
      await client.query('COMMIT');
      return { places: 0, wholeCatalogue, open: 0, fromWikidata: 0 };
    }
    await writeProposals(client, wholeCatalogue ? null : places);
    const fromWikidata = await answerFromWikidata(client, wholeCatalogue ? null : places);
    if (wholeCatalogue) {
      await client.query('UPDATE experience_pairing_rule SET rule_version = $1', [PAIRING_RULE_VERSION]);
    }
    // Counted inside the transaction, so a failure here rolls the drain back
    // rather than reporting a committed drain as failed.
    const open = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM experience_merge_proposals p
        WHERE p.answer IS NULL AND ($1::boolean OR p.place_a = ANY($2::int[]) OR p.place_b = ANY($2::int[]))`,
      [wholeCatalogue, places],
    );
    await client.query('COMMIT');
    return { places: places.length, wholeCatalogue, open: open.rows[0].n, fromWikidata };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    console.error('[merge] pairing the changed places with near places failed:', error);
    return null;
  } finally {
    client?.release();
  }
}

/** A drain in words, for a run's closing line and the server log. */
export function pairingSentence(drain: PairingDrain | null): string {
  if (drain === null) return 'the pairing of near places failed; the server log has the cause';
  const answered = drain.fromWikidata === 0 ? ''
    : `, ${drain.fromWikidata} answered part of from Wikidata`;
  const open = `${drain.open} near pair${drain.open === 1 ? '' : 's'} open${answered}`;
  if (drain.wholeCatalogue) return `the whole catalogue paired again under the pairing rule's new version, ${open}`;
  if (drain.places === 0) return 'no place changed what pairs it with near places';
  return `${drain.places} changed place${drain.places === 1 ? '' : 's'} paired again with near places, ${open} among them`;
}
