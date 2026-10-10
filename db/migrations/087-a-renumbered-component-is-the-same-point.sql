-- 087-a-renumbered-component-is-the-same-point.sql
--
-- A component the list renumbered at an extension (829bis-001 -> 829ter-001)
-- is the same point where the geometry says so (ADR-0090). Two things for a
-- database that already holds data: the SQL statement of a reference without
-- its variant, which the pairing reads from now on, and the fold of the pairs
-- the old rule left standing - a visible row under the old numbering and a
-- pending arrival under the new one at the same place. The pairs are found by
-- place and bare reference within one experience, not through the arrival's
-- deferral pointer: that pointer pairs withdrawals to arrivals by position in
-- the source's list, so Herculaneum's arrival holds Pompeii's withdrawal
-- (measured 2026-10-10, 13 km apart). The old row takes the new reference and
-- the arrival's ordinal; the arrival is withdrawn as an unread point is,
-- marked and never deleted (ADR-0022), its deferral cleared. One arrival per
-- old row and one old row per arrival, the nearer first. A surviving arrival
-- that held a kept row takes over what the folded arrival of that row held,
-- so no published arrival withdraws a kept row and no moved row is left
-- without the arrival that holds it.
--
-- Order-independent with 01-schema.sql, which declares the same function.
-- Re-runnable: a pair folded once no longer matches the join.
BEGIN;

CREATE OR REPLACE FUNCTION whc_ref_bare(ref TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    SELECT regexp_replace(regexp_replace(lower(btrim(ref)), '\s+', ' ', 'g'), '^(\d+)[a-z]+', '\1')
$$;

CREATE TEMP TABLE renumbered_pair ON COMMIT DROP AS
WITH candidate AS (
    SELECT n.id AS arrival_id, o.id AS kept_id, n.external_ref AS new_ref, n.ordinal AS new_ordinal,
           ST_Distance(n.location::geography, o.location::geography) AS metres
      FROM experience_locations n
      JOIN experience_locations o
        ON o.experience_id = n.experience_id
       AND o.id <> n.id
       AND o.missing_since IS NULL
       AND o.curation_state <> 'pending'
       AND o.external_ref IS NOT NULL
       AND o.external_ref <> n.external_ref
       AND whc_ref_bare(o.external_ref) = whc_ref_bare(n.external_ref)
       AND ST_DWithin(n.location::geography, o.location::geography, 10)
     WHERE n.curation_state = 'pending'
       AND n.missing_since IS NULL
       AND n.external_ref IS NOT NULL
),
by_arrival AS (
    SELECT DISTINCT ON (arrival_id) * FROM candidate ORDER BY arrival_id, metres, kept_id
)
SELECT DISTINCT ON (kept_id) * FROM by_arrival ORDER BY kept_id, metres, arrival_id;

-- What each folded arrival was holding, before the fold clears it: the
-- pointer pairs by position, so it may be another row than the one the fold
-- keeps for it, and that row still needs an arrival to hold it.
CREATE TEMP TABLE released_pointer ON COMMIT DROP AS
SELECT p.kept_id, n.withdrawal_deferred_for_location_id AS target
  FROM renumbered_pair p
  JOIN experience_locations n ON n.id = p.arrival_id;

-- The surviving arrivals that hold a row the fold keeps: the kept row is the
-- current point now and must not be withdrawn when that arrival is published.
-- Each takes over what the folded arrival of its row was holding, following
-- the chain where that is itself a kept row, so the matching between
-- surviving arrivals and visible old rows stays one-to-one; one whose chain
-- ends nowhere holds nothing.
CREATE TEMP TABLE repointed ON COMMIT DROP AS
WITH RECURSIVE walk(arrival_id, target, depth) AS (
    SELECT m.id, m.withdrawal_deferred_for_location_id, 0
      FROM experience_locations m
     WHERE m.withdrawal_deferred_for_location_id IN (SELECT kept_id FROM renumbered_pair)
       AND m.id NOT IN (SELECT arrival_id FROM renumbered_pair)
    UNION ALL
    SELECT w.arrival_id, r.target, w.depth + 1
      FROM walk w
      JOIN released_pointer r ON r.kept_id = w.target
     WHERE w.depth < 1000
)
SELECT a.arrival_id,
       (SELECT w.target FROM walk w
         WHERE w.arrival_id = a.arrival_id
           AND (w.target IS NULL OR w.target NOT IN (SELECT kept_id FROM renumbered_pair))
         ORDER BY w.depth LIMIT 1) AS target
  FROM (SELECT DISTINCT arrival_id FROM walk) a;

UPDATE experience_locations o
   SET external_ref = p.new_ref, ordinal = p.new_ordinal
  FROM renumbered_pair p
 WHERE o.id = p.kept_id;

UPDATE experience_locations n
   SET missing_since = NOW(), ordinal = NULL, withdrawal_deferred_for_location_id = NULL
  FROM renumbered_pair p
 WHERE n.id = p.arrival_id;

UPDATE experience_locations m
   SET withdrawal_deferred_for_location_id = r.target
  FROM repointed r
 WHERE m.id = r.arrival_id;

DO $$
BEGIN
  RAISE NOTICE 'renumbered components folded: %, arrivals re-pointed: % (of them holding nothing now: %)',
    (SELECT count(*) FROM renumbered_pair),
    (SELECT count(*) FROM repointed),
    (SELECT count(*) FROM repointed WHERE target IS NULL);
END $$;

COMMIT;
