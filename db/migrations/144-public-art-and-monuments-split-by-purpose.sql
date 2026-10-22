-- 144: Public Art & Monuments splits by purpose (#1807, ADR-0132)
--
-- One kind held two things a traveller browses apart: what was made to be
-- looked at -- a sculpture, a fountain, a mural -- and what was raised to
-- remember -- a memorial, a triumphal arch, a column, an obelisk. Kind and
-- source 3 keep their id as Public art; kind and source 6, Monuments &
-- memorials, is new, and the two run as one pass over one gather.
--
-- Every membership of kind 3 is copied into kind 6 with its state: admission
-- and its reason, the pins and questions, the badge, the gate (curation_state,
-- published_at), the run's pointers, its point's placement and its visit
-- question; the source's answers about a held type and its curator
-- assignments are copied with them. Nothing is decided here: the first run of
-- each source refuses what its rule does not hold, with the reason on the
-- membership, and a pin its rule disagrees with becomes a question for a
-- curator (#1367). A held proposal is not copied -- it is source 3's run's,
-- and source 6's first run proposes its own.
--
-- `01-schema.sql` seeds the new names for a fresh database. Order: apply this
-- before the next re-application of 01-schema.sql, whose seed would otherwise
-- add a second source 'Public art' beside the old row; a database in that
-- state is refused rather than renamed around (the shape of 045).
--
-- Re-runnable: the renames match nothing once done, the seeds are guarded by
-- their name, and the copies skip what kind 6 already holds.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_sources WHERE name = 'Public art')
     AND EXISTS (SELECT 1 FROM experience_sources WHERE name = 'Public Art & Monuments') THEN
    RAISE EXCEPTION 'refusing to rename: both "Public Art & Monuments" and "Public art" exist — 01-schema.sql was re-applied before this migration, so the source row is duplicated; remove the seeded duplicate first';
  END IF;
END $$;

UPDATE experience_kinds SET name = 'Public art' WHERE id = 3 AND name = 'Public Art & Monuments';
UPDATE experience_sources
   SET name = 'Public art',
       description = 'Notable outdoor sculptures, statues, fountains and murals worldwide, sourced from Wikidata'
 WHERE id = 3 AND name = 'Public Art & Monuments';

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (6, 'Monuments & memorials', 6)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

-- Gated on arrival, and reading Wikidata through the door source 3 reads: the
-- pass gathers once, under its first source (ADR-0132 decision 5).
INSERT INTO experience_sources
    (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id, wikidata_reader)
VALUES (
    6,
    'Monuments & memorials',
    'Notable monuments, memorials, triumphal arches, columns and obelisks worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    6,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Monuments & memorials'),
    COALESCE((SELECT wikidata_reader FROM experience_sources WHERE id = 3), 'live')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

INSERT INTO experience_kind_memberships (
    experience_id, kind_id, source_id, external_id, admission, admission_reason, admitted_for, is_iconic,
    curated_fields, curation_state, published_at, admission_answered_at, missing_since, source_membership,
    first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, type, reported_name, reported_subtitle,
    reported_image_url, reported_location, reported_image_credit, wikidata_items, admission_pin_verdict,
    admission_pin_reason, admission_question_verdict, admission_question_reason, admission_questioned_at,
    admission_question_sync_log_id, created_at, updated_at
)
SELECT experience_id, 6, 6, external_id, admission, admission_reason, admitted_for, is_iconic,
       curated_fields, curation_state, published_at, admission_answered_at, missing_since, source_membership,
       first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, type, reported_name, reported_subtitle,
       reported_image_url, reported_location, reported_image_credit, wikidata_items, admission_pin_verdict,
       admission_pin_reason, admission_question_verdict, admission_question_reason, admission_questioned_at,
       admission_question_sync_log_id, created_at, updated_at
  FROM experience_kind_memberships
 WHERE source_id = 3
ON CONFLICT (experience_id, kind_id) DO NOTHING;

-- The type each membership is filed under is the run's: the first run writes
-- the new vocabularies (memorial, arch, column, obelisk, monument; sculpture,
-- fountain, street-art), and until then a reader sees the old two. A type a
-- curator claimed is one the run never rewrites, so a claim on a type outside
-- the membership's new vocabulary -- a monument on Public art, a sculpture on
-- Monuments & memorials -- is released for the run to file it; a claim inside
-- it stands.
UPDATE experience_kind_memberships
   SET curated_fields = curated_fields - 'type'
 WHERE curated_fields ? 'type'
   AND ((source_id = 3 AND type IS DISTINCT FROM 'sculpture')
     OR (source_id = 6 AND type IS DISTINCT FROM 'monument'));

INSERT INTO experience_location_placements (location_id, membership_id, created_at)
SELECT p.location_id, copy.id, p.created_at
  FROM experience_location_placements p
  JOIN experience_kind_memberships m ON m.id = p.membership_id AND m.source_id = 3
  JOIN experience_kind_memberships copy ON copy.experience_id = m.experience_id AND copy.source_id = 6
ON CONFLICT (location_id, membership_id) DO NOTHING;

INSERT INTO experience_visit_questions
    (membership_id, witnesses, reading, confidence, sync_log_id, asked_at, answer, answered_by, answered_at)
SELECT copy.id, q.witnesses, q.reading, q.confidence, q.sync_log_id, q.asked_at, q.answer, q.answered_by, q.answered_at
  FROM experience_visit_questions q
  JOIN experience_kind_memberships m ON m.id = q.membership_id AND m.source_id = 3
  JOIN experience_kind_memberships copy ON copy.experience_id = m.experience_id AND copy.source_id = 6
ON CONFLICT (membership_id) DO NOTHING;

INSERT INTO experience_held_decisions
    (experience_id, part_kind, part_ref, part_name, field, answer, value, decided_by, decided_at, source_id)
SELECT experience_id, part_kind, part_ref, part_name, field, answer, value, decided_by, decided_at, 6
  FROM experience_held_decisions
 WHERE source_id = 3
ON CONFLICT ON CONSTRAINT experience_held_decisions_answer_key DO NOTHING;

INSERT INTO curator_assignments (user_id, scope_type, source_id, assigned_by, assigned_at, notes)
SELECT user_id, scope_type, 6, assigned_by, assigned_at, notes
  FROM curator_assignments
 WHERE scope_type = 'source' AND source_id = 3
ON CONFLICT DO NOTHING;

COMMIT;
