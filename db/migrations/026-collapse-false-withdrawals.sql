-- Collapse the withdrawals an exact-geometry match wrote for points that never moved.
--
-- Until ADR-0027 the location writer decided a stored point was the one the source
-- offers by comparing the geometry exactly, so a coordinate rewritten in its last
-- float digits was a different place: the stored row was marked missing_since, a row
-- was inserted beside it, and the pin left every reader-facing read. This file repairs
-- what that already wrote. The writer no longer does it.
--
-- Written as a rule and not as a pair of ids. Bilbao Fine Arts Museum (Q127064) is the
-- one instance on the database this was authored against -- rows 13211 and 13398, 1.2 cm
-- apart -- but 1642 of 6680 stored points sit on a coordinate rounded to six decimals,
-- which is what the World Heritage list's degrees-minutes-seconds become, so any
-- database this lands on may hold others written between then and now.
--
-- What it repairs: a marked row and an offered row under the same experience and the
-- same reference, within ten metres of each other -- the same tolerance the writer now
-- uses, from LOCATION_UNCHANGED_METERS. Inside a reference that number is safe by five
-- orders of magnitude: the nine references holding more than one point are Bilbao at
-- 0.012 m and eight extended properties whose parts are 14 km apart or more (Waterton
-- Glacier across the US-Canada border, W-Arly-Pendjari across three, the historic centre
-- of Mexico City and Xochimilco within one country).
--
-- Which row survives depends on the shape, and the two are opposite -- see the block
-- above the query. Marked: the offered row survives, carrying the ordinal and the region
-- assignments the marked one lost when it was marked. Held: the row a reader can see
-- survives and takes its ordinal back, and the pending arrival is what goes.
--
-- Deletion rather than marking, against ADR-0022's rule, and only where that rule has
-- nothing to protect -- which is a different test on each shape, so it is stated as two.
-- Marked: no visit record and no experience_location_regions row on the row being removed,
-- both measured. Held: no visit record, measured; the region rows are spent knowingly,
-- because placement keys on missing_since rather than curation_state, so a held arrival
-- does carry `auto` placements and the delete cascades them. Where a traveller's visit
-- hangs off the row either way, the pair is left standing and reported -- re-pointing a
-- visit at another row by migration would be a second guess about which place a person
-- went to, and that belongs to a curator.
--
-- The verdict a curator recorded on such a row goes with the row. On the survivor
-- source_membership and existence stay at their defaults, so the point is undecided
-- because there is nothing to decide. The audit trail keeps its entry: a person did
-- answer, and the trail records what people did. What it recorded is an answer to a
-- question the product should never have asked.
--
-- The run's changeset keeps its bogus added-and-withdrawn pair for the same reason
-- (ADR-0026): it records what a run did, and the run did do that. Rewriting the record of
-- a past run to match what it should have done leaves nothing able to explain the verdict
-- in the audit trail beside it.
--
-- Order: this file may run before or after the next re-application of 01-schema.sql, in
-- either order and any number of times. It is a repair of data rather than a change of
-- shape, so 01-schema.sql carries nothing from it, and a second application finds
-- nothing left to collapse -- the pairs it fixes stop matching once fixed.
--
-- Order against the *code* is not a deadline, and it took three reviews to say why without
-- claiming more than is true. While the source still offers the component, a run leaves both
-- shapes as it found them. Marked: the marked row is not offered, so no arm touches it. Held:
-- the arrival sits on the source's own coordinate and wins the pairing at nought metres, the
-- held row is passed over because an arrival waits on it, and the pointer this file keys on
-- survives. Neither shape repairs itself, so applying this first buys something real: a
-- curator's queue and a reader's map spend fewer runs disagreeing about one catalogue.
--
-- What a run *can* take out of reach is a held pair whose component the source drops -- the
-- arrival is marked and its pointer goes with it, and the note under the second arm follows
-- that through. It costs one extra withdrawal card for one run and settles correctly, which
-- is why this is advice about when to apply rather than a condition on applying.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/026-collapse-false-withdrawals.sql

\set ON_ERROR_STOP on

BEGIN;

-- The pairs, and which side of each survives.
-- Two shapes, and they are repaired in opposite directions.
--
-- **Marked** (ungated source): the old row carries missing_since, the replacement is
-- offered and holds the ordinal and the region rows. The old row is the ghost.
--
-- **Held** (gated source, which is UNESCO and therefore all 1642 rounded coordinates):
-- the old row is never marked at all. The writer passes it over while an arrival waits
-- on it and only nulls its ordinal, so the pair is two rows with missing_since IS NULL
-- -- and the *old* one is the row a reader can see, while the arrival is pending and
-- invisible until somebody publishes it. Deleting by "has no ordinal" would take the
-- only visible pin off the map and leave the object listed with nothing on it, which is
-- the failure ADR-0025's deferral exists to prevent. So here the ghost is the arrival:
-- the run had nothing to arrive about.
CREATE TEMP TABLE false_withdrawals ON COMMIT DROP AS
-- Marked: drop the marked row, the offered one already has everything.
SELECT 'marked'::text AS shape,
       ghost.id AS ghost_id,
       survivor.id AS survivor_id,
       NULL::int AS restore_ordinal,
       ghost.experience_id,
       ghost.external_ref,
       ST_Distance(ghost.location::geography, survivor.location::geography) AS metres,
       EXISTS (SELECT 1 FROM user_visited_locations v WHERE v.location_id = ghost.id) AS visited,
       EXISTS (SELECT 1 FROM experience_location_regions r WHERE r.location_id = ghost.id) AS placed
FROM experience_locations ghost
JOIN experience_locations survivor
  ON survivor.experience_id = ghost.experience_id
 AND survivor.id <> ghost.id
 AND survivor.missing_since IS NULL
 AND survivor.ordinal IS NOT NULL
 AND survivor.external_ref IS NOT DISTINCT FROM ghost.external_ref
 AND ghost.external_ref IS NOT NULL
 AND ST_DWithin(ghost.location::geography, survivor.location::geography, 10)
WHERE ghost.missing_since IS NOT NULL

UNION ALL

-- Held: drop the arrival and give the visible row its place back. The arrival names the
-- row it was going to replace, which is what makes the pair unambiguous here rather than
-- a guess. `placed` is FALSE by decision rather than by measurement: placement keys on
-- missing_since and not on curation_state, so a held arrival does carry `auto` region
-- rows and the delete cascades them -- and that is accepted, because they are
-- recomputable by the next placement run and the row they belong to was on no
-- reader-facing read. A visit cannot exist on it for the same invisibility, and is still
-- checked rather than assumed.
--
-- No `curation_state` filter, and the pointer is what makes one unnecessary rather than
-- merely absent: publishing the arrival releases the withdrawal through that very pointer,
-- so `held.missing_since IS NULL` above stops matching the moment the arrival stops being
-- pending. An arm keyed on anything weaker than the pointer would need to say `pending`
-- out loud -- see the note below this statement.
SELECT 'held'::text,
       arrival.id,
       held.id,
       arrival.ordinal,
       held.experience_id,
       held.external_ref,
       ST_Distance(held.location::geography, arrival.location::geography),
       EXISTS (SELECT 1 FROM user_visited_locations v WHERE v.location_id = arrival.id),
       FALSE
FROM experience_locations arrival
JOIN experience_locations held
  ON held.id = arrival.withdrawal_deferred_for_location_id
 AND held.experience_id = arrival.experience_id
WHERE arrival.missing_since IS NULL
  AND held.missing_since IS NULL
  AND arrival.external_ref IS NOT NULL
  AND arrival.external_ref IS NOT DISTINCT FROM held.external_ref
  AND ST_DWithin(held.location::geography, arrival.location::geography, 10);

-- Two arms, not three. A round of this branch carried a third that recognised the held
-- shape by its ordinals rather than by the pointer, for the case of a pointer some earlier
-- run had cleared. It is gone because a proxy for a shape is not the shape: the ordinals it
-- keyed on are also worn by a pair this file was never told about -- a held row beside a
-- *nearer offered* row that took the pairing -- and there the arm deleted the point the
-- source is actually offering and handed its place back to the rounded coordinate.
--
-- Not because a pointer-less held row is unreachable. It is reachable, and by a route worth
-- writing down: the withdrawal arm clears the pairing on the row it marks, so when a source
-- drops a held component entirely, the arrival is marked and its pointer at the held row goes
-- with it in the same statement. What that cannot produce is the pair the arm needed -- a
-- pointer-less held row beside a *live* arrival -- because the only row whose pointer that arm
-- clears is the one it is marking. So the shape stayed unreachable while the sentence
-- explaining why was wrong, which is its own argument for not keeping the arm.
--
-- What this file therefore leaves standing, said plainly: after such a run the held row is
-- visible with no place and no pointer, its arrival marked, and neither arm reaches the pair
-- -- arm 1 wants a survivor holding an ordinal, arm 2 wants the pointer. The next run marks
-- the held row too, which is what the source is now saying, so the end state is right and the
-- cost is bounded: for one run a curator sees two withdrawal cards a centimetre apart for one
-- component, one of them this defect's own artefact. Widening an arm to catch that would mean
-- matching by proxy again, on a pair whose two halves are no longer telling the same story.

-- Said out loud, because a repair that reports nothing cannot be checked afterwards.
--
-- `left_standing` rather than `held`, which this file has already spent on one of the two
-- shapes: a variable called `held` beside a shape called 'held' reads as a count of that
-- shape, and it is not -- it is the pairs of either shape that something on the row bars
-- the repair from touching.
DO $$
DECLARE all_pairs int; safe_pairs int; left_standing int;
BEGIN
  SELECT count(*) INTO all_pairs FROM false_withdrawals;
  SELECT count(*) INTO safe_pairs FROM false_withdrawals WHERE NOT visited AND NOT placed;
  left_standing := all_pairs - safe_pairs;
  RAISE NOTICE 'false withdrawals found: %, collapsing: %, left for a curator: %',
    all_pairs, safe_pairs, left_standing;
  IF left_standing > 0 THEN
    -- Per shape, because what bars the repair differs and an operator goes looking for the
    -- thing named. Marked: a visit or a region assignment on the row being removed. Held:
    -- a visit only, the ghost there being the pending arrival -- there is no marked row on
    -- that side at all, and its region rows are spent by decision rather than measured.
    RAISE NOTICE 'left standing, with what bars each: %',
      (SELECT string_agg(format('experience %s ref %s (%s pair, location %s, %s)',
                                experience_id, external_ref, shape, ghost_id,
                                CASE WHEN visited AND placed THEN 'a visit and a region assignment'
                                     WHEN visited THEN 'a visit'
                                     ELSE 'a region assignment' END), ', ')
         FROM false_withdrawals WHERE visited OR placed);
  END IF;
END $$;

-- The arrival's pairing named the row about to go. Cleared first, so nothing points at a
-- row that no longer exists and no later publish tries to release a withdrawal that was
-- never real.
UPDATE experience_locations el
   SET withdrawal_deferred_for_location_id = NULL
 WHERE el.withdrawal_deferred_for_location_id IN
       (SELECT ghost_id FROM false_withdrawals WHERE NOT visited AND NOT placed);

DELETE FROM experience_locations
 WHERE id IN (SELECT ghost_id FROM false_withdrawals WHERE NOT visited AND NOT placed);

-- The held row takes back the place the false arrival was holding. *After* the delete,
-- not before: `(experience_id, ordinal)` is a plain unique index rather than a deferred
-- constraint, so writing that number onto a second row while the arrival still holds it
-- raises 23505 as the tuple is written -- and inside this transaction that rolls the
-- whole file back, repairing nothing, including the marked pairs that would have
-- collapsed cleanly. `false_withdrawals` is a materialised temp table, so it still
-- remembers the number after the row carrying it is gone.
--
-- To the arrival's ordinal rather than any remembered one, because that is the position
-- the source is offering today.
UPDATE experience_locations held
   SET ordinal = f.restore_ordinal
  FROM false_withdrawals f
 WHERE held.id = f.survivor_id
   AND f.shape = 'held'
   AND NOT f.visited AND NOT f.placed
   AND held.ordinal IS NULL;


COMMIT;
