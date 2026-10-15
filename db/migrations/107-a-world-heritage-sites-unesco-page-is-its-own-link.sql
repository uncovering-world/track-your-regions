-- 107-a-world-heritage-sites-unesco-page-is-its-own-link.sql
--
-- `metadata.website` held two things: UNESCO's page about a World Heritage
-- site (whc.unesco.org/en/list/<id>, ADR-0043) and the site's own address
-- the Wikidata kinds read (P856). On a place both hold, the runs overwrote
-- each other's link (#1538). UNESCO's page is now its own key, `unescoUrl`,
-- owned by UNESCO's family of fields (ADR-0109), and `website` is the site's
-- own.
--
-- This moves every stored whc.unesco.org address from `website` to
-- `unescoUrl`. A place no Wikidata kind holds is left with no `website`,
-- since UNESCO never gave one; a place a Wikidata kind holds gets its
-- official site back from that kind's next run, written directly where the
-- kind is not gated, and offered to a curator as a held change where it is
-- (Archaeology and Places of worship, ADR-0052, ADR-0058). No curator claims a stored
-- UNESCO page (measured on 2026-10-15: 1277 such rows, none claimed), so no
-- claim is moved. Re-runnable: a moved row no longer matches.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experiences
   SET metadata = (metadata - 'website') || jsonb_build_object('unescoUrl', metadata ->> 'website')
 WHERE metadata ->> 'website' ~ '^https?://whc\.unesco\.org/'
   AND NOT (COALESCE(curated_fields, '[]'::jsonb) ? 'metadata.website');

COMMIT;
