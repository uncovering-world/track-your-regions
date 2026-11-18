-- 266-the-model-carries-todays-rows.sql
--
-- The clean catalogue model, additive half, step 4 of 4 (#2634): fills the
-- columns and tables of 264 and 265 whose value today's rows already state,
-- each by the rule the model (#2634) gives it. Nothing of today's code
-- reads what this file writes, so no reader answers differently after it.
--
-- * experience_kinds.list_kept_outside for World Heritage Sites (the constant
--   KINDS_KEPT_AS_FORMER becomes data), experience_sources.licence for the
--   eleven seeded sources, and Art Museums' work line, 22 and 18 editions
--   (ADR-0023 decision 2).
-- * experience_rejections.rejected_at from created_at, the column it
--   replaces.
-- * world_views.finalized_at from a source_type the import finalised
--   ('wikivoyage_done'), at the row's updated_at.
-- * experience_sync_bars from experience_sync_logs.world_bars: a run's world
--   bars, each an entering bar of its source's kind, with the readership year
--   and the run whose readers' bars it kept (ADR-0175 decision 6).
-- * record_heritage_inscriptions and record_danger_periods from the World
--   Heritage memberships' facts: the criteria, the area, transboundary and the
--   region; a current Danger List stay as an open period from its year
--   (Aleppo, "Y 2013"), closed once the facts no longer read it. The dataset
--   states no stay that ended, so none is written with its end: Cologne
--   Cathedral's 2004 to 2006 and Liverpool's 2012 to 2021 are carried by the
--   slice of #2458 that reads Wikidata's statements.
-- * record_listings: each World Heritage membership's listing, from its year
--   of inscription, open where the source still lists it and ended
--   ('delisted') where it is former; a former membership with no year gets a
--   listing with no start. Its end date is not known here.
-- * experience_websites from metadata.website, and experiences.wikipedia_url,
--   unesco_url and sitelinks_count from their metadata keys, each where the
--   value fits the column's rule.
-- * treasures.found_at_item and found_at_label from metadata.foundAt, and
--   made_year from year.
-- * source_records.admitted_for_item and admitted_for_label from
--   admitted_for, and admission_decided_at from admission_answered_at.
-- * user_visit_trips.first_day and last_day: a trip's outer days.
--
-- What today's writers keep writing after this file runs (the facts, the
-- metadata keys, admitted_for, a new trip, a new rejection) is carried again
-- by the slice that moves the writer, which runs this file's statements once
-- more before its code serves: every statement here is re-runnable and writes
-- only a row that differs. Nothing here writes a column of today or deletes a
-- row of today's tables: a Danger List stay the facts no longer read is
-- closed, and only experience_websites, which holds nothing but this carry's
-- rows, loses one its source no longer states. What needs a person's word or
-- a record that does not exist yet (the outlines' views, the dedications, the
-- curator's lost places, the point tables) is carried by its own slice of
-- #2458.
--
-- Row writes only: the shape changes are 264's and 265's, so no ALTER meets a
-- pending deferred trigger event (db/migrations/README.md); the deferred
-- trigger the Danger List stays' writes fire (trg_danger_periods_hold) runs at
-- the commit.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Kinds and sources ---------------------------------------------------------

UPDATE experience_kinds SET list_kept_outside = true WHERE id = 1 AND NOT list_kept_outside;

UPDATE experience_sources
   SET licence = CASE WHEN id IN (1, 10) THEN 'CC BY-SA 4.0' WHEN id = 11 THEN 'own' ELSE 'CC0 1.0' END
 WHERE licence IS NULL AND id BETWEEN 1 AND 11;

UPDATE experience_sources SET work_enter_editions = 22, work_stay_editions = 18
 WHERE id = 2 AND work_enter_editions IS NULL;

-- Curators' rows ------------------------------------------------------------

UPDATE experience_rejections SET rejected_at = created_at
 WHERE created_at IS NOT NULL AND rejected_at IS DISTINCT FROM created_at;

UPDATE world_views SET finalized_at = COALESCE(updated_at, created_at, now())
 WHERE source_type LIKE '%\_done' AND finalized_at IS NULL;

-- A run's world bars ----------------------------------------------------------

INSERT INTO experience_sync_bars (sync_log_id, kind_id, tier, signal, statistic, value, readers_year, kept_from_sync_log_id)
SELECT l.id, s.kind_id, 'world', b.signal, 'enter', b.value, b.readers_year,
       CASE WHEN EXISTS (SELECT 1 FROM experience_sync_logs k WHERE k.id = b.kept_from) THEN b.kept_from END
  FROM experience_sync_logs l
  JOIN experience_sources s ON s.id = l.source_id AND s.kind_id IS NOT NULL
 CROSS JOIN LATERAL (VALUES
        ('editions', CASE WHEN jsonb_typeof(l.world_bars->'editions') = 'number' THEN (l.world_bars->>'editions')::real END,
         NULL::smallint, NULL::integer),
        ('readers', CASE WHEN jsonb_typeof(l.world_bars->'readers') = 'number' THEN (l.world_bars->>'readers')::real END,
         substring(l.world_bars->>'year' FROM '^([0-9]{4})')::smallint,
         CASE WHEN jsonb_typeof(l.world_bars->'keptFrom') = 'number' THEN (l.world_bars->>'keptFrom')::integer END),
        ('guides', CASE WHEN jsonb_typeof(l.world_bars->'guidedReaders') = 'number' THEN (l.world_bars->>'guidedReaders')::real END,
         NULL::smallint,
         CASE WHEN jsonb_typeof(l.world_bars->'keptFrom') = 'number' THEN (l.world_bars->>'keptFrom')::integer END)
       ) AS b(signal, value, readers_year, kept_from)
 WHERE jsonb_typeof(l.world_bars) = 'object' AND b.value IS NOT NULL AND b.value >= 0
ON CONFLICT (sync_log_id, kind_id, tier, signal, statistic) DO UPDATE
   SET value = EXCLUDED.value, readers_year = EXCLUDED.readers_year,
       kept_from_sync_log_id = EXCLUDED.kept_from_sync_log_id
 WHERE (experience_sync_bars.value, experience_sync_bars.readers_year, experience_sync_bars.kept_from_sync_log_id)
       IS DISTINCT FROM (EXCLUDED.value, EXCLUDED.readers_year, EXCLUDED.kept_from_sync_log_id);

-- A World Heritage membership's facts -------------------------------------------

INSERT INTO record_heritage_inscriptions (record_id, criteria, area_ha, transboundary, unesco_region)
SELECT r.id,
       NULLIF(ARRAY(SELECT m[1] FROM regexp_matches(COALESCE(r.facts->>'criteria', ''),
                                                    '(\((?:viii|vii|vi|iv|v|ix|x|iii|ii|i)\))', 'g') AS m), '{}')::varchar(6)[],
       CASE WHEN r.facts->>'areaHectares' ~ '^[0-9]+(\.[0-9]+)?$' AND (r.facts->>'areaHectares')::numeric > 0
             AND (r.facts->>'areaHectares')::numeric < 1e12
            THEN round((r.facts->>'areaHectares')::numeric, 2) END,
       COALESCE(CASE WHEN jsonb_typeof(r.facts->'transboundary') = 'boolean' THEN (r.facts->>'transboundary')::boolean END, false),
       CASE WHEN r.facts->>'region' IN ('Africa', 'Arab States', 'Asia and the Pacific', 'Europe and North America',
                                        'Latin America and the Caribbean') THEN r.facts->>'region' END
  FROM source_records r
  JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
 WHERE r.source_id = 1
   AND r.facts ?| ARRAY['criteria', 'areaHectares', 'transboundary', 'region']
ON CONFLICT (record_id) DO UPDATE
   SET criteria = EXCLUDED.criteria, area_ha = EXCLUDED.area_ha, transboundary = EXCLUDED.transboundary,
       unesco_region = EXCLUDED.unesco_region
 WHERE (record_heritage_inscriptions.criteria, record_heritage_inscriptions.area_ha,
        record_heritage_inscriptions.transboundary, record_heritage_inscriptions.unesco_region)
       IS DISTINCT FROM (EXCLUDED.criteria, EXCLUDED.area_ha, EXCLUDED.transboundary, EXCLUDED.unesco_region);

-- A current stay on the Danger List: "Y 2013" is open since 2013; "Y" with no
-- year, or no field and the importer's inDanger flag, is open since a date
-- not known. "N" or nothing writes no stay. Until its slice of #2458 the
-- dataset is the only word on a UNESCO stay no curator decided, so a re-run
-- follows it, in four steps that never delete a stay: a stay the facts no
-- longer read is closed (ended, its end not known); the last stay, closed so
-- and of the same year, opens again when the facts read it again; an open
-- stay takes the year the facts now give; and a site that reads in danger
-- with no open stay gets one after the stays it holds (a re-entry that would
-- overlap one waits for the slice that reads the stays' dates from Wikidata).
UPDATE record_danger_periods p SET ended = true
 WHERE p.source_id = 1 AND p.decided_at IS NULL AND NOT p.ended
   AND NOT EXISTS (SELECT 1 FROM source_records r
                    WHERE r.id = p.record_id
                      AND (r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$'
                           OR (r.facts->'dangerList' IS NULL OR jsonb_typeof(r.facts->'dangerList') = 'null')
                              AND r.facts->'inDanger' = 'true'::jsonb));

UPDATE record_danger_periods p SET ended = false
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND (r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$'
                OR (r.facts->'dangerList' IS NULL OR jsonb_typeof(r.facts->'dangerList') = 'null')
                   AND r.facts->'inDanger' = 'true'::jsonb)) d
 WHERE p.record_id = d.id AND p.source_id = 1 AND p.decided_at IS NULL AND p.ended AND p.until_year IS NULL
   AND (d.y IS NULL OR p.from_year IS NOT DISTINCT FROM d.y)
   AND p.ordinal = (SELECT max(s.ordinal) FROM record_danger_periods s WHERE s.record_id = p.record_id)
   AND NOT EXISTS (SELECT 1 FROM record_danger_periods o WHERE o.record_id = p.record_id AND NOT o.ended);

UPDATE record_danger_periods p SET from_year = d.y, from_first = day_index(d.y, 1, 1)
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND (r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$'
                OR (r.facts->'dangerList' IS NULL OR jsonb_typeof(r.facts->'dangerList') = 'null')
                   AND r.facts->'inDanger' = 'true'::jsonb)) d
 WHERE p.record_id = d.id AND d.y IS NOT NULL
   AND p.source_id = 1 AND p.decided_at IS NULL AND NOT p.ended
   AND p.from_year IS DISTINCT FROM d.y;

INSERT INTO record_danger_periods (record_id, ordinal, from_year, from_first, ended, source_id)
SELECT d.id, COALESCE(prev.last_ordinal, 0) + 1, d.y, day_index(d.y, 1, 1), false, 1
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND (r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$'
                OR (r.facts->'dangerList' IS NULL OR jsonb_typeof(r.facts->'dangerList') = 'null')
                   AND r.facts->'inDanger' = 'true'::jsonb)) d
 CROSS JOIN LATERAL (SELECT max(s.ordinal) AS last_ordinal, max(COALESCE(s.until_last, s.from_first)) AS last_day,
                            bool_or(NOT s.ended) AS open
                       FROM record_danger_periods s WHERE s.record_id = d.id) prev
 WHERE NOT COALESCE(prev.open, false)
   AND (prev.last_ordinal IS NULL OR (d.y IS NOT NULL AND day_index(d.y, 1, 1) > prev.last_day))
ON CONFLICT (record_id, ordinal) DO NOTHING;

-- The listing: from the year of inscription; ended where the list no longer
-- names the site.
INSERT INTO record_listings (record_id, ordinal, from_year, from_first, ended, ending, source_id)
SELECT l.id, 1, l.y, day_index(l.y, 1, 1), l.former, CASE WHEN l.former THEN 'delisted' END, 1
  FROM (SELECT r.id, substring(r.facts->>'dateInscribed' FROM '^\s*([0-9]{4})')::integer AS y,
               r.source_membership = 'former' AS former
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1) l
 WHERE l.y IS NOT NULL OR l.former
ON CONFLICT (record_id, ordinal) DO UPDATE
   SET from_year = EXCLUDED.from_year, from_first = EXCLUDED.from_first,
       ended = EXCLUDED.ended, ending = EXCLUDED.ending, updated_at = now()
 WHERE record_listings.source_id = 1 AND record_listings.decided_at IS NULL
   AND (record_listings.from_year, record_listings.ended, record_listings.ending)
       IS DISTINCT FROM (EXCLUDED.from_year, EXCLUDED.ended, EXCLUDED.ending);

-- What a record holds beside its row ------------------------------------------

-- experience_websites holds only this carry's rows until the slice of #2458
-- that moves the website writer, which runs it for the last time before its
-- code serves; so a re-run mirrors metadata.website: a row the place's
-- metadata no longer states is removed, then the one it states is written.
DELETE FROM experience_websites w
 WHERE NOT EXISTS (SELECT 1 FROM experiences e
                    WHERE e.id = w.experience_id
                      AND jsonb_typeof(e.metadata->'website') = 'string'
                      AND btrim(e.metadata->>'website') = w.url);

INSERT INTO experience_websites (experience_id, url, ordinal)
SELECT e.id, btrim(e.metadata->>'website'), 0
  FROM experiences e
 WHERE jsonb_typeof(e.metadata->'website') = 'string'
   AND btrim(e.metadata->>'website') ~ '^https?://[^ ]+$'
   AND length(btrim(e.metadata->>'website')) <= 1000
   AND btrim(e.metadata->>'website') !~* '^https?://([a-z0-9-]+\.)*whc\.unesco\.org'
ON CONFLICT (experience_id, url) DO NOTHING;

UPDATE experiences e
   SET wikipedia_url = w.wikipedia_url, unesco_url = w.unesco_url, sitelinks_count = w.sitelinks_count
  FROM (SELECT x.id,
               CASE WHEN x.metadata->>'wikipediaUrl' ~ '^https://[a-z-]+\.wikipedia\.org/wiki/.+'
                     AND length(x.metadata->>'wikipediaUrl') <= 1000 THEN x.metadata->>'wikipediaUrl' END AS wikipedia_url,
               CASE WHEN x.metadata->>'unescoUrl' ~ '^https?://whc\.unesco\.org/.+'
                     AND length(x.metadata->>'unescoUrl') <= 1000 THEN x.metadata->>'unescoUrl' END AS unesco_url,
               CASE WHEN jsonb_typeof(x.metadata->'sitelinksCount') = 'number'
                     AND (x.metadata->>'sitelinksCount')::numeric BETWEEN 0 AND 2147483647
                    THEN (x.metadata->>'sitelinksCount')::numeric::integer END AS sitelinks_count
          FROM experiences x
         WHERE x.metadata ?| ARRAY['wikipediaUrl', 'unescoUrl', 'sitelinksCount']) w
 WHERE e.id = w.id
   AND (e.wikipedia_url, e.unesco_url, e.sitelinks_count) IS DISTINCT FROM (w.wikipedia_url, w.unesco_url, w.sitelinks_count);

-- Works -----------------------------------------------------------------------

UPDATE treasures
   SET found_at_item = metadata->'foundAt'->>'qid',
       found_at_label = left(COALESCE(NULLIF(btrim(metadata->'foundAt'->>'label'), ''), metadata->'foundAt'->>'qid'), 500)
 WHERE jsonb_typeof(metadata->'foundAt') = 'object'
   AND metadata->'foundAt'->>'qid' ~ '^Q[1-9][0-9]*$'
   AND (found_at_item, found_at_label) IS DISTINCT FROM
       (metadata->'foundAt'->>'qid',
        left(COALESCE(NULLIF(btrim(metadata->'foundAt'->>'label'), ''), metadata->'foundAt'->>'qid'), 500));

UPDATE treasures SET made_year = year
 WHERE year IS NOT NULL AND year <> 0 AND year >= -200000 AND made_year IS DISTINCT FROM year;

-- Memberships -------------------------------------------------------------------

UPDATE source_records
   SET admitted_for_item = admitted_for->>'qid',
       admitted_for_label = COALESCE(NULLIF(btrim(admitted_for->>'label'), ''), admitted_for->>'qid')
 WHERE jsonb_typeof(admitted_for) = 'object'
   AND admitted_for->>'qid' ~ '^Q[1-9][0-9]*$'
   AND kind_id IS NOT NULL
   AND (admitted_for_item, admitted_for_label) IS DISTINCT FROM
       (admitted_for->>'qid', COALESCE(NULLIF(btrim(admitted_for->>'label'), ''), admitted_for->>'qid'));

UPDATE source_records SET admission_decided_at = admission_answered_at
 WHERE admission_answered_at IS NOT NULL AND admission_decided_at IS DISTINCT FROM admission_answered_at;

-- A trip's outer days ---------------------------------------------------------------

UPDATE user_visit_trips
   SET first_day = date_first(year::integer, month, day, NULL),
       last_day = date_last(year::integer, month, day, NULL)
 WHERE (first_day, last_day) IS DISTINCT FROM
       (date_first(year::integer, month, day, NULL), date_last(year::integer, month, day, NULL));

COMMIT;
