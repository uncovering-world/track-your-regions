-- 099-the-local-wikidata-subset.sql
--
-- The tables of the local Wikidata subset (ADR-0105, #1434): the kept
-- entities, the claims, labels and sitelinks derived from them, the class
-- closure, and the ledger of builds swapped in. A build fills them; this
-- creates them empty.
--
-- 01-schema.sql declares the same tables for a fresh database.
-- Re-runnable: every table and index is created where missing.

\set ON_ERROR_STOP on

BEGIN;

-- The local Wikidata subset (ADR-0101 decision 2, ADR-0105, #1434): the items
-- in scope kept whole in a compact form, and the tables the hot reads use,
-- derived from it. A build writes a full copy of each beside the live one and
-- swaps them in whole, so a reader never sees half a build. They are UNLOGGED:
-- each is rebuilt from its dump, and writing tens of gigabytes through the WAL
-- would double what a build writes for no reader's sake.
CREATE TABLE IF NOT EXISTS wikidata_subset_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    counts JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE wikidata_subset_builds IS 'Each build of the local Wikidata subset that was swapped in (ADR-0105): the dump build it read, the dump date, and what it kept. The newest row is what the wikidata_* tables hold.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_entities (
    id TEXT PRIMARY KEY,
    sitelink_count INTEGER NOT NULL,
    entity JSONB COMPRESSION lz4 NOT NULL
) WITH (toast_tuple_target = 128);
COMMENT ON TABLE wikidata_entities IS 'An item or property the local Wikidata subset keeps (ADR-0105), whole in a compact form: every statement at every rank with its qualifiers and statement id, every sitelink, labels and descriptions in the subset''s languages; no references or aliases.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_claims (
    subject TEXT NOT NULL,
    property TEXT NOT NULL,
    statement_id TEXT NOT NULL,
    rank SMALLINT NOT NULL CHECK (rank IN (-1, 0, 1)),
    value_item TEXT,
    value JSONB,
    qualifiers JSONB
);
CREATE INDEX IF NOT EXISTS idx_wikidata_claims_subject ON wikidata_claims (subject, property);
CREATE INDEX IF NOT EXISTS idx_wikidata_claims_value_item ON wikidata_claims (property, value_item) WHERE value_item IS NOT NULL;
COMMENT ON TABLE wikidata_claims IS 'The statements of the properties the catalogue reads, one row each, derived from wikidata_entities: rank 1 preferred, 0 normal, -1 deprecated; value_item for an item value, value otherwise.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_labels (
    id TEXT NOT NULL,
    language TEXT NOT NULL,
    label TEXT,
    description TEXT,
    PRIMARY KEY (id, language)
);
COMMENT ON TABLE wikidata_labels IS 'Labels and descriptions in the subset''s languages: of every kept entity, and of every entity a kept item names (the labels ring), so a work''s maker has a name.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_sitelinks (
    id TEXT NOT NULL,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (id, site)
);
CREATE INDEX IF NOT EXISTS idx_wikidata_sitelinks_title ON wikidata_sitelinks (site, title);
COMMENT ON TABLE wikidata_sitelinks IS 'Every sitelink of a kept item: the article each Wikipedia edition (and every other site) has about it.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_class_closure (
    class TEXT NOT NULL,
    ancestor TEXT NOT NULL,
    PRIMARY KEY (class, ancestor)
);
CREATE INDEX IF NOT EXISTS idx_wikidata_class_closure_ancestor ON wikidata_class_closure (ancestor);
COMMENT ON TABLE wikidata_class_closure IS 'For every class a kept item is an instance of, the class itself and every class above it through subclass of (P279, deprecated statements left out).';

COMMIT;
