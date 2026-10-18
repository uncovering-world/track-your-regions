-- 123-a-point-added-again-after-a-merge-is-folded.sql
--
-- After a merge, the folded place's source did not recognise its own point on
-- its next run (#1662). The point had been folded into the other place's point
-- (ADR-0088 decision 3) and the run never read it, so the run added the point
-- to the place again. On the development catalogue on 2026-10-18 that left
-- 192 such points on 191 places. 191 of them were arrivals waiting for a
-- curator, among them the Mogao Caves' Archaeology point 10.7 km from the
-- kept one. Publishing them would have shown each place as two pins.
--
-- Each such point is folded into the point its twin was folded into, as
-- foldPoints folds one: its placements move onto the kept point, a
-- traveller's visit is reconciled onto that point's (the earlier date, both
-- notes), and the point is marked merged_into_id. Its region rows go too:
-- the place keeps the kept point's regions, and the next placement derives
-- the place's own from the points a reader sees. It loses its position in the
-- list and any withdrawal it waits on. It is not marked as no longer listed:
-- that would make it a withdrawal for a curator to answer, about a point no
-- reader sees. It stays inert all the same. The run pairs only a folded point
-- whose merge recorded the run's own placement on it, and no merge recorded
-- this one, so its twin is the point the source's runs pair with.
--
-- A point added again is one standing on its own on the place a point a
-- reader sees belongs to, with the reference of a point folded into that one,
-- directly or down a chain of merges, and not that point itself, placed only
-- by memberships the merges recorded as its folded twins'. The dry run of
-- 2026-10-18 folds 189 of the 192, one on each of 189 places; the Ajanta
-- Caves' point, which Archaeology and Places of worship both placed, folds
-- because each has a folded twin there. Of the other three, the Osun-Osogbo
-- point is placed by no membership, and the Cave of Altamira's and the Temple
-- of Baalshamin's are placed by another source reading the same Wikidata item
-- as well, which has no twin there. Such a point is that source's own and
-- stays: only the twin's own source's placement moves off it onto the kept
-- point, where the twin answers for that source.
--
-- Re-runnable: a point it folded is no longer standing on its own.

\set ON_ERROR_STOP on

BEGIN;

-- Every standing point under the reference of a point folded into a kept
-- one on its place, with its placements told apart: by the membership the
-- merge recorded as the folded twin's (the twin's own source), or by another.
CREATE TEMP TABLE same_reference ON COMMIT DROP AS
WITH RECURSIVE folded (id, kept_id, external_ref) AS (
  SELECT f.id, kept.id, f.external_ref FROM experience_locations kept
    JOIN experience_locations f ON f.merged_into_id = kept.id
   WHERE kept.merged_into_id IS NULL
  UNION
  SELECT f.id, folded.kept_id, f.external_ref FROM folded
    JOIN experience_locations f ON f.merged_into_id = folded.id
),
candidate AS (
  SELECT s.id AS point, kept.id AS target, folded.id AS twin
    FROM folded
    JOIN experience_locations kept ON kept.id = folded.kept_id
    JOIN experience_locations s ON s.experience_id = kept.experience_id AND s.external_ref = folded.external_ref
                               AND s.id <> kept.id AND s.merged_into_id IS NULL
)
SELECT c.point, min(c.target) AS target, p.membership_id,
       bool_or(EXISTS (SELECT 1 FROM experience_merges mg
                        CROSS JOIN jsonb_array_elements(mg.moved->'foldedPoints'->'removed') placed
                        WHERE mg.undone_at IS NULL AND (placed->>'location')::int = c.twin
                          AND (placed->>'membership')::int = p.membership_id)) AS twins_own
  FROM candidate c JOIN experience_location_placements p ON p.location_id = c.point
 GROUP BY c.point, p.membership_id;

-- A source with a folded twin there added it again: every placement on it is
-- such a source's.
CREATE TEMP TABLE added_again ON COMMIT DROP AS
SELECT point, min(target) AS target FROM same_reference GROUP BY point HAVING bool_and(twins_own);

-- A point another source reading the same item places as well (the Cave of
-- Altamira's) is that source's own and stays. The twin's own
-- source's placement on it moves onto the kept point, where its folded twin
-- answers for it, so that source's run pairs the twin alone.
INSERT INTO experience_location_placements (location_id, membership_id)
SELECT r.target, r.membership_id FROM same_reference r
 WHERE r.twins_own AND r.point NOT IN (SELECT point FROM added_again)
ON CONFLICT DO NOTHING;
DELETE FROM experience_location_placements p USING same_reference r
 WHERE p.location_id = r.point AND p.membership_id = r.membership_id
   AND r.twins_own AND r.point NOT IN (SELECT point FROM added_again);

INSERT INTO experience_location_placements (location_id, membership_id)
SELECT a.target, p.membership_id
  FROM added_again a JOIN experience_location_placements p ON p.location_id = a.point
ON CONFLICT DO NOTHING;
DELETE FROM experience_location_placements p USING added_again a WHERE p.location_id = a.point;

-- A traveller's visits to the points folded into one kept point, one per
-- traveller: the earliest date and every note.
CREATE TEMP TABLE visits_again ON COMMIT DROP AS
SELECT a.target, v.user_id, min(v.visited_at) AS visited_at,
       string_agg(DISTINCT NULLIF(v.notes, ''), E'\n\n') AS notes
  FROM added_again a JOIN user_visited_locations v ON v.location_id = a.point
 GROUP BY a.target, v.user_id;
UPDATE user_visited_locations kept
   SET visited_at = LEAST(kept.visited_at, again.visited_at),
       notes = CASE WHEN again.notes IS NULL OR again.notes = kept.notes THEN kept.notes
                    WHEN COALESCE(kept.notes, '') = '' THEN again.notes
                    ELSE kept.notes || E'\n\n' || again.notes END
  FROM visits_again again
 WHERE kept.location_id = again.target AND kept.user_id = again.user_id;
INSERT INTO user_visited_locations (user_id, location_id, visited_at, notes)
SELECT again.user_id, again.target, again.visited_at, again.notes FROM visits_again again
 WHERE NOT EXISTS (SELECT 1 FROM user_visited_locations kept
                    WHERE kept.location_id = again.target AND kept.user_id = again.user_id);
DELETE FROM user_visited_locations v USING added_again a WHERE v.location_id = a.point;

DELETE FROM experience_location_regions r USING added_again a WHERE r.location_id = a.point;

UPDATE experience_locations el
   SET merged_into_id = a.target, ordinal = NULL, withdrawal_deferred_for_location_id = NULL
  FROM added_again a WHERE el.id = a.point;
UPDATE experience_locations el SET withdrawal_deferred_for_location_id = NULL
  FROM added_again a WHERE el.withdrawal_deferred_for_location_id = a.point;

COMMIT;
