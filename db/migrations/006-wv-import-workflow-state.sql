-- Migration 006: Work-unit / sign-off state for the import-review workflow
--
-- Adds the per-country workflow state designed in
-- docs/tech/planning/import-review-workflow-redesign.md: work-unit flags,
-- hierarchy confirmation, sign-off status, assignment waivers, and the
-- reference territory used by strict tiling verification.
--
-- Idempotent: IF NOT EXISTS guards and a DO-block for the CHECK constraint.

ALTER TABLE region_import_state
    ADD COLUMN IF NOT EXISTS is_work_unit            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hierarchy_confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS signoff_status          TEXT    NOT NULL DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS signed_off_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assignment_waived       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS reference_division_ids  INTEGER[];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'region_import_state_signoff_status_check'
          AND conrelid = 'region_import_state'::regclass
    ) THEN
        ALTER TABLE region_import_state
            ADD CONSTRAINT region_import_state_signoff_status_check
            CHECK (signoff_status IN ('not_started', 'in_progress', 'signed_off'));
    END IF;
END $$;

ALTER TABLE world_views
    ADD COLUMN IF NOT EXISTS skeleton_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN region_import_state.is_work_unit IS 'Node appears on the import dashboard as a country (work unit)';
COMMENT ON COLUMN region_import_state.hierarchy_confirmed IS 'Admin confirmed the work unit''s subtree shape (hierarchy sub-stage of the country loop)';
COMMENT ON COLUMN region_import_state.signoff_status IS 'Work-unit workflow status: not_started / in_progress / signed_off';
COMMENT ON COLUMN region_import_state.signed_off_at IS 'Retained on staleness revert (in_progress + non-null = "modified after sign-off"); cleared only by explicit reopen';
COMMENT ON COLUMN region_import_state.assignment_waived IS 'Leaf intentionally has no geometry; its territory must be tiled by siblings';
COMMENT ON COLUMN region_import_state.reference_division_ids IS 'Work units: GADM division IDs defining the unit''s territory for verification';
COMMENT ON COLUMN world_views.skeleton_confirmed IS 'Admin confirmed continents/work-unit list (import workflow skeleton pass)';
