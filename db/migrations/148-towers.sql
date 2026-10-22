-- 148: Towers, a kind of place (#1854, ADR-0131)
--
-- A tower visited to climb or to look at, whatever it was built for -- a bell
-- tower, a minaret, a pagoda, a clock tower, a TV tower, a fortified tower or
-- a tower tomb standing on its own -- had no list: Places of worship refuses
-- the Leaning Tower as a tower, and the monument kinds refuse it as a tower
-- too. Kind and source 7 are new. The source decides from the place pass's
-- gather, which source 3 reads (ADR-0132 decision 5), so it reads Wikidata
-- through source 3's door, and its arrivals are gated, like every kind's
-- seeded since Places of worship (ADR-0025).
--
-- `01-schema.sql` seeds the same rows for a fresh database.
--
-- Re-runnable: both seeds are guarded by their name.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (7, 'Towers', 7)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_sources
    (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id, wikidata_reader)
VALUES (
    7,
    'Towers',
    'Bell towers, minarets, pagodas, clock towers, TV towers and towers standing on their own worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    7,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Towers'),
    COALESCE((SELECT wikidata_reader FROM experience_sources WHERE id = 3), 'live')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

COMMIT;
