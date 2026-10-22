-- 151: Squares & streets, a kind of place (#1867, ADR-0131)
--
-- A square, a street, a promenade or a stairway a visitor walks as a sight in
-- itself -- Red Square, Piazza Navona, the Spanish Steps, the Champs-Elysees,
-- the Arbat -- had no list unless it lay in a World Heritage property. Kind
-- and source 9 are new. The source decides from the place pass's gather,
-- which source 3 reads (ADR-0132 decision 5), so it reads Wikidata through
-- source 3's door, and its arrivals are gated, like every kind's seeded since
-- Places of worship (ADR-0025).
--
-- `01-schema.sql` seeds the same rows for a fresh database.
--
-- Re-runnable: both seeds are guarded by their name.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (9, 'Squares & streets', 9)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_sources
    (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id, wikidata_reader)
VALUES (
    9,
    'Squares & streets',
    'Squares, streets, promenades and stairways a visitor walks as a sight, worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    9,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Squares & streets'),
    COALESCE((SELECT wikidata_reader FROM experience_sources WHERE id = 3), 'live')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

COMMIT;
