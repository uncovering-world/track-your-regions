-- 213-a-curator-keeps-a-place-in-a-crowded-citys-list-or-its-shadow.sql
--
-- A crowded city shows a place unless ten better-known places of its kind and
-- type stand within 10 km (ADR-0172). Which of them a reader is shown is a
-- question of priorities among the neighbours, and a curator answers it in one
-- window over the whole type around a place (#2282, ADR-0180). The answer is a
-- pin on the membership that no run undoes:
--
-- - list: never crowded out, and it takes one of the ten above every
--   neighbour a curator did not keep there;
-- - shadow: always crowded out, and it never counts among the ten, so the next
--   place moves up.
--
-- A place holding a work a reader is shown, or of a type its kind exempts,
-- takes no pin. The recount reads the pins through crowding_better(), which
-- counts what stands above a membership whatever its own pin says, so
-- the rule's reading stays beside the curator's. A shadow pin may stand on
-- fewer than ten better known, so the stored count may be zero. A pin's change
-- recounts around its place as it commits, and the curation log gains the
-- crowding_answered action that records it.
--
-- Order-independent with 01-schema.sql, which declares the same objects, and
-- after 210, whose crowding_exempt_types the recount reads. Re-runnable: the
-- column is added if absent, the checks and the functions are replaced, and the
-- trigger is dropped and created again.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS crowding_pin VARCHAR(10);
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_crowding_pin_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_crowding_pin_check
    CHECK (crowding_pin IN ('list', 'shadow'));
COMMENT ON COLUMN experience_kind_memberships.crowding_pin IS 'A curator''s answer to a crowded city (ADR-0180): list keeps the place among what a reader is shown and counts it as one of the ten above every unpinned neighbour of its type; shadow keeps it in the tail and never counts it among the ten. NULL: the rule decides (ADR-0172). Written by a curator only (membershipWriter.ts); who and when are the curation log''s crowding_answered rows.';

ALTER TABLE membership_crowding DROP CONSTRAINT IF EXISTS membership_crowding_outranked_by_check;
ALTER TABLE membership_crowding ADD CONSTRAINT membership_crowding_outranked_by_check CHECK (outranked_by >= 0);
COMMENT ON TABLE membership_crowding IS 'The memberships crowded out of what a reader is shown (ADR-0172): crowding_limit or more candidates of the same kind and type within crowding_radius_km, holding no work a reader is shown, count above it, or a curator keeps it in the shadow (crowding_pin, ADR-0180). A place holding such a work is never here (ADR-0173), and nor is a place a curator keeps in the list. Absent means shown. A reader finds a crowded-out place by search and opens its card; no list, map or count holds it.';
COMMENT ON COLUMN membership_crowding.outranked_by IS 'How many candidates of its kind and type within the radius count above it (crowding_better()): the better known and the ones a curator keeps in the list, less the ones a curator keeps in the shadow and the ones holding a work a reader is shown (ADR-0173, ADR-0180). Under crowding_limit only for a place a curator keeps in the shadow.';

-- How many candidates of a kind and type around a point count above a
-- membership, its own pin unread: a set-returning function, so the recount's
-- lateral join inlines it.
CREATE OR REPLACE FUNCTION crowding_better(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (better integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT count(*)::int
    FROM experience_kind_memberships d
    JOIN experiences de ON de.id = d.experience_id
    LEFT JOIN membership_fame df ON df.membership_id = d.id
   WHERE d.kind_id = of_kind AND d.type IS NOT DISTINCT FROM of_type AND d.id <> of_member
     AND de.location && crowding_box(at_point, within_km)
     AND ST_DWithin(de.location::geography, at_point::geography, within_km * 1000)
     AND d.admission <> 'refused' AND de.existence <> 'lost'
     AND d.crowding_pin IS DISTINCT FROM 'shadow'
     AND (d.crowding_pin = 'list' OR df.score > above_score)
     AND NOT place_shows_works(de.id)
$$;

-- The same count for one membership, by its id.
CREATE OR REPLACE FUNCTION crowding_outranked_by(member integer) RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT n.better
    FROM experience_kind_memberships c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id AND ce.location IS NOT NULL
    LEFT JOIN membership_fame cf ON cf.membership_id = c.id
    CROSS JOIN LATERAL crowding_better(c.kind_id, c.type, c.id, ce.location, k.crowding_radius_km, cf.score) n
   WHERE c.id = member
$$;

-- Recount the crowded-out memberships within a kind's radius of near, or of
-- the whole catalogue: as migration 210 declared it, with the pins read.
CREATE OR REPLACE FUNCTION recount_crowding(near geometry DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(2201, 0);

  DELETE FROM membership_crowding mc
   USING experience_kind_memberships m, experiences e, experience_kinds k
   WHERE mc.membership_id = m.id AND e.id = m.experience_id AND k.id = m.kind_id
     AND (near IS NULL OR k.crowding_radius_km IS NULL
          OR (e.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(e.location::geography, near::geography, k.crowding_radius_km * 1000)));

  INSERT INTO membership_crowding (membership_id, outranked_by)
  SELECT c.id, n.better
    FROM experience_kind_memberships c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id
    LEFT JOIN membership_fame cf ON cf.membership_id = c.id
    CROSS JOIN LATERAL crowding_better(c.kind_id, c.type, c.id, ce.location, k.crowding_radius_km, cf.score) n
   WHERE c.admission <> 'refused' AND ce.existence <> 'lost' AND ce.location IS NOT NULL
     AND (c.type IS NULL OR c.type <> ALL(k.crowding_exempt_types))
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND NOT place_shows_works(ce.id)
     AND c.crowding_pin IS DISTINCT FROM 'list'
     AND (c.crowding_pin = 'shadow' OR cf.score IS NOT NULL)
     AND (c.crowding_pin = 'shadow' OR n.better >= k.crowding_limit)
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $$;


DROP TRIGGER IF EXISTS crowding_follows_membership_change ON experience_kind_memberships;
CREATE CONSTRAINT TRIGGER crowding_follows_membership_change
  AFTER UPDATE OF admission, type, kind_id, experience_id, crowding_pin ON experience_kind_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.admission IS DISTINCT FROM NEW.admission OR OLD.type IS DISTINCT FROM NEW.type
        OR OLD.kind_id IS DISTINCT FROM NEW.kind_id OR OLD.experience_id IS DISTINCT FROM NEW.experience_id
        OR OLD.crowding_pin IS DISTINCT FROM NEW.crowding_pin)
  EXECUTE FUNCTION crowding_follows_membership();

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back', 'kind_added', 'find_site_answered', 'crowding_answered'));

COMMIT;
