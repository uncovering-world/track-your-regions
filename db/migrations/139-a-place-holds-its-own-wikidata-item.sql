-- 139-a-place-holds-its-own-wikidata-item.sql
--
-- A place a Wikidata kind admits holds the item that kind knows it by
-- (#1794, ADR-0129). The UNESCO run writes no item, so a World Heritage site
-- it made held none, and every run of a gated Wikidata kind that also admits
-- it proposed the item and was held: Ajanta Caves, under Places of worship
-- and Archaeology as Q184427, got the same card on every run. Since #1794 a
-- run writes that item past the gate; this file writes it onto the places
-- the runs before it held it from.
--
-- The item is the one id the place's standing memberships give it: admitted
-- by their kind, still listed by their source. A refused or withdrawn
-- membership says nothing about the place any more. A place whose standing
-- memberships name two different items is left alone: which of them it is
-- stays a curator's question.
--
-- No held proposal is closed here. On the development catalogue on
-- 2026-10-21 every one that held the item (57 under Places of worship, 122
-- under Archaeology, 1 under Public Art) also held Wikidata's one-line
-- description beside UNESCO's paragraph, which #1795 answers. Each card loses
-- its item row with the source's next run, which no longer proposes it, and
-- the card goes once nothing else is held.
--
-- Re-runnable: a place that holds an item is not written again.

\set ON_ERROR_STOP on

BEGIN;

WITH own_item AS (
  SELECT m.experience_id, min(m.external_id) AS qid
    FROM experience_kind_memberships m
   WHERE m.external_id ~ '^Q[1-9][0-9]*$'
     AND m.admission = 'admitted'
     AND m.source_membership = 'present'
     AND m.missing_since IS NULL
   GROUP BY m.experience_id
  HAVING count(DISTINCT m.external_id) = 1
)
UPDATE experiences e
   SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('wikidataQid', o.qid),
       updated_at = NOW()
  FROM own_item o
 WHERE e.id = o.experience_id
   AND e.merged_into_id IS NULL
   AND NOT COALESCE(e.metadata ? 'wikidataQid', FALSE)
RETURNING e.id AS written_place, e.name, o.qid;

COMMIT;
