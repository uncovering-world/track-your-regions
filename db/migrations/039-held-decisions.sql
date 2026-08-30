-- 039-held-decisions.sql
--
-- Somewhere for a curator to answer one held field rather than a whole card
-- (#722), and the audit action that records having refused one.
--
-- A held card is answered as one act today. Run 68 proposes six things about
-- Getbol, Korean Tidal Flats (Phase II) -- dropping "(Phase II)" from its name,
-- a new picture, a rewritten description, six local names, the source's own
-- data and the catalogue's labels -- and the curator's buttons are all of it or
-- none of it. The one way to refuse a single held field is to claim it by
-- editing it and then publish, which publishHeldFields skips and reports; but
-- "this value is mine now" is a different statement from "I do not want this
-- value", and a claim outlives the question -- a source proposing something
-- else next month meets the claim and no curator.
--
-- The conflict card has had the other shape since 022: an answer per field, the
-- refusal recorded by value, and a source that changes its mind heard again.
-- This is the same mechanism one gate over, in a sibling table rather than a
-- widening of experience_conflict_decisions, and on purpose:
--
--   * the two answer different questions. A conflict refusal says "my value
--     stands over the source's" and presupposes a claim; a held answer is given
--     where nobody claimed anything. ADR-0025's own consequence forbids
--     collapsing two questions into one predicate.
--   * the readers differ. The queue's conflict card and accept-source read one;
--     the held card, heldWaitingSql, the admin panel's count and publishing read
--     the other.
--   * a held answer needs a part dimension a conflict refusal never has: since
--     ADR-0037 a held card carries the fields of the object's places and works
--     beside the object's own.
--
-- **Both verdicts are recorded, not only the refusal**, and that is what makes a
-- one-field publish possible at all. A whole-card publish clears
-- pending_change_sync_log_id, which is what takes the card away; a publish of one
-- of six leaves the pointer standing for the other five, and the run's record
-- still says the field it wrote was held. Without a row here that card would go
-- on offering a value it has already applied, reading "readers see X, the run
-- proposes Y" about a row that says Y. The run's own record is never rewritten
-- for the same reason it is never rewritten anywhere else: what it holds is what
-- happened.
--
-- The part is identified the way partRecord.ts identifies it, which is the way
-- the record names it (ADR-0026 decision 4): the reference narrows and the name
-- decides, because nine (experience_id, external_ref) pairs on this database are
-- duplicated -- a component crossing a border, listed once per country under one
-- number -- and one point carries no reference at all. Both halves are stable
-- while the hold stands: a changed item is named by what it was called before
-- the run rewrote it (keptChanges, rewriteOf), which is exactly the name readers
-- still see while the rename waits.
--
-- NULLS NOT DISTINCT is what makes the key work at all. The object's own field
-- carries three NULLs, and the referenceless point one; under the default rule
-- those rows are all distinct from each other, so the standing answer would
-- become a pile and the upsert below would never fire. PG 15+, and the stack
-- pins postgis/postgis:17-3.5.
--
-- Nothing to backfill: every held proposal on disk is unanswered by definition,
-- because until this file there was no way to answer one field of one. Applying
-- it changes nothing a reader sees.
--
-- Order: this file may run before or after the next re-application of
-- 01-schema.sql, in either order and any number of times. CREATE TABLE IF NOT
-- EXISTS is a no-op where the table exists, and the drop/add idiom on the CHECK
-- is the one 01-schema.sql uses for the same reason.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/039-held-decisions.sql
--
-- ...and set here as well, so the file stops on the first error however it is
-- invoked. Without it a failed CREATE TABLE would be followed by a widened
-- CHECK naming an action no table can hold, and psql would exit 0 either way.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS experience_held_decisions (
    id BIGSERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    -- NULL is the object's own field. A part carries the record's kind, and the
    -- CHECK is what stops a third spelling of the same two words.
    part_kind VARCHAR(20) CHECK (part_kind IS NULL OR part_kind IN ('locations', 'treasures')),
    part_ref VARCHAR(255),
    part_name VARCHAR(500),
    field VARCHAR(100) NOT NULL,
    answer VARCHAR(10) NOT NULL CHECK (answer IN ('published', 'refused')),
    -- The value the answer is about, read off the locked proposal and never off
    -- the request. The readers suppress a proposal only while it is jsonb-equal
    -- to this: a source that has changed its mind is asking a new question.
    value JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE NULLS NOT DISTINCT (experience_id, part_kind, part_ref, part_name, field)
);

-- No index beyond the unique constraint, as on 022: its btree leads on
-- experience_id, which is where every reader of this table starts -- the queue
-- asking whether one card's row is answered, publishing reading one object's
-- answers under its lock.

COMMENT ON TABLE experience_held_decisions IS 'Gate-held proposals a curator has answered, by value; keeps the held card and its count from asking again while the proposal is unchanged';
COMMENT ON COLUMN experience_held_decisions.part_kind IS 'NULL for the object own field; otherwise the contents kind the record filed the part under';
COMMENT ON COLUMN experience_held_decisions.answer IS 'published: the value was written by a curator click. refused: the curator said not this, and nothing was written';
COMMENT ON COLUMN experience_held_decisions.value IS 'The proposed value the answer is about, read from the locked proposal and never from the request';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited'));
