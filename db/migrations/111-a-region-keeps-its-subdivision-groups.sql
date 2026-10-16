-- 111-a-region-keeps-its-subdivision-groups.sql
--
-- The groups an admin sorts a region's members into in the Create Subregions
-- dialog, and which group each member is in, are kept in the database (#595),
-- where they lived in the admin's browser before: cleared site data, another
-- machine or a second admin lost them.
--
-- 01-schema.sql declares the same tables for a fresh database.
-- Re-runnable: the tables and indexes are created where they are missing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS region_subdivision_groups (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    color TEXT CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    existing_region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    UNIQUE (region_id, sort_order)
);

CREATE TABLE IF NOT EXISTS region_member_group_assignments (
    region_member_id INTEGER PRIMARY KEY REFERENCES region_members(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES region_subdivision_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rsg_region ON region_subdivision_groups(region_id);
CREATE INDEX IF NOT EXISTS idx_rmga_group ON region_member_group_assignments(group_id);

COMMENT ON TABLE region_subdivision_groups IS 'The groups an admin sorts a region''s members into in the Create Subregions dialog (#595), in their order: each becomes a subregion when the admin creates them. Admin-only working material.';
COMMENT ON COLUMN region_subdivision_groups.existing_region_id IS 'The child region the group fills instead of a new one (an imported child, say); cleared if that region is deleted, keeping the group.';
COMMENT ON COLUMN region_subdivision_groups.color IS 'The colour picked for the group, often with the eyedropper from the reference map, as #rrggbb; null for the palette''s.';
COMMENT ON TABLE region_member_group_assignments IS 'Which group of the Create Subregions dialog a region member is in (#595): at most one, and gone with the member or the group. A member no longer in the group''s region is not read as assigned.';

COMMIT;
