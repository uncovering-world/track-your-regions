-- 018: a source is trusted or it is not (ADR-0025)
--
-- Seven columns and one UPDATE. The columns give every gated thing somewhere to
-- say whether anyone has looked at it: the experience, its points, its links to
-- works, and the works themselves. Nothing reads them yet — sub-branch 2 adds
-- the reader-side predicate — so applying this file changes what nobody sees.
--
-- Every existing row takes the `auto` default: visible exactly as today, marked
-- truthfully as unread. There is nothing to backfill and nothing to lose.
-- Contrast migration 009, which did write a value and credited 1547 rows to a
-- run that never saw them.
--
-- The UPDATE is the honest half. All three existing categories have been
-- publishing unread for months; leaving them `requires_curation = true` would
-- not record that, it would silently change it — every arrival from the next
-- UNESCO run invisible, 55 of them in the last round, with nobody having
-- decided anything. The column default stays `true` so a NEW source is
-- untrusted until someone says so, and switching these three on stays a
-- deliberate act by an admin, which is where that decision belongs.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. It adds only
-- nullable or defaulted columns and new CHECKs no existing row can violate
-- (every row takes 'auto'), and the one value it writes sits inside the same
-- guard as the column it belongs to, so whichever file gets there first does the
-- whole job and the other does nothing.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/018-curation-gate.sql

\set ON_ERROR_STOP on

BEGIN;

-- Creating the gate column and answering for the three sources that predate it
-- are one act, so they sit inside one guard -- byte-identical to the guard in
-- `01-schema.sql`, because whichever file reaches a database first has to do
-- both, and every later application of either has to do neither.
--
-- Nothing in this repository records which of these files a database has already
-- seen; that is tribal knowledge today (db/migrations/README.md, #435). So this
-- is the only statement here that writes a value, and it has to be inert by
-- itself. Two ways to get that wrong, both of which this shape avoids: an
-- unguarded `UPDATE` re-runs after an admin has deliberately gated a source and
-- silently un-gates it, and an `UPDATE` guarded merely on the column's existence
-- is skipped when `01-schema.sql` created the column first -- leaving all three
-- gated by its `DEFAULT true` backfill, and the next run of each publishing
-- nothing a reader can see.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'experience_categories' AND column_name = 'requires_curation'
    ) THEN
        ALTER TABLE experience_categories
            ADD COLUMN requires_curation BOOLEAN NOT NULL DEFAULT true;
        UPDATE experience_categories SET requires_curation = false
         WHERE name IN ('UNESCO World Heritage Sites', 'Top Art Museums', 'Public Art & Monuments');
    END IF;
END $$;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS pending_change_sync_log_id INTEGER
    REFERENCES experience_sync_logs(id) ON DELETE SET NULL;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_curation_state_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_curation_state_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_curation_state_check') THEN
        ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_curation_state_check') THEN
        ALTER TABLE treasures ADD CONSTRAINT treasures_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiences_curation_state ON experiences(curation_state) WHERE curation_state = 'pending';

COMMIT;
