-- 071-whether-a-source-lists-a-place-is-its-memberships.sql
--
-- Whether a source still lists a place is its membership's (#1251, ADR-0084).
--
-- missing_since and source_membership (ADR-0020's axis 1) and the run's record
-- of when its source first and last saw the place move onto
-- experience_kind_memberships, filled from the place: until a merge (#755) a
-- place has one membership, so its source's observation is the place's. The
-- place keeps missing_since and source_membership as a derivation of its
-- memberships, owned by derive_place_listing(); the place's first- and
-- last-seen columns are dropped, since only a source has seen anything.
--
-- Must run before 01-schema.sql is re-applied: the schema no longer declares
-- the dropped columns, and its trigger reads the new ones. Re-runnable: each
-- column is added if absent, the backfill runs only while the place still
-- carries the columns it reads, the function is CREATE OR REPLACE, the trigger
-- and the check are dropped if present before they are created, and each drop
-- names IF EXISTS.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_source_membership_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_source_membership_check
  CHECK (source_membership IN ('present', 'former'));
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'experiences' AND column_name = 'last_seen_sync_log_id'
  ) THEN
    -- A place with two memberships would hand one source's observation to the
    -- other. None exists before #755 builds the merge; refuse rather than guess.
    IF EXISTS (
      SELECT 1 FROM experience_kind_memberships
       GROUP BY experience_id HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'a place has more than one membership: whose observation the place''s columns are cannot be told';
    END IF;
    UPDATE experience_kind_memberships m
       SET missing_since = e.missing_since,
           source_membership = e.source_membership,
           first_seen_sync_log_id = e.first_seen_sync_log_id,
           last_seen_sync_log_id = e.last_seen_sync_log_id,
           last_seen_at = e.last_seen_at
      FROM experiences e
     WHERE e.id = m.experience_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_missing ON experience_kind_memberships(source_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_first_seen ON experience_kind_memberships(first_seen_sync_log_id);

CREATE OR REPLACE FUNCTION recompute_place_listing(place_id INTEGER) RETURNS void AS $$
BEGIN
    UPDATE experiences e
       SET missing_since = d.missing_since,
           source_membership = d.source_membership
      FROM (SELECT CASE WHEN bool_and(m.missing_since IS NOT NULL) THEN max(m.missing_since) END AS missing_since,
                   CASE WHEN bool_and(m.source_membership = 'former') THEN 'former' ELSE 'present' END AS source_membership
              FROM experience_kind_memberships m
             WHERE m.experience_id = place_id) d
     WHERE e.id = place_id
       AND (e.missing_since IS DISTINCT FROM d.missing_since
            OR e.source_membership IS DISTINCT FROM d.source_membership);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION derive_place_listing() RETURNS trigger AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM recompute_place_listing(OLD.experience_id);
    END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.experience_id <> OLD.experience_id) THEN
        PERFORM recompute_place_listing(NEW.experience_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_place_listing ON experience_kind_memberships;
CREATE TRIGGER trg_derive_place_listing
    AFTER INSERT OR DELETE OR UPDATE OF missing_since, source_membership, experience_id
    ON experience_kind_memberships
    FOR EACH ROW EXECUTE FUNCTION derive_place_listing();

DROP INDEX IF EXISTS idx_experiences_first_seen;
ALTER TABLE experiences DROP COLUMN IF EXISTS first_seen_sync_log_id;
ALTER TABLE experiences DROP COLUMN IF EXISTS last_seen_sync_log_id;
ALTER TABLE experiences DROP COLUMN IF EXISTS last_seen_at;

COMMENT ON COLUMN experiences.missing_since IS 'Derived from the place''s memberships by derive_place_listing(): when the last of them was flagged, once every membership''s source has stopped listing the place; NULL while any source still lists it. Written only by that trigger (ADR-0084).';
COMMENT ON COLUMN experiences.source_membership IS 'Derived from the place''s memberships by derive_place_listing(): former once every membership is former, present otherwise. Written only by that trigger (ADR-0084).';
COMMENT ON COLUMN experience_kind_memberships.missing_since IS 'When a clean run of this membership''s source, an authoritative one, first failed to list the place. A machine observation, not a verdict (ADR-0020); the source''s own, since another source may still list the place (ADR-0084).';
COMMENT ON COLUMN experience_kind_memberships.source_membership IS 'present or former: whether this membership''s source still lists the place. Only a curator sets former; a run that lists the place again sets present, which only ever restores visibility (ADR-0020).';
COMMENT ON COLUMN experience_kind_memberships.first_seen_sync_log_id IS 'The run of this membership''s source that first brought the place into this kind.';
COMMENT ON COLUMN experience_kind_memberships.last_seen_sync_log_id IS 'The newest run of this membership''s source that listed the place. A conflict this source proposed in an earlier run is withdrawn once a later landed run of the same source saw the place and proposed nothing.';

COMMIT;
