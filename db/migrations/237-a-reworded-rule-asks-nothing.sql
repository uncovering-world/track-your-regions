-- 237-a-reworded-rule-asks-nothing.sql
--
-- A pin is asked about again only when the run says something other than
-- what the curator answered over (#1367): its counts aside, the measure's two
-- words aside (#1589), and since #2430 the rule's words about itself aside too,
-- that is the bars a fame refusal spells out in parentheses after "bars" or
-- "line", and what a run kept "as last read". The questions runs raised before
-- that for those words alone are closed here: the run's reason differs from the
-- answered one under the earlier fold, and matches it under the new one. On the
-- development stack on 2026-11-10 those were Aqua Claudia, Phnom Kulen and
-- Gemiler Island, asked about again when the bars' list gained "or the World
-- Heritage List inscribes it". They would not close on their own: a question
-- the run still says stays (stillAsks).
--
-- A question a run raised on request in the answered words (#1370), such as
-- Louvre Abu Dhabi's, matches under both folds and stays. Nothing the curator
-- did is touched, as in 113: each closed question is printed with both reasons.
--
-- One-off: the fold in pinQuestion.ts keeps a reworded rule from raising one
-- again. Re-runnable: a closed question is not matched twice.

\set ON_ERROR_STOP on

BEGIN;

WITH folded AS (
  SELECT m.id, m.experience_id, m.kind_id,
         m.admission_pin_reason AS answered_over, m.admission_question_reason AS asked_over,
         -- The fold before #2430: the digits and the measure's words.
         btrim(regexp_replace(regexp_replace(m.admission_question_reason, '\d+', '#', 'g'),
               '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi')) AS asked_before,
         btrim(regexp_replace(regexp_replace(m.admission_pin_reason, '\d+', '#', 'g'),
               '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi')) AS answered_before,
         -- The fold of #2430 (foldedReasonSql): the rule's own words dropped first.
         btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(m.admission_question_reason,
               ' \(the guides as last read\)', '', 'g'), ' as last read\M', '', 'g'),
               '\m(bars?|line) \([^()]*\)', '\1', 'g'), '\d+', '#', 'g'),
               '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi')) AS asked_now,
         btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(m.admission_pin_reason,
               ' \(the guides as last read\)', '', 'g'), ' as last read\M', '', 'g'),
               '\m(bars?|line) \([^()]*\)', '\1', 'g'), '\d+', '#', 'g'),
               '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi')) AS answered_now
    FROM source_records m
   WHERE m.admission_questioned_at IS NOT NULL
     AND m.admission_question_verdict IS NOT DISTINCT FROM m.admission_pin_verdict
), closing AS (
  SELECT * FROM folded
   WHERE asked_before IS DISTINCT FROM answered_before
     AND asked_now IS NOT DISTINCT FROM answered_now
)
UPDATE source_records m
   SET admission_question_verdict = NULL,
       admission_question_reason = NULL,
       admission_questioned_at = NULL,
       admission_question_sync_log_id = NULL,
       updated_at = NOW()
  FROM closing c
 WHERE m.id = c.id
RETURNING c.experience_id, c.kind_id, c.answered_over, c.asked_over;

COMMIT;
