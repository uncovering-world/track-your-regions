-- 046: A kind is its own table, and a place's membership in it is its own row
--      (#822; ADR-0045 decision 4, ADR-0046 decision 8)
--
-- A row of `experiences` was at once the place and its membership in a source:
-- the kind a reader browses by was the source row it points at, and what the
-- kind says about the place -- admitted or refused and why, the work that
-- qualified a museum, the must-see badge, whether a curator has passed the
-- arrival -- sat on the row beside the place's own name, locations and
-- picture. So the Statue of Liberty is two rows, one per source, and a second
-- source of the Art Museums kind has nowhere to record which source brought a
-- row (ADR-0045's context).
--
-- This file lands the split. `experience_kinds` holds what a traveller browses
-- by, seeded with the three kinds under the ids of the three sources that fill
-- them; `experience_categories.kind_id` names the kind each source fills; and
-- `experience_kind_memberships` holds one row per (place, kind) with
-- everything that moved off `experiences`: admission and admission_reason,
-- metadata.admittedFor as admitted_for, is_iconic, the curator's pins on
-- those two out of curated_fields, and the gate state -- curation_state,
-- published_at, pending_change_sync_log_id. The backfill writes one
-- membership per row, then the moved columns and keys are dropped, and the
-- stored proposals lose the field in both shapes it can take: the entries
-- whose field is `metadata.admittedFor`, the way 044 removed `metadata.type`
-- (none on the development catalogue -- the key joined the run's own
-- bookkeeping in #571, before any run filed per-field entries), and the key
-- inside the catch-all `metadata` entries of cards filed before ADR-0039,
-- which publishing would spread back onto the place (143 entries on 100
-- museums there, runs 49 to 69); no curator's answer names the field.
-- `experiences.category_id` stays: it is the arbiter of the row's identity
-- until #755 moves a source's id onto the membership.
--
-- What a reader sees is unchanged: every reader-facing read asks the four
-- questions of the place through its memberships, and until #819 each place
-- has exactly one -- the closing checks refuse a database where that is not so.
--
-- Re-runnable: the tables are created if absent, the seed and the fill are
-- guarded, the backfill runs only while the moved columns still exist, and
-- the drops are IF EXISTS.
--
-- Order: either side of the next re-application of 01-schema.sql. That file
-- creates the same tables empty and no longer touches the moved columns, so
-- whichever reaches a database first, this file's backfill is what fills the
-- memberships. The backend reads memberships from the same change, so run
-- this before starting it against a database that holds a catalogue.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Kinds (ADR-0045 decision 1), under the ids of the sources that fill them.
CREATE TABLE IF NOT EXISTS experience_kinds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    display_priority INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_kinds IS 'A kind of place a traveller browses by (ADR-0045 decision 1): its own list, pin colour and count. Filled by one or more sources (experience_categories); a place''s membership in it is a row of experience_kind_memberships.';
COMMENT ON COLUMN experience_kinds.name IS 'What a traveller calls the thing in front of them -- World Heritage Sites, Art Museums -- never a source''s name for a selection rule (ADR-0045 decision 8).';
COMMENT ON COLUMN experience_kinds.display_priority IS 'Display order of the kind''s list and pills (lower = shown first).';

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (1, 'World Heritage Sites', 1),
    (2, 'Art Museums', 2),
    (3, 'Public Art & Monuments', 3)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

-- 2. Every source names the kind it fills (decision 3). By name, the museum
--    source under either of its names; a source this file cannot place is
--    refused rather than left filling nothing a reader can browse.
ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS kind_id INTEGER REFERENCES experience_kinds(id);
COMMENT ON COLUMN experience_categories.kind_id IS 'The kind this source fills (ADR-0045 decision 3). One kind per source today; a membership records which source brought it, so a kind can have several sources.';

UPDATE experience_categories c
   SET kind_id = k.id
  FROM experience_kinds k
 WHERE c.kind_id IS NULL
   AND k.name = CASE c.name
                  WHEN 'UNESCO World Heritage Sites' THEN 'World Heritage Sites'
                  WHEN 'Top Art Museums' THEN 'Art Museums'
                  ELSE c.name
                END;

DO $$
DECLARE
  unplaced TEXT;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY id) INTO unplaced
    FROM experience_categories WHERE kind_id IS NULL;
  IF unplaced IS NOT NULL THEN
    RAISE EXCEPTION 'refusing: source row(s) % name no kind -- add the kind to experience_kinds and set kind_id by hand, then run this file again', unplaced;
  END IF;
  ALTER TABLE experience_categories ALTER COLUMN kind_id SET NOT NULL;
END $$;

-- 3. The membership table (decision 4). The same DDL as 01-schema.sql, so
--    either file may reach a database first.
CREATE TABLE IF NOT EXISTS experience_kind_memberships (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    kind_id INTEGER NOT NULL REFERENCES experience_kinds(id),
    source_id INTEGER NOT NULL REFERENCES experience_categories(id) ON DELETE CASCADE,
    admission VARCHAR(10) NOT NULL DEFAULT 'admitted' CHECK (admission IN ('admitted', 'refused')),
    admission_reason TEXT,
    admitted_for JSONB,
    is_iconic BOOLEAN NOT NULL DEFAULT FALSE,
    curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    curation_state VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (curation_state IN ('pending', 'auto', 'verified')),
    published_at TIMESTAMPTZ,
    pending_change_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, kind_id)
);

COMMENT ON TABLE experience_kind_memberships IS 'A place''s membership in a kind (ADR-0045 decision 4): one row per (place, kind), carrying what the kind says about the place -- the source that brought it, the admission verdict, the badge, and whether a curator has passed the arrival. The place itself is the experiences row.';
COMMENT ON COLUMN experience_kind_memberships.source_id IS 'The source that brought this membership (ADR-0045 decision 3): a kind may have several, and a run writes, refuses and badges only the memberships its own source brought.';
COMMENT ON COLUMN experience_kind_memberships.admission IS 'admitted or refused. Whether this kind accepts the place, independent of whether the source still lists it (ADR-0024). The machine sets this one: a refusal is our own rule applied to an object the run named, not an observation. A place with no admitted membership is hidden from every read that offers somewhere to go, and from none that records a visit.';
COMMENT ON COLUMN experience_kind_memberships.admission_reason IS 'Why the kind refused it, stated verbatim to the curator. Here rather than in experience_sync_changes because a changeset is keyed by the external id the run named, which is not always this row''s.';
COMMENT ON COLUMN experience_kind_memberships.admitted_for IS 'The work whose fame qualified a museum for the works-first source ({qid, label}, ADR-0023): the reason this membership exists. The run''s own bookkeeping, never proposed to a curator (#571).';
COMMENT ON COLUMN experience_kind_memberships.is_iconic IS 'The must-see badge, the world tier of this kind (ADR-0045 decision 5): set by a source whose admission rule is a fame line, cleared with a refusal, pinned by a curator in curated_fields. The membership''s, not the place''s: a place admitted to a second kind carries that kind''s badge on that kind''s terms.';
COMMENT ON COLUMN experience_kind_memberships.curated_fields IS 'Field names a curator has pinned on this membership -- admission (a confirmed or overridden refusal), is_iconic -- in the shape of experiences.curated_fields. A pinned field is skipped by every run.';
COMMENT ON COLUMN experience_kind_memberships.curation_state IS 'pending = arrived from a gated source and nobody has passed it; auto = published unread; verified = a curator passed what is live now. No reader-facing read may offer a place none of whose memberships has passed (ADR-0025; per member since ADR-0045 decision 7).';
COMMENT ON COLUMN experience_kind_memberships.published_at IS 'When this membership became visible. NULL while pending and for every row that predates the gate. What the "New" chip counts from (#529): a gated row is found months before a reader can see it, so the run that found it is the wrong clock.';
COMMENT ON COLUMN experience_kind_memberships.pending_change_sync_log_id IS 'The run of this membership''s source whose content proposal for the place is held while a reader can see it. NULL when nothing is held. Contents need no equivalent -- a content row is held by being written pending rather than withheld.';

CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_kind ON experience_kind_memberships(kind_id, admission);
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_source ON experience_kind_memberships(source_id, experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_pending ON experience_kind_memberships(experience_id) WHERE curation_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_held ON experience_kind_memberships(experience_id) WHERE pending_change_sync_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_iconic ON experience_kind_memberships(kind_id) WHERE is_iconic;

-- 4. One membership per row, while the row still carries what moves. The
--    statement is planned only when the guard passes, so a database already
--    past the drop below runs nothing here rather than failing on a column
--    that is gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'experiences' AND column_name = 'admission'
  ) THEN
    INSERT INTO experience_kind_memberships (
      experience_id, kind_id, source_id,
      admission, admission_reason, admitted_for, is_iconic, curated_fields,
      curation_state, published_at, pending_change_sync_log_id,
      created_at, updated_at
    )
    SELECT e.id, c.kind_id, e.category_id,
           e.admission, e.admission_reason, e.metadata -> 'admittedFor', e.is_iconic,
           COALESCE((
             SELECT jsonb_agg(f)
               FROM jsonb_array_elements(COALESCE(e.curated_fields, '[]'::jsonb)) AS f
              WHERE f IN ('"admission"'::jsonb, '"is_iconic"'::jsonb)
           ), '[]'::jsonb),
           e.curation_state, e.published_at, e.pending_change_sync_log_id,
           COALESCE(e.created_at, NOW()), COALESCE(e.updated_at, NOW())
      FROM experiences e
      JOIN experience_categories c ON c.id = e.category_id
    ON CONFLICT (experience_id, kind_id) DO NOTHING;
  END IF;
END $$;

-- 5. What moved leaves the row, and the proposals that named it.
UPDATE experiences
   SET metadata = metadata - 'admittedFor'
 WHERE metadata ? 'admittedFor';

UPDATE experiences
   SET curated_fields = curated_fields - 'admission' - 'is_iconic'
 WHERE curated_fields ?| ARRAY['admission', 'is_iconic'];

-- A stored proposal names the field it is about. `admittedFor` is the run's own
-- bookkeeping since #571 and is never proposed again; the entries filed before
-- that would otherwise write the key back onto the place when published.
UPDATE experience_sync_changes
   SET changed_fields = (
     SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
       FROM jsonb_array_elements(changed_fields) AS f
      WHERE f->>'field' IS DISTINCT FROM 'metadata.admittedFor'
   )
 WHERE jsonb_typeof(changed_fields) = 'array'
   AND changed_fields @> '[{"field": "metadata.admittedFor"}]'::jsonb;

-- A card filed before ADR-0039 carries one catch-all entry for the whole
-- metadata object, with the key inside its payloads rather than as a field of
-- its own; publishing it spreads the payload over the stored object and would
-- write the key straight back onto the place. Trim the key out of both sides
-- of such an entry and leave everything else about it as it is. On the
-- development catalogue: 143 entries on 100 museums, runs 49 to 69.
UPDATE experience_sync_changes
   SET changed_fields = (
     SELECT COALESCE(jsonb_agg(
              CASE WHEN f->>'field' = 'metadata'
                   THEN f
                        || CASE WHEN jsonb_typeof(f->'old') = 'object'
                                THEN jsonb_build_object('old', (f->'old') - 'admittedFor')
                                ELSE '{}'::jsonb END
                        || CASE WHEN jsonb_typeof(f->'new') = 'object'
                                THEN jsonb_build_object('new', (f->'new') - 'admittedFor')
                                ELSE '{}'::jsonb END
                   ELSE f END), '[]'::jsonb)
       FROM jsonb_array_elements(changed_fields) AS f
   )
 WHERE jsonb_typeof(changed_fields) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(changed_fields) AS f
      WHERE f->>'field' = 'metadata'
        AND ((f->'old') ? 'admittedFor' OR (f->'new') ? 'admittedFor')
   );

DELETE FROM experience_held_decisions WHERE field = 'metadata.admittedFor';

-- 6. The columns, their indexes, constraints and the pointer's foreign key go
--    with them.
ALTER TABLE experiences
    DROP COLUMN IF EXISTS admission,
    DROP COLUMN IF EXISTS admission_reason,
    DROP COLUMN IF EXISTS is_iconic,
    DROP COLUMN IF EXISTS curation_state,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS pending_change_sync_log_id;

-- 7. Every place has its membership, and it names the source the row is keyed
--    on -- the two facts every reader now rests on.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n
    FROM experiences e
   WHERE NOT EXISTS (
     SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = e.id
   );
  IF n > 0 THEN
    RAISE EXCEPTION '% place(s) hold no membership after the backfill', n;
  END IF;

  SELECT count(*) INTO n
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id
   WHERE m.source_id <> e.category_id;
  IF n > 0 THEN
    RAISE EXCEPTION '% membership(s) name a source other than the one their row is keyed on', n;
  END IF;
END $$;

COMMIT;
