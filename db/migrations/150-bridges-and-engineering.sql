-- 150: Bridges & engineering marvels, a kind of place (#1860, ADR-0131)
--
-- A bridge, an aqueduct, a dam, a canal or a tunnel a traveller goes to or
-- through for itself -- the Charles Bridge, the Pont du Gard, the Hoover Dam,
-- the Panama Canal, the Channel Tunnel -- had no list: no kind offered the
-- Golden Gate Bridge or Tower Bridge. Kind and source 8 are new. The source
-- decides from the place pass's gather, which source 3 reads (ADR-0132
-- decision 5), so it reads Wikidata through source 3's door, and its arrivals
-- are gated, like every kind's seeded since Places of worship (ADR-0025).
--
-- `01-schema.sql` seeds the same rows for a fresh database.
--
-- Re-runnable: both seeds are guarded by their name.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (8, 'Bridges & engineering marvels', 8)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_sources
    (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id, wikidata_reader)
VALUES (
    8,
    'Bridges & engineering marvels',
    'Bridges, aqueducts, dams, canals and tunnels a traveller goes to or through, worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    8,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Bridges & engineering marvels'),
    COALESCE((SELECT wikidata_reader FROM experience_sources WHERE id = 3), 'live')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

COMMIT;
