-- 174-a-credit-a-place-holds-none-of-passes-the-gate.sql
--
-- The credit of the picture a place already shows passes the curation gate
-- where the place holds no credit (#1966, ADR-0151). The runs before it held
-- that credit for a curator: on the development catalogue on 2026-10-25, seven
-- open held cards proposed a credit where the place held none: Hollywood Walk
-- of Fame's and the National Museum of Denmark's held nothing else. This file
-- writes those credits, as the run would now.
--
-- A held credit passes when:
--   - the place holds no credit now;
--   - the card proposes no other picture (no `imageUrl` among its fields), and
--     the place still shows the one the card's source reports: a credit names
--     no file, so a place whose picture another source has since replaced
--     keeps its question;
--   - the credit names a licence;
--   - no curator claims the place's picture, and none refused this credit: a
--     curator's claim and refusal stand (ADR-0029). A credit a curator
--     published and that is still unwritten is written: the National Museum of
--     Denmark's was published on 2026-10-03 and asked again by every
--     Archaeology run since, with the card hiding it as answered.
-- A place two cards propose a credit for takes the newest card's, and the
-- other card's credit passes only when it is the same credit.
--
-- The change record is brought to what the run now files: the credit is no
-- longer held, and carries its class (`passedTheGate: same-file-credit`). A
-- card that asked nothing else closes and its record is an update; a card that
-- holds anything else, or a field a curator's claim refused, keeps its pointer.
--
-- Re-runnable: a written credit is no longer held, and the place then holds one.

\set ON_ERROR_STOP on

BEGIN;

-- The open held cards, each a membership's pointer at its run's record.
CREATE TEMP TABLE card ON COMMIT DROP AS
SELECT m.id AS membership_id, ch.id AS change_id, e.id AS experience_id, m.reported_image_url
  FROM experience_kind_memberships m
  JOIN experience_sync_changes ch ON ch.experience_id = m.experience_id
                                 AND ch.sync_log_id = m.pending_change_sync_log_id
  JOIN experiences e ON e.id = m.experience_id;

-- The held credits of those cards that pass.
CREATE TEMP TABLE credit ON COMMIT DROP AS
SELECT c.change_id, c.experience_id, f->'new' AS new
  FROM card c
  JOIN experience_sync_changes ch ON ch.id = c.change_id
  JOIN experiences e ON e.id = c.experience_id
  CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
 WHERE jsonb_typeof(ch.changed_fields) = 'array'
   AND f->>'field' = 'metadata.imageCredit'
   AND COALESCE((f->>'held')::boolean, false)
   AND COALESCE(f->'old', 'null'::jsonb) = 'null'::jsonb
   AND jsonb_typeof(f->'new') = 'object'
   AND jsonb_typeof(f->'new'->'license') = 'string' AND f->'new'->>'license' <> ''
   AND COALESCE(e.metadata->'imageCredit', 'null'::jsonb) = 'null'::jsonb
   AND e.image_url IS NOT NULL
   AND c.reported_image_url = e.image_url
   AND NOT e.curated_fields ? 'image_url'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ch.changed_fields) AS g
                    WHERE g->>'field' = 'imageUrl')
   AND NOT EXISTS (SELECT 1 FROM experience_held_decisions d
                    WHERE d.experience_id = c.experience_id AND d.part_kind IS NULL
                      AND d.field = 'metadata.imageCredit' AND d.answer = 'refused'
                      AND d.value = f->'new');

-- The credit each place takes: its newest card's.
CREATE TEMP TABLE chosen ON COMMIT DROP AS
SELECT DISTINCT ON (experience_id) experience_id, new
  FROM credit
 ORDER BY experience_id, change_id DESC;

-- The cards whose credit is the one written.
CREATE TEMP TABLE passed ON COMMIT DROP AS
SELECT cr.change_id
  FROM credit cr JOIN chosen ch USING (experience_id)
 WHERE cr.new = ch.new;

-- The passed cards that asked nothing else, the place's or its parts': a
-- field held by the gate and a field a curator's claim refused both keep the
-- card open, as the run's pointer does.
CREATE TEMP TABLE closing ON COMMIT DROP AS
SELECT c.* FROM card c
  JOIN passed p USING (change_id)
  JOIN experience_sync_changes ch ON ch.id = c.change_id
 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ch.changed_fields) AS f
                    WHERE (COALESCE((f->>'held')::boolean, false)
                           OR COALESCE((f->>'curatedConflict')::boolean, false))
                      AND f->>'field' <> 'metadata.imageCredit')
   AND NOT EXISTS (SELECT 1
                     FROM (VALUES ('locations'), ('treasures')) AS k(kind)
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch.contents -> k.kind -> 'changed', '[]'::jsonb)) AS item
                    CROSS JOIN LATERAL jsonb_array_elements(item -> 'fields') AS g
                    WHERE COALESCE((g->>'held')::boolean, false)
                       OR COALESCE((g->>'curatedConflict')::boolean, false));

SELECT (SELECT count(*) FROM chosen) AS credits_written,
       (SELECT count(*) FROM passed) AS records_passed,
       (SELECT count(*) FROM closing) AS cards_closed;

UPDATE experiences e
   SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('imageCredit', ch.new),
       updated_at = NOW()
  FROM chosen ch
 WHERE e.id = ch.experience_id;

-- The record, as the run now files it.
UPDATE experience_sync_changes ch
   SET changed_fields = (
         SELECT jsonb_agg(CASE
                  WHEN f->>'field' = 'metadata.imageCredit' AND COALESCE((f->>'held')::boolean, false)
                    THEN f || jsonb_build_object('held', false, 'passedTheGate', 'same-file-credit')
                  ELSE f END ORDER BY n)
           FROM jsonb_array_elements(ch.changed_fields) WITH ORDINALITY AS t(f, n))
  FROM passed p
 WHERE ch.id = p.change_id;

UPDATE experience_sync_changes ch SET change_type = 'updated'
  FROM closing c
 WHERE ch.id = c.change_id AND ch.change_type = 'held';

UPDATE experience_kind_memberships m
   SET pending_change_sync_log_id = NULL, updated_at = NOW()
  FROM closing c
 WHERE m.id = c.membership_id;

COMMIT;
