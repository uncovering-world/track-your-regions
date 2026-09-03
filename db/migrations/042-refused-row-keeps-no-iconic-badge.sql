-- 042: A row its category turned away keeps no Iconic badge (#760)
--
-- A museum carries `is_iconic` because it holds a work above the fame line, and
-- every museum in this catalogue was admitted for exactly that (ADR-0023), so
-- the flag has been a synonym of belonging. The run's two refusal writes clear
-- it (`admission.ts`, `CLEAR_ICONIC`) -- on the rows they may touch. A row a
-- curator has answered is not one of them: confirming a refusal pins
-- `admission` in `curated_fields`, and that pin is what keeps every later run
-- off the row, whatever the flag held at that moment.
--
-- Eight museum rows on the development catalogue held the flag that way:
-- created by run 48 on 2026-08-06, before the art test; refused by runs 52 and
-- 53 on 2026-08-07, the day the admission writes landed, with the flag
-- surviving; and confirmed by a curator on 2026-08-07 and 08 -- the British
-- Museum, the Cyprus Museum, the Natural History Museum in Vienna and the Roman
-- Forum among them. Nothing reads a museum's own flag yet; the Iconic filter
-- (#589) and an export (#591) will read it on its own, with no admission
-- predicate beside it, and hand a reader a must-see the catalogue turned away.
--
-- From #760 a curator's confirmation clears the flag as the run does, and
-- Catalogue Checks names a refused row still wearing it
-- (`refused-row-wearing-iconic`). This file clears the rows refused before
-- either existed. It honours the one pin the writers honour -- a flag a curator
-- set stays -- and touches nothing on a database with nothing to clear, so
-- re-running it is inert. No DDL, so it is order-independent with
-- 01-schema.sql.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experiences
   SET is_iconic = false
 WHERE admission = 'refused'
   AND is_iconic
   AND NOT COALESCE(curated_fields ? 'is_iconic', false);

COMMIT;
