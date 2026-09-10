-- 053-source-rows-drop-the-user-agent-key.sql
--
-- The header a run sends is decided in code; a source row stated it too (#864).
--
-- Three of the four source rows carried api_config -> userAgent, seeded as
-- "TrackYourRegions/1.0": Art Museums, Public Art & Monuments and Places of
-- worship. Nothing ever read it. Every run sends the constant the sync services
-- share, so the stored value could differ from what Wikidata actually saw and
-- no one would learn it from the database -- which is worse than storing
-- nothing, because the row invited a reader to believe it.
--
-- The key goes, rather than the code starting to read it: setting a per-source
-- header has no screen, and one place decides that string now
-- (backend/src/config/userAgent.ts). The rest of api_config is untouched --
-- Places of worship keeps its enterSitelinks / staySitelinks line, which every
-- run does read.
--
-- Re-runnable: the minus operator removes a key that may already be gone, and
-- the WHERE means a second run touches no rows at all.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_categories
SET api_config = api_config - 'userAgent'
WHERE api_config ? 'userAgent';

COMMIT;
