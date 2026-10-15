-- 106-a-year-before-the-era-is-the-items-own.sql
--
-- The query service numbers a year before the common era astronomically when
-- the date's precision is a year or finer (a month, a day): 250 BCE, `-0250`
-- in Wikidata's own JSON, is `YEAR()` -249 there (#1531). A dated decade,
-- century or coarser is not shifted. Every year a live run stored for such a
-- date is therefore one year late, while a run on the local subset reads the
-- item's own year. Switching a works kind to the subset would offer each of
-- them to a curator as a change.
--
-- This corrects the stored year to the item's own where the subset holds the
-- item, its first best-rank inception (P571) has year precision or finer, and
-- the stored year is exactly one more than that inception's year before the
-- era: a work's year, unless a curator claims it, and a place's metadata year,
-- unless a curator claims `metadata.year`. Nothing else is touched. A database
-- without a subset built corrects nothing; the subset's runs store the right
-- year from then on. Re-runnable: a corrected year no longer matches.

\set ON_ERROR_STOP on

BEGIN;

-- Only the items a stored year before the era names are read, by their key:
-- the entities table holds tens of millions of rows.
CREATE TEMP TABLE item_bce_year ON COMMIT DROP AS
WITH stored AS (
  SELECT external_id AS id FROM treasures WHERE year < 0
  UNION
  SELECT m.external_id
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id
   WHERE e.metadata ->> 'year' ~ '^-[0-9]+$'
)
SELECT w.id, first.year
  FROM stored
  JOIN wikidata_entities w ON w.id = stored.id
 CROSS JOIN LATERAL (
   SELECT (substring(s.statement -> 'value' ->> 'time' FROM '^(-[0-9]+)-'))::bigint AS year,
          (s.statement -> 'value' ->> 'precision')::int AS precision
     FROM jsonb_array_elements(w.entity -> 'claims' -> 'P571') WITH ORDINALITY AS s(statement, n)
    WHERE s.statement -> 'value' ? 'time'
      AND s.statement ->> 'rank' IS DISTINCT FROM 'deprecated'
      AND (s.statement ->> 'rank' = 'preferred'
           OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w.entity -> 'claims' -> 'P571') p
                           WHERE p ->> 'rank' = 'preferred'))
    ORDER BY s.n
    LIMIT 1
 ) first
 WHERE w.entity -> 'claims' ? 'P571'
   AND first.year IS NOT NULL
   AND first.precision >= 9;

UPDATE treasures t
   SET year = i.year
  FROM item_bce_year i
 WHERE i.id = t.external_id
   AND t.year = i.year + 1
   AND NOT (COALESCE(t.curated_fields, '[]'::jsonb) ? 'year');

UPDATE experiences e
   SET metadata = jsonb_set(e.metadata, '{year}', to_jsonb(i.year))
  FROM experience_kind_memberships m
  JOIN item_bce_year i ON i.id = m.external_id
 WHERE m.experience_id = e.id
   AND e.metadata ->> 'year' ~ '^-[0-9]+$'
   AND (e.metadata ->> 'year')::bigint = i.year + 1
   AND NOT (COALESCE(e.curated_fields, '[]'::jsonb) ? 'metadata.year');

COMMIT;
