-- 135-wikivoyage-item-usage.sql
--
-- The Wikidata items each Wikivoyage edition uses (#1768): the
-- travel-guide witness of whether a place is one a visitor goes to. The
-- maintainer decided on 2026-10-20 (#1718) that a place is one when two
-- independent witnesses of four say so: a travel guide, photographs taken
-- there, Wikidata's formal statements and the map. A Wikivoyage article
-- uses the item of a place it lists, so an edition's usage table says which
-- places a guide sends visitors to. On dry run 178's arrivals it names 19 of
-- the 20 sites (the Ancient theatre of Taormina, the Roman Baths, Karahan
-- Tepe) and none of the 9 places with nothing to see (Stapleton International
-- Airport, Rungholt, the circus of Nero).
--
-- A build reads every edition's wbc_entity_usage and page tables of one dump
-- date and keeps each item an edition's articles use, less a heritage
-- register's lists, swapped in whole like every table kept from a dump.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_usage_builds (
    build_id INTEGER PRIMARY KEY REFERENCES workbench.dump_builds(id),
    dump_date DATE NOT NULL,
    editions JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.wikivoyage_usage_builds IS 'Each build of the Wikivoyage item usage (#1768, decided on #1718) that was swapped in: the dump build that read it, the dump date every edition''s table shares, and the items kept per edition by its database name. The newest row is what wikivoyage_usage holds; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_usage (
    item TEXT NOT NULL,
    site TEXT NOT NULL,
    PRIMARY KEY (item, site)
);
COMMENT ON TABLE workbench.wikivoyage_usage IS 'A Wikidata item some article of one Wikivoyage edition uses (#1768, decided on #1718), from the edition''s wbc_entity_usage and page dump tables, with the edition''s database name (enwikivoyage): namespace 0, no redirect, no heritage register''s list. An article uses the item of a place it lists, so this is the travel-guide witness of whether a place is one a visitor goes to.';

COMMIT;
