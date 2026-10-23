-- 160-a-kind-keeps-a-monuments-year-it-never-reads.sql
--
-- A Wikidata kind that never reads a monument's year or makers writes them as
-- the place holds them while a kind that reads them holds the place (#1879,
-- `SOURCE_OWN_METADATA` in `fieldFamilies.ts`). The runs before it filed the
-- absence as a removal and held it for a curator: on the development catalogue
-- on 2026-10-23, 21 open held cards held nothing but such a removal, Charminar's
-- 1591 under Places of worship among them (17 by Places of worship, 3 by
-- Archaeology, 1 by Art Museums).
--
-- This file closes those cards as the source's next run would. The run now
-- proposes nothing about the key and clears the membership's pointer, which is
-- what takes the card away, and the earlier run's record stays in its log as
-- that run filed it. A card is closed when:
--   - its run's source reads neither key (Art Museums, Places of worship,
--     Archaeology);
--   - every field it holds is the removal of `metadata.year` or
--     `metadata.creators`, and it holds nothing about the place's points or
--     works;
--   - a kind that reads them (Public art, Monuments & memorials, Towers,
--     Bridges & engineering marvels, Squares & streets) still holds the place,
--     its membership standing as `viewStandsSql` says;
--   - the place still holds the key, and no curator claims or answered it.
--
-- Re-runnable: a closed card has no pointer.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE card ON COMMIT DROP AS
SELECT m.id AS membership_id, ch.id AS change_id, e.id AS experience_id
  FROM experience_kind_memberships m
  JOIN experience_sync_changes ch ON ch.experience_id = m.experience_id
                                 AND ch.sync_log_id = m.pending_change_sync_log_id
  JOIN experiences e ON e.id = m.experience_id
 WHERE m.source_id IN (2, 4, 5)
   AND jsonb_typeof(ch.changed_fields) = 'array';

CREATE TEMP TABLE closing ON COMMIT DROP AS
SELECT c.* FROM card c
  JOIN experience_sync_changes ch ON ch.id = c.change_id
  JOIN experiences e ON e.id = c.experience_id
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ch.changed_fields) f
                WHERE COALESCE((f->>'held')::boolean, false))
   AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(ch.changed_fields) f
          WHERE COALESCE((f->>'held')::boolean, false)
            AND NOT (f->>'field' IN ('metadata.year', 'metadata.creators') AND NOT f ? 'new'
                     AND COALESCE(e.metadata, '{}'::jsonb) ? substr(f->>'field', length('metadata.') + 1)
                     AND NOT e.curated_fields ? (f->>'field')
                     AND NOT EXISTS (SELECT 1 FROM experience_held_decisions d
                                      WHERE d.experience_id = c.experience_id AND d.part_kind IS NULL
                                        AND d.field = f->>'field')))
   AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(ch.contents -> 'locations' -> 'changed', '[]'::jsonb)
                                            || COALESCE(ch.contents -> 'treasures' -> 'changed', '[]'::jsonb)) item
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(item -> 'fields', '[]'::jsonb)) f
          WHERE COALESCE((f->>'held')::boolean, false))
   AND EXISTS (SELECT 1 FROM experience_kind_memberships w
                WHERE w.experience_id = c.experience_id AND w.source_id IN (3, 6, 7, 8, 9)
                  AND w.missing_since IS NULL AND w.source_membership = 'present');

SELECT (SELECT count(*) FROM card) AS open_cards_of_those_sources,
       (SELECT count(*) FROM closing) AS cards_closed;

UPDATE experience_kind_memberships m
   SET pending_change_sync_log_id = NULL, updated_at = NOW()
  FROM closing c
 WHERE m.id = c.membership_id;

COMMIT;
