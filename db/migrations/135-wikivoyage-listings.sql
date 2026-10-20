-- 135-wikivoyage-listings.sql
--
-- The Wikivoyage listings a door reads (#1768, ADR-0128). Archaeology's
-- readership door (ADR-0127) opens for a site below the sitelinks line only
-- where a travel guide sends visitors to it: a listing in an article of any
-- Wikivoyage edition whose wikidata= names the site's item. Dry run 178's
-- arrivals showed why. A guide lists 19 of its 20 sites (the Ancient theatre
-- of Taormina, the Roman Baths, Karahan Tepe) and none of the 9 places with
-- nothing to see (Stapleton International Airport, Rungholt, the circus of
-- Nero).
--
-- A build reads every edition's pages-articles dump of one date and keeps each
-- listing's item, edition and article, swapped in whole like every table kept
-- from a dump. Only those three are kept: no text of a listing is copied.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_listing_builds (
    build_id INTEGER PRIMARY KEY REFERENCES workbench.dump_builds(id),
    dump_date DATE NOT NULL,
    editions JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.wikivoyage_listing_builds IS 'Each build of the Wikivoyage listings (#1768, ADR-0128) that was swapped in: the dump build that read it, the dump date every edition''s file shares, and the listings kept per edition by its database name. The newest row is what wikivoyage_listings holds; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_listings (
    item TEXT NOT NULL,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (item, site, title)
);
COMMENT ON TABLE workbench.wikivoyage_listings IS 'A Wikidata item a Wikivoyage listing names (#1768, ADR-0128): the item of a listing template''s wikidata= parameter in an article (namespace 0) of one edition, with the edition''s database name (enwikivoyage) and the article''s title. A travel guide''s editors send visitors there; Archaeology''s readership door opens only for a site an edition lists. No text of the listing is kept.';

COMMIT;
