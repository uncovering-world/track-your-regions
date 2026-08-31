-- 040: A work names every one of its makers (#720, ADR-0040)
--
-- `treasures.artist` held one name where the source often gives several, and
-- which one it held was an accident of which row the endpoint answered with
-- first. Museum run 64 rewrote 22 attributions on this database, and every one
-- of them is a work with more than one creator: Shishkin to Savitsky, Bellini
-- to Titian, Hals to Codde, Athanadoros to Polydoros.
--
-- This converts four stores in one pass, because they name the same field and a
-- half-converted set is worse than either end of it:
--
--   1. the column, `artist` -> `artists`;
--   2. the claims that name it, `treasures.curated_fields`;
--   3. the change records that carry it, `experience_sync_changes.contents` —
--      20 of them here, and an unconverted one lands in publishHeldParts's
--      `unwritable` and refuses the whole card it belongs to;
--   4. the answers to those records, `experience_held_decisions`, whose match is
--      the field name *and* the value, so a converted record beside an
--      unconverted answer asks a curator a question they already answered.
--
-- ...and the same four on public art, where a monument's creator lives in
-- `experiences.metadata` and is an *object* field rather than a part's: the row,
-- the claim, the `changed_fields` entries that name it, and the answers to those
-- under `part_kind IS NULL`.
--
-- `experience_curation_log` is deliberately left alone. It records what a
-- curator did and what the field was called when they did it; rewriting an
-- audit trail to match today's schema is how a trail stops being one.
--
-- Order-independent with `01-schema.sql`: that file adds `artists` empty, this
-- fills it and drops `artist`, and each step is guarded so either order arrives
-- at the same place. Re-running it is a no-op.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

ALTER TABLE treasures ADD COLUMN IF NOT EXISTS artists VARCHAR(500)[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN treasures.artists IS 'Every creator the source names for the work. The stored order is not the source''s and asserts nothing; a curator confirms it by claiming the column (ADR-0040).';

-- Only where the old column is still here: on a second run there is nothing to
-- read from, and `artists` already holds the answer.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'treasures' AND column_name = 'artist') THEN
        EXECUTE $sql$
            UPDATE treasures
               SET artists = ARRAY[artist]::varchar(500)[]
             WHERE artist IS NOT NULL AND artists = '{}'
        $sql$;
    END IF;
END $$;

ALTER TABLE treasures DROP COLUMN IF EXISTS artist;

COMMENT ON COLUMN treasures.curated_fields IS 'Column names a curator has claimed on this work: name, artists, year, image_url. Not sitelinks_count or is_iconic, which are a measurement and a threshold rather than a judgement, and not external_id, which is identity.';

-- ---------------------------------------------------------------------------
-- 2. The claims that name it
-- ---------------------------------------------------------------------------

UPDATE treasures
   SET curated_fields = (curated_fields - 'artist') || '["artists"]'::jsonb
 WHERE curated_fields ? 'artist';

-- ---------------------------------------------------------------------------
-- 3. The change records that carry it
--
-- The value moves with the name: a proposal that said "Titian" now says
-- ["Titian"], because the column it is published into is a list. A missing or
-- JSON-null side becomes the empty list, which is what "no maker recorded" is
-- from here on. WITH ORDINALITY throughout, or the fields of a card would come
-- back in whatever order the aggregate happened to build them.
-- ---------------------------------------------------------------------------

UPDATE experience_sync_changes c
   SET contents = jsonb_set(
         c.contents,
         '{treasures,changed}',
         (SELECT jsonb_agg(
                   jsonb_set(entry, '{fields}', (
                     SELECT COALESCE(jsonb_agg(
                              CASE WHEN f->>'field' = 'artist'
                                   THEN f || jsonb_build_object(
                                          'field', 'artists',
                                          'old', CASE WHEN COALESCE(f->'old', 'null'::jsonb) = 'null'::jsonb
                                                      THEN '[]'::jsonb ELSE jsonb_build_array(f->'old') END,
                                          'new', CASE WHEN COALESCE(f->'new', 'null'::jsonb) = 'null'::jsonb
                                                      THEN '[]'::jsonb ELSE jsonb_build_array(f->'new') END)
                                   ELSE f END
                              ORDER BY field_ord), '[]'::jsonb)
                       FROM jsonb_array_elements(entry->'fields')
                            WITH ORDINALITY AS fields(f, field_ord)))
                   ORDER BY entry_ord)
            FROM jsonb_array_elements(c.contents->'treasures'->'changed')
                 WITH ORDINALITY AS entries(entry, entry_ord)))
 WHERE jsonb_path_exists(c.contents, '$.treasures.changed[*].fields[*] ? (@.field == "artist")');

-- ---------------------------------------------------------------------------
-- 4. The answers to those records
-- ---------------------------------------------------------------------------

UPDATE experience_held_decisions
   SET field = 'artists',
       value = CASE WHEN value = 'null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(value) END
 WHERE part_kind = 'treasures' AND field = 'artist';

-- ---------------------------------------------------------------------------
-- 5. Public art: a monument's makers, the same fact a table away
--
-- The key is renamed rather than widened in place. The object's metadata diff
-- compares per key, so a key that changed type under the same name would report
-- every monument as changed on the first run after this; converted here, the
-- run before and the run after both read `creators` and see nothing move.
--
-- Not filtered to the public-art category, though today that is exactly who
-- carries the key: 204 rows here, all of them category 3. A row of any other
-- source holding a `creator` is holding the same fact, and leaving it behind
-- would strand a key the card's vocabulary no longer has words for.
-- ---------------------------------------------------------------------------

UPDATE experiences
   SET metadata = (metadata - 'creator') || jsonb_build_object(
         'creators',
         CASE WHEN COALESCE(metadata->'creator', 'null'::jsonb) = 'null'::jsonb
              THEN '[]'::jsonb ELSE jsonb_build_array(metadata->'creator') END)
 WHERE metadata ? 'creator';

UPDATE experiences
   SET curated_fields = (curated_fields - 'metadata.creator') || '["metadata.creators"]'::jsonb
 WHERE curated_fields ? 'metadata.creator';

-- ...and the records and answers that name the key, for the reason steps 3 and 4
-- give: a field converted without them is a card that publishes the old key back.
-- A monument's creator is an *object* field, so it sits in `changed_fields` and
-- its answer under `part_kind IS NULL` — a different pair of stores from a work's,
-- and the same rule. Public art is gated, so the shape is live: publishing such a
-- card after this migration would run `metadataFromEntries` over `metadata.creator`
-- and leave the row holding a revived scalar `creator` beside `creators`, which
-- the next run would then report as a removal. Zero rows on this database, which
-- is why it was missed rather than why it can be skipped.
UPDATE experience_sync_changes c
   SET changed_fields = (
         SELECT COALESCE(jsonb_agg(
                  CASE WHEN f->>'field' = 'metadata.creator'
                       THEN f || jsonb_build_object(
                              'field', 'metadata.creators',
                              'old', CASE WHEN COALESCE(f->'old', 'null'::jsonb) = 'null'::jsonb
                                          THEN '[]'::jsonb ELSE jsonb_build_array(f->'old') END,
                              'new', CASE WHEN COALESCE(f->'new', 'null'::jsonb) = 'null'::jsonb
                                          THEN '[]'::jsonb ELSE jsonb_build_array(f->'new') END)
                       ELSE f END
                  ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(c.changed_fields) WITH ORDINALITY AS fields(f, ord))
 WHERE jsonb_path_exists(c.changed_fields, '$[*] ? (@.field == "metadata.creator")');

UPDATE experience_held_decisions
   SET field = 'metadata.creators',
       value = CASE WHEN value = 'null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(value) END
 WHERE part_kind IS NULL AND field = 'metadata.creator';

-- ---------------------------------------------------------------------------
-- 6. The audit action the curator's work edit records
-- ---------------------------------------------------------------------------

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited'));

COMMIT;
