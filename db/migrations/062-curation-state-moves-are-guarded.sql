-- 062-curation-state-moves-are-guarded.sql
--
-- The database refuses a curation_state move the gate does not allow (#794,
-- ADR-0070). Re-runnable: the function is CREATE OR REPLACE and each trigger
-- is dropped if present before it is created.

\set ON_ERROR_STOP on

BEGIN;
-- A curation_state move the gate does not allow is refused (#794, ADR-0070).
--
-- Two moves would break the gate of ADR-0025 without anything failing:
-- verified -> pending takes a published row off every reader's screen, and
-- pending -> auto publishes one nobody has passed. The moves each table may
-- make are listed in @tyr/shared/lifecycle (CURATION_MOVES) and here, and a
-- database-lane spec (curationMoves.db.test.ts) walks every pair against the
-- list, so the two cannot come to disagree. An insert is not a move: a row is
-- created in whatever state its writer chose, and the gate is on what happens
-- to it after.
CREATE OR REPLACE FUNCTION guard_curation_state_move() RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
BEGIN
  allowed := CASE TG_TABLE_NAME
    WHEN 'experience_kind_memberships' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'), ('auto', 'verified'), ('verified', 'auto'))
    WHEN 'experience_locations' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'))
    WHEN 'treasures' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'))
    WHEN 'experience_treasures' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'), ('auto', 'pending'))
    ELSE FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'curation_state may not move from % to % on %', OLD.curation_state, NEW.curation_state, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_kind_memberships;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_kind_memberships
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_locations;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_locations
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON treasures;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON treasures
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_treasures;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_treasures
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();

COMMIT;
