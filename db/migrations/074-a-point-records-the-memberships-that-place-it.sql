-- 074-a-point-records-the-memberships-that-place-it.sql
--
-- A point records the memberships that place it (#1256, ADR-0084).
--
-- experience_location_placements names, per point, every membership whose
-- source places it, so on a place two sources fill each run withdraws only its
-- own points and a point is marked missing once no placement is left. Every
-- point still offered is filled with its place's membership: until a merge
-- (#755) a place has one, so the source that placed its points is that
-- membership's -- a curator's point on a manual place included, which its
-- manual membership places. A marked point gets none: its source has already
-- stopped placing it.
--
-- The ordinal stops being unique per place: two sources' lists may both start
-- at 1, and the writer renumbers in place rather than parking the old values.
--
-- Order-independent with 01-schema.sql, which carries the same table and drops
-- the same constraint. Re-runnable: the table and index are created if absent,
-- the backfill reaches only a point with no placement yet, and the drop names
-- IF EXISTS.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_location_placements (
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    membership_id INTEGER NOT NULL REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (location_id, membership_id)
);
COMMENT ON TABLE experience_location_placements IS 'Which memberships place a point (ADR-0084): a run adds and takes away only its own, and the point is marked missing once none is left.';
CREATE INDEX IF NOT EXISTS idx_experience_location_placements_membership
    ON experience_location_placements(membership_id);

-- A point still without a placement on a place with two memberships would
-- leave which of them placed it to a guess. None exists before #755 builds the
-- merge; refuse rather than guess.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experience_locations el
     WHERE el.missing_since IS NULL
       AND NOT EXISTS (SELECT 1 FROM experience_location_placements p WHERE p.location_id = el.id)
       AND (SELECT COUNT(*) FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id) > 1
  ) THEN
    RAISE EXCEPTION 'a place has more than one membership: which of them placed its points cannot be told';
  END IF;
END $$;

INSERT INTO experience_location_placements (location_id, membership_id)
SELECT el.id, m.id
  FROM experience_locations el
  JOIN experience_kind_memberships m ON m.experience_id = el.experience_id
 WHERE el.missing_since IS NULL
   AND NOT EXISTS (SELECT 1 FROM experience_location_placements p WHERE p.location_id = el.id)
ON CONFLICT DO NOTHING;

ALTER TABLE experience_locations DROP CONSTRAINT IF EXISTS experience_locations_experience_id_ordinal_key;

COMMIT;
