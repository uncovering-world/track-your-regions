-- 207-a-find-is-linked-to-the-site-it-came-from.sql
--
-- A site's card lists the finds dug up there through the find's Wikidata
-- "location of discovery" (metadata.foundAt), and the Dendera zodiac, the Code
-- of Ur-Nammu and the Ishtar Gate carry none: their own coordinate stands on
-- Dendera, Ur and Babylon (#2242). A run now proposes such a link from the
-- coordinate and a curator confirms or refuses it; this table keeps both.
--
-- The table arrives empty: the end of the next real run proposes.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

-- Where a find came from when its Wikidata item names no place of discovery
-- (#2242): a link from a museum's work to the archaeological or World Heritage
-- site its own coordinate stands on, proposed by a run and confirmed or refused
-- by a curator. A coordinate is a reason to propose, not a link: Harmodius and
-- Aristogeiton's stands where the lost original stood. Serving (ADR-0124).
CREATE TABLE IF NOT EXISTS find_site_links (
    id SERIAL PRIMARY KEY,
    treasure_id INTEGER NOT NULL REFERENCES treasures(id) ON DELETE CASCADE,
    site_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('proposed', 'confirmed', 'refused')),
    origin TEXT NOT NULL CHECK (origin IN ('coordinate', 'curator')),
    distance_m INTEGER,
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    UNIQUE (treasure_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_find_site_links_site ON find_site_links (site_id, state);
COMMENT ON TABLE find_site_links IS 'A museum''s find linked to the site it came from where its Wikidata item names no place of discovery (#2242): proposed by a run from the find''s own coordinate (origin coordinate, distance_m from the site''s point) or made by a curator (origin curator), then confirmed or refused by a curator. A refused pair is never proposed again. Written by proposeFindSites (backend/src/services/sync/findSiteProposals.ts) and the curator''s answer.';


COMMIT;
