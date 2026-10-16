-- 113-a-renamed-measure-asks-nothing.sql
--
-- A pin is asked about again only when the run says something other than
-- what the curator answered over, its counts aside (#1367); since #1589 the
-- rule's two words for the fame measure, "sitelinks" and "Wikipedia editions"
-- (#1240), read as one word too. The questions runs raised before that, for
-- the rename alone, are closed here: the run's reason differs from the
-- answered one with only its digits folded, and matches it with the measure's
-- words folded as well. A question a run raised on request in the answered
-- words (#1370) matches under both and stays. One raised on request over a
-- pin answered in the old words cannot be told from a rename-only one, since
-- a run does not record that it was asked, and is closed too; asking that
-- source again about its pins raises it again.
--
-- Nothing the curator did is touched: their answer, its pin and its row in
-- the curation log stay as they are. A question is the run's statement, not a
-- curator's act, and the run withdraws one it no longer says with this same
-- write (writePinQuestions); the log, whose rows name a curator, has no act
-- for it. Each closed question is printed instead, with both reasons, so the
-- output of the run that applied this file says what it closed.
--
-- One-off: the fold in pinQuestion.ts keeps a rename from raising one again.
-- Re-runnable: a closed question is not matched twice.

\set ON_ERROR_STOP on

BEGIN;

WITH closing AS (
  SELECT m.id, m.experience_id, m.kind_id,
         m.admission_pin_reason AS answered_over, m.admission_question_reason AS asked_over
    FROM experience_kind_memberships m
   WHERE m.admission_questioned_at IS NOT NULL
     AND m.admission_question_verdict IS NOT DISTINCT FROM m.admission_pin_verdict
     AND btrim(regexp_replace(m.admission_question_reason, '\d+', '#', 'g'))
         IS DISTINCT FROM btrim(regexp_replace(m.admission_pin_reason, '\d+', '#', 'g'))
     AND btrim(regexp_replace(regexp_replace(m.admission_question_reason, '\d+', '#', 'g'),
                              '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi'))
         IS NOT DISTINCT FROM btrim(regexp_replace(regexp_replace(m.admission_pin_reason, '\d+', '#', 'g'),
                                                   '\m(sitelinks?|Wikipedia editions?)\M', 'editions', 'gi'))
)
UPDATE experience_kind_memberships m
   SET admission_question_verdict = NULL,
       admission_question_reason = NULL,
       admission_questioned_at = NULL,
       admission_question_sync_log_id = NULL,
       updated_at = NOW()
  FROM closing c
 WHERE m.id = c.id
RETURNING c.experience_id, c.kind_id, c.answered_over, c.asked_over;

COMMIT;
