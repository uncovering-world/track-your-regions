-- 072-a-work-link-records-the-memberships-that-place-it.sql
--
-- A work link records the memberships that place it (#1252, ADR-0084).
--
-- experience_treasure_placements names, per link, every membership whose
-- source places the work there, so on a place two sources fill each run takes
-- away only its own placement and the link is marked missing once none is
-- left. Every offered link is filled with its place's membership: until a
-- merge (#755) a place has one, and curators create no links, so every link a
-- source still places was placed by that membership. A marked link gets none:
-- its source has already stopped placing it.
--
-- Order-independent with 01-schema.sql, which carries the same table.
-- Re-runnable: the table and index are created if absent, and the backfill
-- reaches only a link that has no placement yet.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_treasure_placements (
    link_id INTEGER NOT NULL REFERENCES experience_treasures(id) ON DELETE CASCADE,
    membership_id INTEGER NOT NULL REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (link_id, membership_id)
);
COMMENT ON TABLE experience_treasure_placements IS 'Which memberships place a work link (ADR-0084): a run adds and takes away only its own, and the link is marked missing once none is left.';
CREATE INDEX IF NOT EXISTS idx_experience_treasure_placements_membership
    ON experience_treasure_placements(membership_id);

-- A link still without a placement on a place with two memberships would
-- leave which of them placed it to a guess. None exists before #755 builds the
-- merge; refuse rather than guess.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experience_treasures et
     WHERE et.missing_since IS NULL
       AND NOT EXISTS (SELECT 1 FROM experience_treasure_placements p WHERE p.link_id = et.id)
       AND (SELECT COUNT(*) FROM experience_kind_memberships m WHERE m.experience_id = et.experience_id) > 1
  ) THEN
    RAISE EXCEPTION 'a place has more than one membership: which of them placed its links cannot be told';
  END IF;
END $$;

INSERT INTO experience_treasure_placements (link_id, membership_id)
SELECT et.id, m.id
  FROM experience_treasures et
  JOIN experience_kind_memberships m ON m.experience_id = et.experience_id
 WHERE et.missing_since IS NULL
   AND NOT EXISTS (SELECT 1 FROM experience_treasure_placements p WHERE p.link_id = et.id)
ON CONFLICT DO NOTHING;

COMMIT;
