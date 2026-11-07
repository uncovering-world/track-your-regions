-- 217-a-crowded-places-better-known-neighbours-are-listed-by-the-rule.sql
--
-- The curator's window over a crowded city lists, for a place it opens, the
-- better-known places it is compared with (#2358): the places of its kind and
-- type within the radius that count above it (ADR-0183). crowding_better() counted them
-- and named none, so the list would have been a second statement of the rule.
-- crowding_above() now names them, and crowding_better() counts what it names,
-- so the list and the count are one rule.
--
-- Both stay set-returning SQL functions, which the planner inlines, the inner
-- one through the outer: the recount's lateral join is planned as if the
-- predicate were spelled there, as before (an EXPLAIN on the development
-- catalogue, 2026-11-04, shows no function scan).
--
-- Order-independent with 01-schema.sql, which declares the same objects, and
-- after 213, whose pins the predicate reads. Re-runnable: both functions are
-- replaced, the new one first, with the signatures they had.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION crowding_above(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (membership_id integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT d.id
    FROM experience_kind_memberships d
    JOIN experiences de ON de.id = d.experience_id
    LEFT JOIN membership_fame df ON df.membership_id = d.id
   WHERE d.kind_id = of_kind AND d.type IS NOT DISTINCT FROM of_type AND d.id <> of_member
     AND de.location && crowding_box(at_point, within_km)
     AND ST_DWithin(de.location::geography, at_point::geography, within_km * 1000)
     AND d.admission <> 'refused' AND de.existence <> 'lost'
     AND d.crowding_pin IS DISTINCT FROM 'shadow'
     AND (d.crowding_pin = 'list' OR df.score > above_score)
     AND NOT place_shows_works(de.id)
$$;

CREATE OR REPLACE FUNCTION crowding_better(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (better integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT count(*)::int FROM crowding_above(of_kind, of_type, of_member, at_point, within_km, above_score)
$$;

COMMIT;
