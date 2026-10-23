-- 159-a-place-holds-its-identifiers-in-one-registry.sql
--
-- A place's external identifiers are one registry, and an identifier that
-- identifies names one live place (ADR-0143 decision 2, #1892). Until now
-- they were spread over a membership's external id, a World Heritage
-- membership's items and a component point's item, and nothing stopped two
-- live places from holding one: a run created a copy and the equal-item merge
-- folded it away afterwards.
--
-- The registry is derived from those columns, which stay where they are and
-- are still written by the writers that write them: one function says which
-- live places carry a value and whether each claim identifies, and triggers on
-- the four tables that hold them keep it current. A value two live places
-- claim to identify is held by both as only referring to them, and the
-- catalogue check identifiers-on-several-places names it: the duplicate the
-- merges missed is reported, never merged here.
--
-- On the development catalogue on 2026-10-23 the backfill registers about
-- 8,000 Wikidata items and 6,900 World Heritage references, and 18 Wikidata
-- items are claimed by two live places, among them the Tower of Belem
-- (Q215003) as a part of the Jeronimos site and as a tower.
--
-- Re-runnable: the functions and triggers are replaced, and the backfill
-- refreshes every value again.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS place_identifiers (
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    scheme VARCHAR(12) NOT NULL CHECK (scheme IN ('wikidata', 'whc', 'osm')),
    value VARCHAR(64) NOT NULL,
    identifies BOOLEAN NOT NULL,
    claims_identity BOOLEAN NOT NULL,
    basis TEXT[] NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (experience_id, scheme, value),
    CHECK (claims_identity OR NOT identifies)
);
CREATE UNIQUE INDEX IF NOT EXISTS place_identifiers_identifying
    ON place_identifiers (scheme, value) WHERE identifies;
CREATE INDEX IF NOT EXISTS place_identifiers_value ON place_identifiers (scheme, value);
COMMENT ON TABLE place_identifiers IS 'A place''s external identifiers (ADR-0143 decision 2): a Wikidata item, a World Heritage reference (whc: a site''s id or a component''s), an OpenStreetMap object. Derived from the columns that hold them (a membership''s external id and items, a component point''s item, a part''s reference) by place_identifier_claims() and kept current by refresh_place_identifiers(); written by nothing else. A membership''s (source, external id) is its own key and is not repeated here.';
COMMENT ON COLUMN place_identifiers.identifies IS 'This value names this place, and no other live place: what a run''s lookup may follow. False where it only refers to the place (a serial site''s items, an item two components carry) and on every place of a value two places claim.';
COMMENT ON COLUMN place_identifiers.claims_identity IS 'Some column this row is derived from says the value is this place. A value claimed by two live places is identifying on neither, and the catalogue check identifiers-on-several-places lists it.';
COMMENT ON COLUMN place_identifiers.basis IS 'Which columns carry the value for this place: membership (a source knows the place by it), site-items (a World Heritage site''s items), point (a standing point''s item), component (a part''s reference).';
COMMENT ON COLUMN place_identifiers.recorded_at IS 'When the place first carried the value; kept while it carries it.';

-- The lookups the claims make by value.
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_external_id
    ON experience_kind_memberships (external_id);
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_wikidata_items
    ON experience_kind_memberships USING GIN (wikidata_items) WHERE wikidata_items IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experience_parts_external_ref
    ON experience_parts (external_ref) WHERE external_ref IS NOT NULL;

-- Which live places carry each value, and whether each says the value is the
-- place. The rules are the equal-item merge's (membershipItemSql, partItemsSql):
-- a Wikidata source's id is its place; a World Heritage site's items are its
-- place only as one item on a place of one standing point, and otherwise name
-- its parts; a standing point's item is its place unless another live place's
-- standing point carries it too, which makes it an ensemble's (the chapels and
-- the village of Saint Thaddeus carry the monastery's). The World Heritage
-- source is source 1, whose ids are the sites' references.
CREATE OR REPLACE FUNCTION place_identifier_claims(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, basis TEXT, claims BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND m.external_id = ANY(p_values) AND m.external_id ~ '^Q[0-9]+$'
  UNION ALL
  SELECT m.experience_id, item, 'site-items',
         cardinality(m.wikidata_items) = 1
           AND (SELECT count(*) FROM experience_locations one_point
                 WHERE one_point.experience_id = m.experience_id
                   AND one_point.merged_into_id IS NULL AND one_point.missing_since IS NULL) = 1
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(m.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND m.wikidata_items && p_values::text[] AND item = ANY(p_values)
  UNION ALL
  SELECT point.experience_id, point.wikidata_item::text, 'point',
         NOT EXISTS (SELECT 1 FROM experience_locations other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.wikidata_item = point.wikidata_item
                        AND other.experience_id <> point.experience_id
                        AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
    FROM experience_locations point
    JOIN experiences e ON e.id = point.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND point.wikidata_item = ANY(p_values)
     AND point.merged_into_id IS NULL AND point.missing_since IS NULL
  UNION ALL
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND m.source_id = 1 AND m.external_id = ANY(p_values)
  UNION ALL
  SELECT prt.part_id, prt.external_ref, 'component',
         NOT EXISTS (SELECT 1 FROM experience_parts other
                       JOIN experiences other_part ON other_part.id = other.part_id
                        AND other_part.merged_into_id IS NULL
                      WHERE other.reason = 'component' AND other.external_ref = prt.external_ref
                        AND other.part_id <> prt.part_id)
    FROM experience_parts prt
    JOIN experiences e ON e.id = prt.part_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND prt.reason = 'component' AND prt.external_ref = ANY(p_values)
$$;
COMMENT ON FUNCTION place_identifier_claims(TEXT, TEXT[]) IS 'The live places that carry each of the values of one scheme, with the column that carries it and whether it says the value is the place (ADR-0143 decision 2). The one statement of what the registry holds.';

-- Locks values for the transaction, so two writers that carry one value take
-- turns and the second reads what the first committed: two runs that each
-- create a place for one item end with both places referring, never with the
-- second refused by the unique index. A value is locked through one of 1,024
-- keys its scheme and value hash to, so a transaction that writes thousands of
-- values (this file's backfill, a first World Heritage run) holds at most
-- 1,024 locks, where one per value would overrun the server's lock table; two
-- values sharing a key only wait on each other. The keys are pairs under 1143
-- (this ADR's number), apart from the pairs a source's own name takes
-- (lockSourcedExperience, under its source id).
--
-- One call takes its keys in key order, every scheme's together, so two calls
-- never wait on each other in a cycle. Across the statements of one
-- transaction the order is the order of its writes, as with row locks: two
-- transactions that each write several places can still meet in a cycle, and
-- PostgreSQL then aborts one of them (40P01) rather than leave both waiting.
CREATE OR REPLACE FUNCTION place_identifier_lock_key(p_scheme TEXT, p_value TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT hashtext(p_scheme || ':' || p_value) & 1023
$$;

CREATE OR REPLACE FUNCTION lock_place_identifier_keys(p_keys INTEGER[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  key INTEGER;
BEGIN
  FOR key IN SELECT DISTINCT k FROM unnest(p_keys) AS k WHERE k IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(1143, key);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION lock_place_identifiers(p_scheme TEXT, p_values TEXT[])
RETURNS void LANGUAGE sql AS $$
  SELECT lock_place_identifier_keys(ARRAY(SELECT place_identifier_lock_key(p_scheme, v) FROM unnest(p_values) AS v))
$$;
COMMENT ON FUNCTION lock_place_identifiers(TEXT, TEXT[]) IS 'Locks these values of one scheme for the transaction, through 1,024 keys under 1143 taken in key order within the call (ADR-0143 decision 3): what every writer of an identifier, and the lookup that may create a place for one, takes before reading who holds it.';

-- The rows the registry holds for these values of one scheme: one per place
-- that carries a value, identifying where that place is the only one whose
-- claim says the value is it.
CREATE OR REPLACE FUNCTION place_identifiers_expected(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, identifies BOOLEAN, claims_identity BOOLEAN, basis TEXT[])
LANGUAGE sql STABLE AS $$
  SELECT held.experience_id, held.value, held.claims AND held.claimants = 1, held.claims, held.basis
    FROM (SELECT per_place.*,
                 count(*) FILTER (WHERE per_place.claims) OVER (PARTITION BY per_place.value) AS claimants
            FROM (SELECT c.experience_id, c.value, bool_or(c.claims) AS claims,
                         array_agg(DISTINCT c.basis ORDER BY c.basis) AS basis
                    FROM place_identifier_claims(p_scheme, p_values) c
                   GROUP BY c.experience_id, c.value) per_place) held
$$;
COMMENT ON FUNCTION place_identifiers_expected(TEXT, TEXT[]) IS 'The registry''s rows for these values of one scheme, as place_identifier_claims() makes them (ADR-0143 decision 2): what refresh_place_identifiers() writes and the catalogue check place-identifiers-out-of-step compares.';

-- Every value of each scheme some column carries: what a backfill refreshes
-- and the catalogue check reads the registry against.
CREATE OR REPLACE FUNCTION place_identifier_values()
RETURNS TABLE (scheme TEXT, value TEXT)
LANGUAGE sql STABLE AS $$
  SELECT 'wikidata', external_id::text FROM experience_kind_memberships WHERE external_id ~ '^Q[0-9]+$'
  UNION SELECT 'wikidata', unnest(wikidata_items) FROM experience_kind_memberships WHERE wikidata_items IS NOT NULL
  UNION SELECT 'wikidata', wikidata_item::text FROM experience_locations WHERE wikidata_item IS NOT NULL
  UNION SELECT 'whc', external_id::text FROM experience_kind_memberships WHERE source_id = 1
  UNION SELECT 'whc', external_ref FROM experience_parts WHERE reason = 'component' AND external_ref IS NOT NULL
$$;
COMMENT ON FUNCTION place_identifier_values() IS 'Every value of each scheme a column carries (ADR-0143 decision 2).';

-- Rewrites the registry's rows for these values of one scheme as they are
-- expected, the values locked first. Rows are first made non-identifying, so
-- a value whose place changes never stands identifying on two rows within the
-- statement.
CREATE OR REPLACE FUNCTION refresh_place_identifiers(p_scheme TEXT, p_values TEXT[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  wanted TEXT[];
BEGIN
  SELECT array_agg(DISTINCT v ORDER BY v) INTO wanted FROM unnest(p_values) AS v WHERE v IS NOT NULL;
  IF wanted IS NULL THEN
    RETURN;
  END IF;
  PERFORM lock_place_identifiers(p_scheme, wanted);

  DELETE FROM place_identifiers pi
   WHERE pi.scheme = p_scheme AND pi.value = ANY(wanted)
     AND NOT EXISTS (SELECT 1 FROM place_identifier_claims(p_scheme, wanted) c
                      WHERE c.experience_id = pi.experience_id AND c.value = pi.value);
  UPDATE place_identifiers SET identifies = false
   WHERE scheme = p_scheme AND value = ANY(wanted) AND identifies;
  INSERT INTO place_identifiers AS pi (experience_id, scheme, value, identifies, claims_identity, basis)
  SELECT x.experience_id, p_scheme, x.value, x.identifies, x.claims_identity, x.basis
    FROM place_identifiers_expected(p_scheme, wanted) x
  ON CONFLICT (experience_id, scheme, value) DO UPDATE
     SET identifies = EXCLUDED.identifies, claims_identity = EXCLUDED.claims_identity, basis = EXCLUDED.basis
   WHERE (pi.identifies, pi.claims_identity, pi.basis) IS DISTINCT FROM
         (EXCLUDED.identifies, EXCLUDED.claims_identity, EXCLUDED.basis);
END;
$$;
COMMENT ON FUNCTION refresh_place_identifiers(TEXT, TEXT[]) IS 'Rewrites the registry''s rows for these values of one scheme as place_identifiers_expected() makes them, the values locked for the transaction first (lock_place_identifiers, ADR-0143 decision 2). Called by the triggers on the tables that carry identifiers, and by nothing else but a backfill.';

-- Refreshes every value these places hold in the registry or carry now, and
-- the values a trigger names that the places no longer carry (what an old row
-- carried): what a write to one of them can change. A value is refreshed whole,
-- with every place that carries it, since one place's write can decide
-- another's (a second claimant, a point that stops standing). The keys of
-- every value of both schemes are taken in one pass before either refresh.
CREATE OR REPLACE FUNCTION refresh_place_identifiers_of(
  p_places INTEGER[], p_items TEXT[] DEFAULT NULL, p_refs TEXT[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  items TEXT[];
  refs TEXT[];
BEGIN
  SELECT array_agg(DISTINCT v) INTO items FROM (
    SELECT unnest(p_items) AS v
    UNION ALL
    SELECT value FROM place_identifiers WHERE scheme = 'wikidata' AND experience_id = ANY(p_places)
    UNION ALL
    SELECT external_id FROM experience_kind_memberships
     WHERE experience_id = ANY(p_places) AND external_id ~ '^Q[0-9]+$'
    UNION ALL
    SELECT unnest(wikidata_items) FROM experience_kind_memberships
     WHERE experience_id = ANY(p_places) AND wikidata_items IS NOT NULL
    UNION ALL
    SELECT wikidata_item FROM experience_locations
     WHERE experience_id = ANY(p_places) AND wikidata_item IS NOT NULL) carried
   WHERE v IS NOT NULL;
  SELECT array_agg(DISTINCT v) INTO refs FROM (
    SELECT unnest(p_refs) AS v
    UNION ALL
    SELECT value FROM place_identifiers WHERE scheme = 'whc' AND experience_id = ANY(p_places)
    UNION ALL
    SELECT external_id FROM experience_kind_memberships WHERE experience_id = ANY(p_places) AND source_id = 1
    UNION ALL
    SELECT external_ref FROM experience_parts
     WHERE part_id = ANY(p_places) AND reason = 'component' AND external_ref IS NOT NULL) carried
   WHERE v IS NOT NULL;
  PERFORM lock_place_identifier_keys(ARRAY(
    SELECT place_identifier_lock_key('wikidata', v) FROM unnest(items) AS v
    UNION SELECT place_identifier_lock_key('whc', v) FROM unnest(refs) AS v));
  PERFORM refresh_place_identifiers('wikidata', items);
  PERFORM refresh_place_identifiers('whc', refs);
END;
$$;
COMMENT ON FUNCTION refresh_place_identifiers_of(INTEGER[], TEXT[], TEXT[]) IS 'Refreshes every value these places hold in the registry or carry now, and the Wikidata items and World Heritage references named beside them, all their keys taken in one ordered pass (ADR-0143 decision 2).';

-- One trigger function per table, fired for the rows whose identifying columns
-- changed: the place a row hangs on before and after the write is refreshed.
CREATE OR REPLACE FUNCTION place_identifiers_follow_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A value the old row carried and its place no longer holds is left only on
  -- other places; naming the old values reaches them.
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_place_identifiers_of(ARRAY[NEW.experience_id]);
  ELSE
    PERFORM refresh_place_identifiers_of(
      array_remove(ARRAY[OLD.experience_id, CASE WHEN TG_OP <> 'DELETE' THEN NEW.experience_id END], NULL),
      OLD.wikidata_items || CASE WHEN OLD.external_id ~ '^Q[0-9]+$' THEN OLD.external_id::text END,
      CASE WHEN OLD.source_id = 1 THEN ARRAY[OLD.external_id::text] END);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION place_identifiers_follow_point() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_place_identifiers_of(ARRAY[NEW.experience_id]);
  ELSE
    PERFORM refresh_place_identifiers_of(
      array_remove(ARRAY[OLD.experience_id, CASE WHEN TG_OP <> 'DELETE' THEN NEW.experience_id END], NULL),
      ARRAY[OLD.wikidata_item::text]);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION place_identifiers_follow_part() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_place_identifiers_of(ARRAY[NEW.part_id]);
  ELSE
    PERFORM refresh_place_identifiers_of(
      array_remove(ARRAY[OLD.part_id, CASE WHEN TG_OP <> 'DELETE' THEN NEW.part_id END], NULL),
      NULL, ARRAY[OLD.external_ref]);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION place_identifiers_follow_place() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_place_identifiers_of(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_place_identifiers_membership_write
  AFTER INSERT OR DELETE ON experience_kind_memberships
  FOR EACH ROW EXECUTE FUNCTION place_identifiers_follow_membership();
CREATE OR REPLACE TRIGGER trg_place_identifiers_membership_update
  AFTER UPDATE OF experience_id, source_id, external_id, wikidata_items ON experience_kind_memberships
  FOR EACH ROW
  WHEN ((OLD.experience_id, OLD.source_id, OLD.external_id, OLD.wikidata_items)
        IS DISTINCT FROM (NEW.experience_id, NEW.source_id, NEW.external_id, NEW.wikidata_items))
  EXECUTE FUNCTION place_identifiers_follow_membership();

CREATE OR REPLACE TRIGGER trg_place_identifiers_point_write
  AFTER INSERT OR DELETE ON experience_locations
  FOR EACH ROW EXECUTE FUNCTION place_identifiers_follow_point();
CREATE OR REPLACE TRIGGER trg_place_identifiers_point_update
  AFTER UPDATE OF experience_id, wikidata_item, merged_into_id, missing_since ON experience_locations
  FOR EACH ROW
  WHEN ((OLD.experience_id, OLD.wikidata_item, OLD.merged_into_id IS NULL, OLD.missing_since IS NULL)
        IS DISTINCT FROM (NEW.experience_id, NEW.wikidata_item, NEW.merged_into_id IS NULL, NEW.missing_since IS NULL))
  EXECUTE FUNCTION place_identifiers_follow_point();

CREATE OR REPLACE TRIGGER trg_place_identifiers_part_write
  AFTER INSERT OR DELETE ON experience_parts
  FOR EACH ROW EXECUTE FUNCTION place_identifiers_follow_part();
CREATE OR REPLACE TRIGGER trg_place_identifiers_part_update
  AFTER UPDATE OF part_id, reason, external_ref ON experience_parts
  FOR EACH ROW
  WHEN ((OLD.part_id, OLD.reason, OLD.external_ref) IS DISTINCT FROM (NEW.part_id, NEW.reason, NEW.external_ref))
  EXECUTE FUNCTION place_identifiers_follow_part();

CREATE OR REPLACE TRIGGER trg_place_identifiers_place_merged
  AFTER UPDATE OF merged_into_id ON experiences
  FOR EACH ROW
  WHEN ((OLD.merged_into_id IS NULL) IS DISTINCT FROM (NEW.merged_into_id IS NULL))
  EXECUTE FUNCTION place_identifiers_follow_place();

-- The backfill: every value a column carries, refreshed whole.
SELECT lock_place_identifier_keys(ARRAY(
  SELECT place_identifier_lock_key(v.scheme, v.value) FROM place_identifier_values() v));
SELECT refresh_place_identifiers(v.scheme, array_agg(v.value))
  FROM place_identifier_values() v GROUP BY v.scheme;

COMMIT;
