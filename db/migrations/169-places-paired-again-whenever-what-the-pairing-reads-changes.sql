-- 169-places-paired-again-whenever-what-the-pairing-reads-changes.sql
--
-- Two near places with similar names are proposed as one place (ADR-0046
-- decision 2, ADR-0120). The pass ran by itself only for the places a run
-- created and an arrival a curator published (#1800); a renamed place, a
-- moved point, a refusal taken back, a merge or a separation was never paired
-- again, and a change of the rule reached only new places. This marks every
-- place whose pairing inputs change (mark_pairing_due(), on each table the
-- pass reads) for the backend to pair again, and records the rule's version,
-- so a change of the rule pairs the whole catalogue by itself (#1950). The
-- version starts at 0, so the first drain gives every database the current
-- rule's pairs — ADR-0120's included — once.
--
-- Re-runnable: tables are created if absent, the function is replaced and the
-- triggers are dropped and created again.

\set ON_ERROR_STOP on

BEGIN;

-- The places whose pairing inputs changed since the near-places pass last read
-- them (#1950): a trigger on every table the pass reads marks the place, and
-- the backend's drain pairs the marked places again and clears their marks
-- (drainPairing, mergeProposalFinder.ts). The rule's version is recorded beside
-- them, so a change of the rule pairs the whole catalogue again by itself.
CREATE TABLE IF NOT EXISTS experience_pairing_due (
    experience_id INTEGER PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
    marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE experience_pairing_due IS 'The places whose near-places pairing inputs changed since the pass last read them (#1950): a name, a source''s name or a local name, an offered point, the reach, whether a reader is offered the place, its kinds, its parts, a merge or a separation. Marked by mark_pairing_due(), drained by the backend (drainPairing), which pairs them again.';

CREATE TABLE IF NOT EXISTS experience_pairing_rule (
    only_row BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (only_row),
    rule_version INTEGER NOT NULL
);
INSERT INTO experience_pairing_rule (only_row, rule_version) VALUES (TRUE, 0) ON CONFLICT (only_row) DO NOTHING;
COMMENT ON TABLE experience_pairing_rule IS 'The version of the near-places pairing rule the stored proposals were found under (#1950): when the backend''s rule (PAIRING_RULE_VERSION) differs, the next drain pairs the whole catalogue and records the new version. 0 is none yet, so every database gets the current rule''s pairs once.';

-- One function for every table: the row's place, and for a move between
-- places both of them.
CREATE OR REPLACE FUNCTION mark_pairing_due() RETURNS TRIGGER AS $$
DECLARE
  ids INTEGER[];
BEGIN
  IF TG_TABLE_NAME = 'experiences' THEN
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END,
                 CASE WHEN TG_OP = 'UPDATE' THEN NEW.merged_into_id END];
  ELSIF TG_TABLE_NAME = 'experience_parts' THEN
    ids := CASE WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.whole_id, OLD.part_id] ELSE ARRAY[NEW.whole_id, NEW.part_id] END;
  ELSIF TG_TABLE_NAME = 'experience_separations' THEN
    ids := ARRAY[NEW.original_id, NEW.separated_id];
  ELSE
    -- experience_kind_memberships and experience_locations: the row's place, and
    -- the place it left where it moved.
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.experience_id END,
                 CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.experience_id END];
  END IF;
  -- DO UPDATE, not DO NOTHING: it locks a mark that is already there, so a
  -- drain deleting it waits for this transaction to commit and then pairs the
  -- place as this transaction left it.
  INSERT INTO experience_pairing_due (experience_id)
  SELECT DISTINCT i FROM unnest(ids) AS i
   WHERE i IS NOT NULL AND EXISTS (SELECT 1 FROM experiences e WHERE e.id = i)
  ON CONFLICT (experience_id) DO UPDATE SET marked_at = NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The inputs the pass reads (candidatePairsSql): a place's names and reach,
-- whether it is folded into another; a membership's name, kind and whether it
-- offers the place; a point's position and whether it is offered; the parts;
-- the separations. Only a change of one of them marks.
DROP TRIGGER IF EXISTS pairing_due_experience_insert ON experiences;
CREATE TRIGGER pairing_due_experience_insert AFTER INSERT ON experiences
  FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();
DROP TRIGGER IF EXISTS pairing_due_experience_update ON experiences;
CREATE TRIGGER pairing_due_experience_update AFTER UPDATE ON experiences
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name
                     OR OLD.name_local IS DISTINCT FROM NEW.name_local
                     OR OLD.metadata->'areaHectares' IS DISTINCT FROM NEW.metadata->'areaHectares'
                     OR OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id)
  EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS pairing_due_membership ON experience_kind_memberships;
CREATE TRIGGER pairing_due_membership AFTER INSERT OR DELETE ON experience_kind_memberships
  FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();
DROP TRIGGER IF EXISTS pairing_due_membership_update ON experience_kind_memberships;
CREATE TRIGGER pairing_due_membership_update AFTER UPDATE ON experience_kind_memberships
  FOR EACH ROW WHEN (OLD.experience_id IS DISTINCT FROM NEW.experience_id
                     OR OLD.reported_name IS DISTINCT FROM NEW.reported_name
                     OR OLD.kind_id IS DISTINCT FROM NEW.kind_id
                     OR OLD.admission IS DISTINCT FROM NEW.admission
                     OR OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS pairing_due_location ON experience_locations;
CREATE TRIGGER pairing_due_location AFTER INSERT OR DELETE ON experience_locations
  FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();
DROP TRIGGER IF EXISTS pairing_due_location_update ON experience_locations;
CREATE TRIGGER pairing_due_location_update AFTER UPDATE ON experience_locations
  FOR EACH ROW WHEN (OLD.experience_id IS DISTINCT FROM NEW.experience_id
                     OR NOT ST_Equals(OLD.location, NEW.location)
                     OR OLD.missing_since IS DISTINCT FROM NEW.missing_since
                     OR OLD.existence IS DISTINCT FROM NEW.existence
                     OR OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id
                     OR OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS pairing_due_part ON experience_parts;
CREATE TRIGGER pairing_due_part AFTER INSERT OR DELETE ON experience_parts
  FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS pairing_due_separation ON experience_separations;
CREATE TRIGGER pairing_due_separation AFTER INSERT OR UPDATE OF undone_at ON experience_separations
  FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();

COMMIT;
