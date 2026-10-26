-- 175-a-source-reports-its-wikipedia-article.sql
--
-- The Wikipedia article becomes a field of a source's view of the place
-- (#1975): each membership records the article its source last reported
-- (reported_wikipedia_url), and two standing views under different ids that
-- link different articles are a question for a curator, as for the picture.
-- Until now the last run to write decided: the Statue of Liberty, which the
-- World Heritage list knows as Liberty Island and the Wikidata kinds as the
-- statue, links Liberty_Island, and the runs of Public art and Monuments &
-- memorials propose Statue_of_Liberty on every pass.
--
-- The column is filled with what each membership's source last said, so the
-- question is asked on the first read rather than after the next runs:
--   - the newest change record of that source for that id that names the
--     article: its proposed value, written or not, is what the source sent;
--   - otherwise the article of the place the source brought under that id,
--     which a merge keeps on the folded place;
--   - otherwise the article of the place the membership belongs to: a source
--     that never proposed another article agreed with it.
-- A run of the source writes the column again, whatever this file guessed.
--
-- Re-runnable: the column is added if missing, the two checks are replaced,
-- and only an empty column filled.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_wikipedia_url TEXT;
COMMENT ON COLUMN experience_kind_memberships.reported_wikipedia_url IS 'The Wikipedia article this membership''s source last reported for the place, the shape of metadata.wikipediaUrl (its view, #1975): two sources of one place under different ids that link different articles are asked about, as for the picture.';

-- A curator's choice and Jev's suggestion are recorded by view word.
ALTER TABLE experience_view_choices DROP CONSTRAINT IF EXISTS experience_view_choices_field_check;
ALTER TABLE experience_view_choices ADD CONSTRAINT experience_view_choices_field_check
  CHECK (field IN ('name', 'subtitle', 'imageUrl', 'location', 'wikipediaUrl'));
ALTER TABLE experience_view_suggestions DROP CONSTRAINT IF EXISTS experience_view_suggestions_field_check;
ALTER TABLE experience_view_suggestions ADD CONSTRAINT experience_view_suggestions_field_check
  CHECK (field IN ('name', 'subtitle', 'imageUrl', 'location', 'wikipediaUrl'));

-- The newest record of each source and id that names the article.
CREATE TEMP TABLE reported ON COMMIT DROP AS
SELECT DISTINCT ON (l.source_id, ch.external_id)
       l.source_id, ch.external_id, f->'new' AS new
  FROM experience_sync_changes ch
  JOIN experience_sync_logs l ON l.id = ch.sync_log_id
 CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
 WHERE jsonb_typeof(ch.changed_fields) = 'array'
   AND f->>'field' = 'metadata.wikipediaUrl'
 ORDER BY l.source_id, ch.external_id, ch.id DESC;

WITH value AS (
  SELECT m.id,
         CASE WHEN r.source_id IS NOT NULL
                THEN CASE WHEN jsonb_typeof(r.new) = 'string' THEN r.new #>> '{}' END
              ELSE COALESCE((SELECT origin.metadata->>'wikipediaUrl' FROM experiences origin
                              WHERE origin.source_id = m.source_id AND origin.external_id = m.external_id),
                            e.metadata->>'wikipediaUrl')
         END AS article
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id
    LEFT JOIN reported r ON r.source_id = m.source_id AND r.external_id = m.external_id
   WHERE m.reported_wikipedia_url IS NULL
)
UPDATE experience_kind_memberships m
   SET reported_wikipedia_url = NULLIF(v.article, '')
  FROM value v
 WHERE m.id = v.id AND NULLIF(v.article, '') IS NOT NULL;

COMMIT;
