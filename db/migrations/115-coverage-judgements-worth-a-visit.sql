-- 115-coverage-judgements-worth-a-visit.sql
--
-- The judgement ledger's second subject is read (#1601): a catalogue row a
-- surveyed region offers within its reach that no entry of the region's
-- survey list names. The coverage report lists such rows, least known first,
-- and a person judges each once in db/catalogue-coverage/judgements.jsonl, as
-- a gap is judged (ADR-0116). A row judged not worth a visit is a finding the
-- kind's rule or a curator answers; one judged worth a visit is a gap of the
-- guides, not of the catalogue, and is listed no more.
--
-- That second answer needs a cause of its own, so the vocabulary gains
-- worth-a-visit (ADR-0116 decision 3: a cause that fits none is a reason to
-- extend the vocabulary in a pull request, never a free-text cause). What a
-- subject may be judged follows from what it is: an offered row has no door,
-- kind, part or other kind to wait on, so it takes worth-a-visit, not-a-must
-- or rule-defect; an entry a kind does not offer is never worth-a-visit.
--
-- The file is the source of truth and the load replaces every row, so this
-- migration changes the constraints and loads nothing. Order-independent with
-- 01-schema.sql, which declares the same constraints: re-running this file
-- drops each by name and declares it again.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE coverage_judgements DROP CONSTRAINT IF EXISTS coverage_judgements_cause_check;
ALTER TABLE coverage_judgements ADD CONSTRAINT coverage_judgements_cause_check
    CHECK (cause IN ('rule-defect', 'door-missing', 'kind-missing', 'part-of-offered', 'offered-elsewhere', 'not-a-must', 'worth-a-visit'));

ALTER TABLE coverage_judgements DROP CONSTRAINT IF EXISTS coverage_judgements_row_causes;
ALTER TABLE coverage_judgements ADD CONSTRAINT coverage_judgements_row_causes
    CHECK (row_wikidata_id IS NULL OR cause IN ('worth-a-visit', 'not-a-must', 'rule-defect'));

ALTER TABLE coverage_judgements DROP CONSTRAINT IF EXISTS coverage_judgements_entry_causes;
ALTER TABLE coverage_judgements ADD CONSTRAINT coverage_judgements_entry_causes
    CHECK (entry_slug IS NULL OR cause <> 'worth-a-visit');

COMMENT ON COLUMN coverage_judgements.cause IS 'Why the gap stands, or why the row stays, from the closed vocabulary the report counts by. A rule-defect and a door-missing name their issue. A row takes worth-a-visit, not-a-must or rule-defect; an entry never worth-a-visit.';

COMMIT;
