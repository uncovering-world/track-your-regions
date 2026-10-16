-- 114-coverage-judgements.sql
--
-- A gap the coverage report finds is judged once, in a committed ledger by
-- cause (ADR-0116, #1605): db/catalogue-coverage/judgements.jsonl holds one
-- line per judged gap, and this table is its copy, loaded with the four
-- coverage tables by scripts/catalogue-coverage.sh load and written by nothing
-- else. The report and the Catalogue Checks coverage check read it to tell a
-- finding somebody has answered for from one nobody has.
--
-- A judgement names its subject in one of two ways: an entry of a region's
-- survey list and the live kind that does not offer it (the coverage check's
-- finding, one per kind: an entry filed under two live kinds has two gaps), or
-- a catalogue row, by its Wikidata id, that the catalogue offers within a
-- surveyed region's reach and no entry names (#1601). Exactly one of the two.
--
-- The cause is a closed vocabulary, so the report can count by it: a rule the
-- product runs today should have admitted it (rule-defect), no rule the product
-- runs would admit it yet (door-missing: the regional tier, readership), the
-- kind a traveller looks for it under does not exist yet (kind-missing), the
-- catalogue offers the place it is part of (part-of-offered), a reader finds it
-- under the kind the product's rules give it to (offered-elsewhere), or a
-- visitor misses nothing (not-a-must). A defect and a missing door name the
-- issue that owns them.
--
-- The files are the source of truth and the load replaces every row, so this
-- migration creates the table and loads nothing. Order-independent with
-- 01-schema.sql, which carries the same statements; re-running this file finds
-- the table and its indexes already there and does nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS coverage_judgements (
    region_slug VARCHAR(80) NOT NULL REFERENCES coverage_regions(slug) ON DELETE CASCADE,
    entry_slug VARCHAR(120),
    kind_slug VARCHAR(80) REFERENCES coverage_kinds(slug) ON DELETE CASCADE,
    row_wikidata_id VARCHAR(20) CHECK (row_wikidata_id ~ '^Q[1-9][0-9]*$'),
    cause VARCHAR(20) NOT NULL CHECK (cause IN ('rule-defect', 'door-missing', 'kind-missing', 'part-of-offered', 'offered-elsewhere', 'not-a-must')),
    issue_number INTEGER CHECK (issue_number > 0),
    judged DATE NOT NULL,
    note TEXT NOT NULL CHECK (note <> ''),
    CONSTRAINT coverage_judgements_one_subject CHECK ((entry_slug IS NULL) <> (row_wikidata_id IS NULL)),
    CONSTRAINT coverage_judgements_entry_names_kind CHECK ((entry_slug IS NULL) = (kind_slug IS NULL)),
    CONSTRAINT coverage_judgements_cause_owned CHECK (cause NOT IN ('rule-defect', 'door-missing') OR issue_number IS NOT NULL),
    CONSTRAINT coverage_judgements_entry FOREIGN KEY (region_slug, entry_slug) REFERENCES coverage_expectations(region_slug, slug) ON DELETE CASCADE,
    CONSTRAINT coverage_judgements_filing FOREIGN KEY (region_slug, entry_slug, kind_slug) REFERENCES coverage_expectation_kinds(region_slug, expectation_slug, kind_slug) ON DELETE CASCADE
);

-- A subject is judged once: one line per entry and kind, one per catalogue row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_judgements_entry
    ON coverage_judgements(region_slug, entry_slug, kind_slug) WHERE entry_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_judgements_row
    ON coverage_judgements(region_slug, row_wikidata_id) WHERE row_wikidata_id IS NOT NULL;

COMMENT ON TABLE coverage_judgements IS 'A gap the coverage report found, judged once by cause, loaded from db/catalogue-coverage/judgements.jsonl (ADR-0116). A copy: the file is the source of truth.';
COMMENT ON COLUMN coverage_judgements.entry_slug IS 'The entry of the region''s survey list a live kind does not offer; null when the subject is a catalogue row.';
COMMENT ON COLUMN coverage_judgements.kind_slug IS 'The live kind whose gap is judged: the entry is filed under it and it does not offer the entry. An entry filed under two live kinds has a gap, and a line, per kind.';
COMMENT ON COLUMN coverage_judgements.row_wikidata_id IS 'The catalogue row the region offers and no entry names, by its Wikidata id; null when the subject is an entry.';
COMMENT ON COLUMN coverage_judgements.cause IS 'Why the gap stands, from the closed vocabulary the report counts by. A rule-defect and a door-missing name their issue.';
COMMENT ON COLUMN coverage_judgements.issue_number IS 'The issue that owns the cause, where one does.';
COMMENT ON COLUMN coverage_judgements.judged IS 'The date the judgement was made, which is the date of the catalogue it was made against.';

COMMIT;
