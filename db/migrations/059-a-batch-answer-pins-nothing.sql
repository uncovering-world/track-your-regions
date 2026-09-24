-- 059-a-batch-answer-pins-nothing.sql
--
-- A refusal a batch answer confirmed is closed without a pin (#906, ADR-0067).
--
-- A refusal is a question until it is answered, and until now the only way to
-- close one was the admission pin (`curated_fields ? 'admission'`), which also
-- makes every later run keep the answer. A batch answer pins nothing, so it
-- needs a mark of its own: `admission_answered_at`, set when a batch confirms
-- a refusal, cleared when a run refuses a row it had admitted, so a refusal
-- that comes back is asked again. Nullable, and NULL on every existing row:
-- every refusal answered until now carries the pin, which still closes it.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships
  ADD COLUMN IF NOT EXISTS admission_answered_at TIMESTAMPTZ;

COMMENT ON COLUMN experience_kind_memberships.admission_answered_at IS 'When a batch answer confirmed this refusal without pinning it (ADR-0067): the question is closed, and the next run applies the rule again. A run that refuses a row it had admitted clears it, so a refusal that comes back is asked again.';

COMMIT;
