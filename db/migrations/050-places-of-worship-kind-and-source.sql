-- 050-places-of-worship-kind-and-source.sql
--
-- The fourth kind and its source (#753, ADR-0052): Places of worship, filled
-- from Wikidata through two doors -- a place the world knows by its own
-- Wikipedia languages, and a place holding a work the world knows. For a
-- database that already holds a catalogue, which 01-schema.sql's seeds do
-- not reach until the file is re-applied. Re-runnable: both inserts are
-- guarded by their name.
--
-- The line is on the source row, not in code: enterSitelinks and
-- staySitelinks in api_config, 22 and 18 as the two Wikidata kinds before it
-- use, edited from the admin panel. The source arrives gated (ADR-0025).

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (4, 'Places of worship', 4)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_categories (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    4,
    'Places of worship',
    'Cathedrals, churches, mosques, temples and shrines the world knows, and the works inside them, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0", "enterSitelinks": 22, "staySitelinks": 18}'::jsonb,
    4,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Places of worship')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_categories_id_seq', GREATEST((SELECT MAX(id) FROM experience_categories), 1));

COMMIT;
