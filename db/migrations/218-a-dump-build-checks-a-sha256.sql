-- 218-a-dump-build-checks-a-sha256.sql
--
-- English Wikivoyage's articles are read from MediaWiki Content File Exports
-- (#2355), which publish a sha256 for each file (SHA256SUMS) where a wiki's own
-- run gives a sha1. A build records the checksum it verified, so the kinds it
-- may record now include sha256, and the pages table says where its pages
-- come from.
--
-- Re-runnable: the check is dropped if present and added again; the comment is
-- replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.dump_builds DROP CONSTRAINT IF EXISTS dump_builds_checksum_kind_check;
ALTER TABLE workbench.dump_builds ADD CONSTRAINT dump_builds_checksum_kind_check
    CHECK (checksum_kind IN ('md5', 'sha1', 'sha256'));

COMMENT ON TABLE workbench.wikivoyage_pages IS 'A page of English Wikivoyage''s namespace 0 (#2089), from the month''s content export (MediaWiki Content File Exports, #2355): its title as the wiki writes it, its page id, the title it redirects to (null for an article, the target''s section dropped), its wikitext, and the Wikidata item its page properties name. The world-view extraction reads a region''s page, its Regions section and whether a linked page exists from here, so two extractions of one copy build the same tree.';

COMMIT;
