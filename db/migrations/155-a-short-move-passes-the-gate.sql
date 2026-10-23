-- 155-a-short-move-passes-the-gate.sql
--
-- A coordinate a reader sees, moved less than 250 m, in the same GADM leaf
-- division and no nearer another place, passes the curation gate (#1837,
-- ADR-0140). The runs before it held every such move: the Choragic Monument of
-- Lysicrates, 28 m onto the monument, and the Kröller-Müller Museum, 41 m from
-- its gift shop onto the building. This file takes the moves those runs held,
-- as a run now would.
--
-- Two kinds of hold:
--   - a point's move: an unread arrival under the reference of the verified
--     point it holds back, which the arriving membership placed as its own
--     rather than adopted from another source (ADR-0137). The arrival is published as verified, the old point
--     names it (moved_to_location_id), loses the arriving membership's
--     placement, and leaves the map once no other placement is left: what the
--     location writer now does (shortMoveWriter.ts). A move of a point nobody
--     verified stays a question, as it does for a run;
--   - a place's coordinate: a held 'location' field. It is written where the
--     place still holds the coordinate the card proposed to replace and no
--     curator claims or answered it, and the card is closed where it held
--     nothing else.
-- The record is brought to what the run now files: a written field is no
-- longer held, and carries passedTheGate 'short-move'.
--
-- The rule is short_move_passes below, spelled as shortMovePassesSql
-- (backend/src/db/shortMove.ts) spells it on 2026-10-23.
--
-- Re-runnable: a published arrival and a closed card are not matched again.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.short_move_passes(place integer, from_point geometry, to_point geometry) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (ST_Distance((from_point)::geography, (to_point)::geography) < 250
    AND cardinality(ARRAY(SELECT d.id FROM administrative_divisions d
          WHERE NOT d.has_children AND ST_Covers(d.geom, from_point) ORDER BY d.id)) > 0
    AND ARRAY(SELECT d.id FROM administrative_divisions d
          WHERE NOT d.has_children AND ST_Covers(d.geom, from_point) ORDER BY d.id) = ARRAY(SELECT d.id FROM administrative_divisions d
          WHERE NOT d.has_children AND ST_Covers(d.geom, to_point) ORDER BY d.id)
    AND NOT EXISTS (
      SELECT 1 FROM experience_locations near
        JOIN experiences other ON other.id = near.experience_id
       WHERE near.location && ST_Expand(to_point, 0.02)
         AND ST_DWithin(near.location::geography, (to_point)::geography, ST_Distance((from_point)::geography, (to_point)::geography))
         AND ST_Distance(near.location::geography, (to_point)::geography) < ST_Distance((from_point)::geography, (to_point)::geography)
         AND near.experience_id <> ALL(ARRAY(SELECT unnest(ARRAY(SELECT unnest(ARRAY[place]::int[])
    UNION SELECT prt.whole_id FROM experience_parts prt WHERE prt.part_id = ANY(ARRAY[place]::int[])))
    UNION ALL SELECT prt.part_id FROM experience_parts prt WHERE prt.whole_id = ANY(ARRAY(SELECT unnest(ARRAY[place]::int[])
    UNION SELECT prt.whole_id FROM experience_parts prt WHERE prt.part_id = ANY(ARRAY[place]::int[])))))
         AND near.missing_since IS NULL AND near.existence <> 'lost' AND near.merged_into_id IS NULL AND near.curation_state <> 'pending'
         AND other.merged_into_id IS NULL
         AND (EXISTS (SELECT 1 FROM experience_kind_memberships km
        WHERE km.experience_id = other.id AND km.admission <> 'refused' AND km.curation_state <> 'pending') OR EXISTS (SELECT 1 FROM experience_parts po
        JOIN experiences pw ON pw.id = po.whole_id
        JOIN experience_locations pel ON pel.experience_id = po.part_id
       WHERE po.part_id = other.id AND EXISTS (SELECT 1 FROM experience_kind_memberships km
        WHERE km.experience_id = pw.id AND km.admission <> 'refused' AND km.curation_state <> 'pending') AND pel.missing_since IS NULL AND pel.existence <> 'lost' AND pel.merged_into_id IS NULL AND pel.curation_state <> 'pending'))))
$$;

-- The points: each unread arrival that is a short move of the verified point it holds.
CREATE TEMP TABLE point_move ON COMMIT DROP AS
SELECT arrived.id AS new_id, old.id AS old_id,
       round(ST_Distance(old.location::geography, arrived.location::geography))::int AS metres
  FROM experience_locations arrived
  JOIN experience_locations old ON old.id = arrived.withdrawal_deferred_for_location_id
 WHERE arrived.curation_state = 'pending' AND arrived.refused_at IS NULL
   AND arrived.missing_since IS NULL AND arrived.merged_into_id IS NULL
   AND old.curation_state = 'verified' AND old.missing_since IS NULL
   AND old.external_ref IS NOT NULL AND old.external_ref = arrived.external_ref
   AND NOT old.curated_fields ? 'location'
   -- The membership that places the arrival placed the old point as its own,
   -- not adopted from another source (ADR-0137).
   AND EXISTS (SELECT 1 FROM experience_location_placements own
                 JOIN experience_location_placements came ON came.membership_id = own.membership_id
                WHERE own.location_id = old.id AND own.adopted_ref IS NULL
                  AND came.location_id = arrived.id)
   AND pg_temp.short_move_passes(arrived.experience_id, old.location, arrived.location);

-- The places: each open held card whose held coordinate is a short move the
-- place still stands at.
CREATE TEMP TABLE place_move ON COMMIT DROP AS
SELECT m.id AS membership_id, ch.id AS change_id, e.id AS experience_id,
       ST_SetSRID(ST_MakePoint((f->'new'->>'lon')::float8, (f->'new'->>'lat')::float8), 4326) AS new_location,
       NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(ch.changed_fields) g
          WHERE COALESCE((g->>'held')::boolean, false) AND g->>'field' <> 'location')
       AND NOT COALESCE(jsonb_path_exists(ch.contents, 'strict $.**.held ? (@ == true)'), false) AS only_field
  FROM experience_kind_memberships m
  JOIN experience_sync_changes ch ON ch.experience_id = m.experience_id
                                 AND ch.sync_log_id = m.pending_change_sync_log_id
  JOIN experiences e ON e.id = m.experience_id
 CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) f
 WHERE f->>'field' = 'location' AND COALESCE((f->>'held')::boolean, false)
   AND jsonb_typeof(ch.changed_fields) = 'array'
   AND ST_Distance(e.location::geography,
         ST_SetSRID(ST_MakePoint((f->'old'->>'lon')::float8, (f->'old'->>'lat')::float8), 4326)::geography) < 0.01
   AND NOT e.curated_fields ? 'location'
   AND NOT EXISTS (SELECT 1 FROM experience_held_decisions d
                    WHERE d.experience_id = e.id AND d.part_kind IS NULL AND d.field = 'location')
   AND pg_temp.short_move_passes(e.id, e.location,
         ST_SetSRID(ST_MakePoint((f->'new'->>'lon')::float8, (f->'new'->>'lat')::float8), 4326));

SELECT (SELECT count(*) FROM point_move) AS points_moved,
       (SELECT count(*) FROM place_move) AS places_moved,
       (SELECT count(*) FROM place_move WHERE only_field) AS cards_closed;

-- A run sets moved_to_location_id now too, so the column says so.
COMMENT ON COLUMN experience_locations.moved_to_location_id IS 'The point a move replaced this one with (#1448, #1837): the old spot of the Trevi Fountain names the point 24 m away. Set by a curator''s published move, with source_membership former, which is its answer; and by a run whose move of a verified point is short (ADR-0140), which leaves the point present and marks it missing as any point the source stops listing. Either way the point raises no withdrawal question and the answered withdrawals leave it out; a run that lists the old spot again, or a curator who answers it still listed, clears it.';

UPDATE experience_locations arrived
   SET curation_state = 'verified', withdrawal_deferred_for_location_id = NULL
  FROM point_move p
 WHERE arrived.id = p.new_id;

DELETE FROM experience_location_placements pl
 USING point_move p
 WHERE pl.location_id = p.old_id
   AND pl.membership_id IN (SELECT membership_id FROM experience_location_placements WHERE location_id = p.new_id);

UPDATE experience_locations old
   SET moved_to_location_id = p.new_id,
       missing_since = CASE WHEN EXISTS (SELECT 1 FROM experience_location_placements other WHERE other.location_id = old.id)
                            THEN old.missing_since ELSE NOW() END,
       ordinal = CASE WHEN EXISTS (SELECT 1 FROM experience_location_placements other WHERE other.location_id = old.id)
                      THEN old.ordinal END
  FROM point_move p
 WHERE old.id = p.old_id;

UPDATE experiences e SET location = p.new_location, updated_at = NOW()
  FROM place_move p
 WHERE e.id = p.experience_id;

UPDATE experience_sync_changes ch
   SET changed_fields = (
         SELECT jsonb_agg(CASE
                  WHEN f->>'field' = 'location' AND COALESCE((f->>'held')::boolean, false)
                    THEN f || '{"held": false, "passedTheGate": "short-move"}'::jsonb
                  ELSE f END ORDER BY n)
           FROM jsonb_array_elements(ch.changed_fields) WITH ORDINALITY AS t(f, n))
  FROM place_move p
 WHERE ch.id = p.change_id;

UPDATE experience_sync_changes ch SET change_type = 'updated'
  FROM place_move p
 WHERE ch.id = p.change_id AND p.only_field AND ch.change_type = 'held';

UPDATE experience_kind_memberships m
   SET pending_change_sync_log_id = NULL, updated_at = NOW()
  FROM place_move p
 WHERE m.id = p.membership_id AND p.only_field;

COMMIT;
