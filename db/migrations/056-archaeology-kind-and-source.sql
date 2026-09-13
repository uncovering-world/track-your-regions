-- 056-archaeology-kind-and-source.sql
--
-- The fifth kind and its source (#581, ADR-0058): Archaeology, sites and
-- museums in one list, filled from Wikidata. For a database that already holds
-- a catalogue, which 01-schema.sql's seeds do not reach until the file is
-- re-applied. Re-runnable: both inserts are guarded by their name.
--
-- Two lines on the source row, not one (ADR-0058 decision 5): places enter at
-- 22 and stay to 18; a find, which has fewer Wikipedia articles than the
-- museum that holds it, enters at 18 and stays to 15. The source arrives gated
-- (ADR-0025) and its first live run waits for the site door (decision 7).

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (5, 'Archaeology', 5)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_sources (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    5,
    'Archaeology',
    'Archaeological sites and archaeology museums the world knows, and the finds inside the museums, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"enterSitelinks": 22, "staySitelinks": 18, "findEnterSitelinks": 18, "findStaySitelinks": 15}'::jsonb,
    5,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Archaeology')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

COMMIT;
