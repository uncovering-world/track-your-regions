-- 267-standing-is-derived-from-periods.sql
--
-- The clean catalogue model, slice B1 (#1719, ADR-0217, ADR-0225): a period's
-- outer days are what its dates say, and a place's standing today, and each
-- of its memberships', is derived from its periods.
--
-- * period_ok() holds from_first and until_last to date_first() and
--   date_last() (263), on every table that stores a period. The rows of
--   place_periods, record_periods and user_visit_trips are carried to the rule
--   first; every other period table is only checked, and the file stops if a
--   row there does not hold.
-- * place_periods: the primary key moves to id (264 numbered the rows); the
--   one-open-standing index per place gives way to 264's per place and kind;
--   a kind's period belongs to the membership (place_periods_of_membership);
--   a curator's row and a named use are decided ones, and decided_by goes
--   with decided_at (decided_at is carried from updated_at on the rows a
--   curator set); a write that changes a row stamps it
--   (trg_place_periods_stamp).
-- * record_periods: the primary key adds of_membership.
-- * user_visit_trips: the three checks the table was created with, unnamed,
--   take names (month_in_year, day_in_month, real_day), and the outer days
--   are held to the date (outer_days). 266 filled them; the trips written
--   since are filled again here.
-- * Standing: stands_on_day() reads a place's stood rows, and its kind's,
--   on a day, a period that begins on a day still ahead included;
--   refresh_standing() writes experiences.stands_today and
--   source_records.stands_today from it, called by one statement-level
--   trigger per event on place_periods (trg_derive_standing_*), by
--   trg_source_record_stands when a membership is written or moved, and by
--   refresh_standing_due(), which the backend's standing sweep runs hourly.
--   record_stands_is_derived() and stands_today_is_derived() refuse any other
--   value. They replace trg_derive_stands_today, derive_stands_today() and
--   place_stands().
-- * Crowding: crowding_above(), recount_crowding() and refresh_crowding()
--   leave out a place that does not stand today and a membership whose
--   standing ended, as hideLostSql and membershipStandsSql do, and a change
--   of a membership's standing recounts around it
--   (crowding_follows_membership_change). The fame is scored and the whole
--   catalogue recounted once the standing columns are written.
-- * idx_source_records_reader carries stands_today beside id, so a list's,
--   a count's and the map's question of a membership's standing
--   (membershipStandsSql) is answered inside the index, as its admission,
--   gate and crowding are.
--
-- Every shape change comes first, and the standing columns are written last:
-- source_records carries deferred triggers (the crowding ones), and no ALTER
-- may meet their pending events (db/migrations/README.md). place_periods and
-- user_visit_trips carry none, so their rows are carried before the
-- constraints that need them. Re-runnable: each step is guarded or writes
-- only a row that differs. Runs before the next re-application of
-- 01-schema.sql, which declares the same.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- The period block: outer days are what the dates say
-- ---------------------------------------------------------------------------

UPDATE place_periods
   SET from_first = date_first(from_year, from_month, from_day, from_span),
       until_last = date_last(until_year, until_month, until_day, until_span)
 WHERE (from_first, until_last) IS DISTINCT FROM
       (date_first(from_year, from_month, from_day, from_span), date_last(until_year, until_month, until_day, until_span));

UPDATE record_periods
   SET from_first = date_first(from_year, from_month, from_day, from_span),
       until_last = date_last(until_year, until_month, until_day, until_span)
 WHERE (from_first, until_last) IS DISTINCT FROM
       (date_first(from_year, from_month, from_day, from_span), date_last(until_year, until_month, until_day, until_span));

UPDATE user_visit_trips
   SET first_day = date_first(year::integer, month, day, NULL),
       last_day = date_last(year::integer, month, day, NULL)
 WHERE (first_day, last_day) IS DISTINCT FROM
       (date_first(year::integer, month, day, NULL), date_last(year::integer, month, day, NULL));

CREATE OR REPLACE FUNCTION period_ok(
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT, from_span TEXT, from_circa BOOLEAN,
    ended BOOLEAN,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT, until_span TEXT, until_circa BOOLEAN,
    from_first INTEGER, until_last INTEGER
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT approx_date_ok(from_year, from_month, from_day, from_span, from_circa)
       AND approx_date_ok(until_year, until_month, until_day, until_span, until_circa)
       AND (ended OR until_year IS NULL)
       AND from_first IS NOT DISTINCT FROM date_first(from_year, from_month, from_day, from_span)
       AND until_last IS NOT DISTINCT FROM date_last(until_year, until_month, until_day, until_span)
       AND (from_first IS NULL OR until_last IS NULL OR from_first <= until_last);
$$;

-- Replacing a function re-checks no row, so every CHECK that calls period_ok()
-- is asked of every row of its table here.
DO $$
DECLARE
    c RECORD;
    bad BIGINT;
BEGIN
    FOR c IN SELECT con.conrelid::regclass AS tbl, con.conname,
                    regexp_replace(pg_get_constraintdef(con.oid), '^CHECK ', '') AS expr
               FROM pg_constraint con
              WHERE con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%period_ok(%'
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE (%s) IS FALSE', c.tbl, c.expr) INTO bad;
        IF bad > 0 THEN
            RAISE EXCEPTION '267: % rows of % fail %', bad, c.tbl, c.conname;
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- place_periods
-- ---------------------------------------------------------------------------

-- A curator's rows were set by a curator: decided when last written.
UPDATE place_periods SET decided_at = updated_at
 WHERE decided_at IS NULL AND (decided_by IS NOT NULL OR source_id = 11);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                    WHERE con.conrelid = 'place_periods'::regclass AND con.contype = 'p'
                      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                               WHERE attrelid = 'place_periods'::regclass AND attname = 'id')]) THEN
        ALTER TABLE place_periods DROP CONSTRAINT place_periods_pkey;
        ALTER TABLE place_periods ADD CONSTRAINT place_periods_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_of_membership' AND conrelid = 'place_periods'::regclass) THEN
        ALTER TABLE place_periods ADD CONSTRAINT place_periods_of_membership FOREIGN KEY (experience_id, kind_id)
            REFERENCES source_records (experience_id, kind_id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_use_is_answered' AND conrelid = 'place_periods'::regclass) THEN
        ALTER TABLE place_periods ADD CONSTRAINT place_periods_use_is_answered
            CHECK (says <> 'used' OR (use_item IS NULL AND what IS NULL) OR decided_at IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_curator_decides' AND conrelid = 'place_periods'::regclass) THEN
        ALTER TABLE place_periods ADD CONSTRAINT place_periods_curator_decides CHECK (source_id <> 11 OR decided_at IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_decided_pair' AND conrelid = 'place_periods'::regclass) THEN
        ALTER TABLE place_periods ADD CONSTRAINT place_periods_decided_pair CHECK (decided_by IS NULL OR decided_at IS NOT NULL);
    END IF;
END $$;

-- 264's index per place and kind holds one open standing period each.
DROP INDEX IF EXISTS idx_place_periods_standing;

-- ---------------------------------------------------------------------------
-- record_periods
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                    WHERE con.conrelid = 'record_periods'::regclass AND con.contype = 'p'
                      AND (SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'record_periods'::regclass AND attname = 'of_membership') = ANY (con.conkey)) THEN
        ALTER TABLE record_periods DROP CONSTRAINT record_periods_pkey;
        ALTER TABLE record_periods ADD CONSTRAINT record_periods_pkey PRIMARY KEY (record_id, of_membership, says, ordinal);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- user_visit_trips
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'user_visit_trips'::regclass AND contype = 'c' AND conname ~ '^user_visit_trips_check[0-9]*$'
    LOOP
        EXECUTE format('ALTER TABLE user_visit_trips DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_month_in_year' AND conrelid = 'user_visit_trips'::regclass) THEN
        ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_month_in_year CHECK (month IS NULL OR year IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_day_in_month' AND conrelid = 'user_visit_trips'::regclass) THEN
        ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_day_in_month CHECK (day IS NULL OR month IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_real_day' AND conrelid = 'user_visit_trips'::regclass) THEN
        ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_real_day CHECK (day IS NULL OR make_date(year, month, day) IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_outer_days' AND conrelid = 'user_visit_trips'::regclass) THEN
        ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_outer_days CHECK (
            first_day IS NOT DISTINCT FROM date_first(year::integer, month, day, NULL)
            AND last_day IS NOT DISTINCT FROM date_last(year::integer, month, day, NULL));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Standing, derived from the periods
-- ---------------------------------------------------------------------------

-- Whether a place stands on a day (ADR-0217 decisions 2 and 5): its stood rows
-- that name no kind are none, or one of them is open and has begun on or
-- before the day; and, where a kind is given, the same of that kind's own
-- stood rows. Only 'stood' is read: a use (Göbekli Tepe, abandoned about
-- 7000 BC), a closure or an occurrence never moves it. PL/pgSQL, so its probes
-- keep their plans across the calls of a run.
CREATE OR REPLACE FUNCTION stands_on_day(rec INTEGER, kind INTEGER, day INTEGER) RETURNS BOOLEAN AS $$
BEGIN
    RETURN (NOT EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = rec AND p.kind_id IS NULL AND p.says = 'stood')
            OR EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = rec AND p.kind_id IS NULL AND p.says = 'stood'
                         AND NOT p.ended AND (p.from_first IS NULL OR p.from_first <= day)))
       AND (kind IS NULL
            OR NOT EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = rec AND p.kind_id = kind AND p.says = 'stood')
            OR EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = rec AND p.kind_id = kind AND p.says = 'stood'
                         AND NOT p.ended AND (p.from_first IS NULL OR p.from_first <= day)));
END;
$$ LANGUAGE plpgsql STABLE;

-- Rewrites the two derived standing columns of these places, only where they
-- differ: experiences.stands_today from the stood rows that name no kind
-- (Nelson's Pillar, stood until 8 March 1966: false), and each membership's
-- source_records.stands_today from those and its kind's own (Frick Madison's
-- Art Museums membership, ended 3 March 2024: false, while the building
-- stands). A record in a whole (no kind) is true: standing is its place's own.
CREATE OR REPLACE FUNCTION refresh_standing(recs INTEGER[]) RETURNS void AS $$
DECLARE
    today INTEGER := current_day_index();
BEGIN
    UPDATE experiences e
       SET stands_today = x.stands
      FROM (SELECT r AS id, stands_on_day(r, NULL, today) AS stands
              FROM unnest(recs) AS r WHERE r IS NOT NULL) x
     WHERE e.id = x.id AND e.stands_today IS DISTINCT FROM x.stands;

    UPDATE source_records s
       SET stands_today = x.stands
      FROM (SELECT sr.id, CASE WHEN sr.kind_id IS NULL THEN true
                               ELSE stands_on_day(sr.experience_id, sr.kind_id, today) END AS stands
              FROM source_records sr
             WHERE sr.experience_id = ANY (recs)) x
     WHERE s.id = x.id AND s.stands_today IS DISTINCT FROM x.stands;
END;
$$ LANGUAGE plpgsql;

-- After every write to place_periods, re-derives standing for the places whose
-- stood rows changed. One trigger per event, since PostgreSQL refuses
-- transition tables on a trigger with several events or a column list; the
-- update keeps the rows whose place, kind, what they say, end or outer days
-- changed, so a write of a use's words costs one join and no refresh. A merge
-- moving a membership carries its kind's rows (ON UPDATE CASCADE from
-- source_records) and re-derives both places.
CREATE OR REPLACE FUNCTION place_periods_follow() RETURNS trigger AS $$
DECLARE
    stood_recs INTEGER[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT experience_id) FILTER (WHERE says = 'stood') INTO stood_recs FROM new_periods;
    ELSIF TG_OP = 'DELETE' THEN
        SELECT array_agg(DISTINCT experience_id) FILTER (WHERE says = 'stood') INTO stood_recs FROM old_periods;
    ELSE
        WITH changed AS (
            SELECT o.experience_id AS rec, o.says AS was, n.experience_id AS rec_now, n.says AS now_says
              FROM old_periods o JOIN new_periods n ON n.id = o.id
             WHERE (o.experience_id, o.kind_id, o.says, o.ended, o.from_first, o.until_last)
                   IS DISTINCT FROM (n.experience_id, n.kind_id, n.says, n.ended, n.from_first, n.until_last))
        SELECT array_agg(DISTINCT rec) INTO stood_recs
          FROM (SELECT rec FROM changed WHERE was = 'stood'
                UNION ALL
                SELECT rec_now FROM changed WHERE now_says = 'stood') x;
    END IF;
    IF stood_recs IS NOT NULL THEN
        PERFORM refresh_standing(stood_recs);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_stands_today ON place_periods;
DROP TRIGGER IF EXISTS trg_derive_standing_insert ON place_periods;
CREATE TRIGGER trg_derive_standing_insert
    AFTER INSERT ON place_periods
    REFERENCING NEW TABLE AS new_periods
    FOR EACH STATEMENT EXECUTE FUNCTION place_periods_follow();
DROP TRIGGER IF EXISTS trg_derive_standing_update ON place_periods;
CREATE TRIGGER trg_derive_standing_update
    AFTER UPDATE ON place_periods
    REFERENCING OLD TABLE AS old_periods NEW TABLE AS new_periods
    FOR EACH STATEMENT EXECUTE FUNCTION place_periods_follow();
DROP TRIGGER IF EXISTS trg_derive_standing_delete ON place_periods;
CREATE TRIGGER trg_derive_standing_delete
    AFTER DELETE ON place_periods
    REFERENCING OLD TABLE AS old_periods
    FOR EACH STATEMENT EXECUTE FUNCTION place_periods_follow();
DROP FUNCTION IF EXISTS derive_stands_today();

-- The writer stamps updated_at (db/placePeriodsWriter.ts, ADR-0069); a write
-- that changes a row and leaves it unstamped is refused, so a period's last
-- change is always dated. A membership moved by a merge or a separation
-- carries its kind's rows by ON UPDATE CASCADE, which changes experience_id
-- (and kind_id) alone: that is the move's, not a period's change, and passes.
-- So does the deletion of the account that decided a period, whose
-- ON DELETE SET NULL clears decided_by alone: the act outlives the account,
-- and decided_at still dates it.
CREATE OR REPLACE FUNCTION place_periods_stamped() RETURNS trigger AS $$
BEGIN
    IF (to_jsonb(NEW) - 'experience_id' - 'kind_id' - 'decided_by') IS DISTINCT FROM (to_jsonb(OLD) - 'experience_id' - 'kind_id' - 'decided_by')
       OR (NEW.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
        RAISE EXCEPTION 'place_periods row % changed without a new updated_at: the writer stamps it (placePeriodsWriter)',
            NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_place_periods_stamp ON place_periods;
CREATE TRIGGER trg_place_periods_stamp
    BEFORE UPDATE ON place_periods
    FOR EACH ROW WHEN (OLD.updated_at = NEW.updated_at)
    EXECUTE FUNCTION place_periods_stamped();

-- A membership takes its standing when it is written or moved: Nelson's
-- Pillar, gone since 1966, gaining a Monuments & memorials membership has it
-- written false at once, not at the next period write. A record in a whole is
-- true (standing is its place's own).
CREATE OR REPLACE FUNCTION source_record_stands() RETURNS trigger AS $$
BEGIN
    NEW.stands_today := CASE WHEN NEW.kind_id IS NULL THEN true
                             ELSE stands_on_day(NEW.experience_id, NEW.kind_id, current_day_index()) END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_source_record_stands ON source_records;
CREATE TRIGGER trg_source_record_stands
    BEFORE INSERT OR UPDATE OF experience_id, kind_id ON source_records
    FOR EACH ROW EXECUTE FUNCTION source_record_stands();

-- source_records.stands_today is derived and never set (ADR-0217 decision 5):
-- an update may write only what the periods say, which is what
-- refresh_standing() and trg_source_record_stands write.
CREATE OR REPLACE FUNCTION record_stands_is_derived() RETURNS trigger AS $$
DECLARE
    derived BOOLEAN := CASE WHEN NEW.kind_id IS NULL THEN true
                            ELSE stands_on_day(NEW.experience_id, NEW.kind_id, current_day_index()) END;
BEGIN
    IF NEW.stands_today IS DISTINCT FROM derived THEN
        RAISE EXCEPTION 'source_records.stands_today is derived from place_periods: record % says %',
            NEW.id, derived USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_record_stands_is_derived ON source_records;
CREATE TRIGGER trg_record_stands_is_derived
    AFTER UPDATE OF stands_today ON source_records
    FOR EACH ROW WHEN (OLD.stands_today IS DISTINCT FROM NEW.stands_today)
    EXECUTE FUNCTION record_stands_is_derived();

-- experiences.stands_today is derived and never set: a new place holds no
-- period and so stands, and an update may only write what the periods say,
-- which is what refresh_standing() writes. The two triggers fire after the row
-- is written, as every trigger on experiences does, and only for a statement
-- that names a value other than the one the row would hold anyway.
CREATE OR REPLACE FUNCTION stands_today_is_derived() RETURNS trigger AS $$
DECLARE
    derived BOOLEAN := stands_on_day(NEW.id, NULL, current_day_index());
BEGIN
    IF NEW.stands_today IS DISTINCT FROM derived THEN
        RAISE EXCEPTION 'experiences.stands_today is derived from place_periods: the periods of place % say %',
            NEW.id, derived USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_place_stands ON experiences;
CREATE TRIGGER trg_new_place_stands
    AFTER INSERT
    ON experiences
    FOR EACH ROW WHEN (NOT NEW.stands_today) EXECUTE FUNCTION stands_today_is_derived();

DROP TRIGGER IF EXISTS trg_stands_today_is_derived ON experiences;
CREATE TRIGGER trg_stands_today_is_derived
    AFTER UPDATE OF stands_today
    ON experiences
    FOR EACH ROW WHEN (OLD.stands_today IS DISTINCT FROM NEW.stands_today) EXECUTE FUNCTION stands_today_is_derived();
DROP FUNCTION IF EXISTS place_stands(INTEGER);

-- A standing period may begin on a day still ahead (ADR-0217 decision 2: a
-- place opens on its opening day), so the derived columns move on that day
-- with no write to the periods. Run every hour by the backend's standing sweep
-- (services/standingSweep.ts): re-derives every place with an open stood row
-- that has begun (idx_place_periods_begins) while the place, or its
-- membership in the row's kind, is still stored as not standing, only where a
-- column differs. Read from what is stored rather than from a window of days,
-- so an opening is caught however long ago its day passed: a sweep that
-- missed an hour, a day or a year opens it at the next.
CREATE OR REPLACE FUNCTION refresh_standing_due() RETURNS void AS $$
DECLARE
    today INTEGER := current_day_index();
    due INTEGER[];
BEGIN
    SELECT array_agg(DISTINCT p.experience_id) INTO due
      FROM place_periods p
     WHERE p.says = 'stood' AND NOT p.ended AND p.from_first IS NOT NULL AND p.from_first <= today
       AND CASE WHEN p.kind_id IS NULL
                THEN EXISTS (SELECT 1 FROM experiences e WHERE e.id = p.experience_id AND NOT e.stands_today)
                ELSE EXISTS (SELECT 1 FROM source_records s
                              WHERE s.experience_id = p.experience_id AND s.kind_id = p.kind_id AND NOT s.stands_today) END;
    IF due IS NOT NULL THEN
        PERFORM refresh_standing(due);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Crowding: a place or a membership that does not stand today is no candidate
-- ---------------------------------------------------------------------------

-- The candidates of a kind and type within `within_km` of `at_point` that
-- count above a membership whose fame is `above_score`: the better known and
-- the ones a curator keeps in the list (ADR-0180), never one a curator keeps in
-- the shadow nor one holding a work a reader is shown (ADR-0173). The
-- membership's own pin is not read, so the set says where the rule puts it
-- whatever a curator answered. A membership with no score is outranked by pins
-- alone. What the curator's window lists as the places a place is compared
-- with (ADR-0183, #2358), and what crowding_better() counts, so the two never differ.
-- A set-returning SQL function, so the planner inlines it, and through
-- crowding_better() into the recount's lateral join, as if it were spelled
-- there: as a scalar function called per candidate, a full recount took 5.7 s
-- on the development catalogue against 2.1 s.
CREATE OR REPLACE FUNCTION crowding_above(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (membership_id integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT d.id
    FROM source_records d
    JOIN experiences de ON de.id = d.experience_id
    LEFT JOIN membership_fame df ON df.membership_id = d.id
   WHERE d.kind_id = of_kind AND d.type IS NOT DISTINCT FROM of_type AND d.id <> of_member
     AND de.location && crowding_box(at_point, within_km)
     AND ST_DWithin(de.location::geography, at_point::geography, within_km * 1000)
     AND d.admission <> 'refused' AND de.existence <> 'lost' AND de.stands_today AND d.stands_today
     AND d.crowding_pin IS DISTINCT FROM 'shadow'
     AND (d.crowding_pin = 'list' OR df.score > above_score)
     AND NOT place_shows_works(de.id)
$$;

-- Recount the crowded-out memberships of every place within its kind's radius
-- of `near`, or of the whole catalogue when `near` is null. A candidate is an
-- admitted membership of a kind that declares the rule, standing in it today,
-- on a place that is not lost, stands today and has a point, of a type the
-- kind does not exempt; db/membership.ts states the same set
-- (membershipAdmittedSql, membershipStandsSql, hideLostSql). Nelson's Pillar,
-- gone since 1966, and Frick Madison in Art Museums, ended in 2024, take no
-- slot of a standing neighbour.
-- It is crowded out when a curator keeps it in the shadow, or when it has a
-- score and crowding_better() reaches the limit, unless a curator keeps it in
-- the list (ADR-0180).
--
-- One recount at a time, until its transaction ends: two whose areas overlap
-- would each delete what the other has not committed and insert the same
-- membership twice. Under the lock every statement after it sees what the
-- previous recount committed. The key's class is #2201, as a place
-- identifier's is #1143 (lock_place_identifier_keys).
CREATE OR REPLACE FUNCTION recount_crowding(near geometry DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(2201, 0);

  DELETE FROM membership_crowding mc
   USING source_records m, experiences e, experience_kinds k
   WHERE mc.membership_id = m.id AND e.id = m.experience_id AND k.id = m.kind_id
     AND (near IS NULL OR k.crowding_radius_km IS NULL
          OR (e.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(e.location::geography, near::geography, k.crowding_radius_km * 1000)));

  INSERT INTO membership_crowding (membership_id, outranked_by)
  SELECT c.id, n.better
    FROM source_records c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id
    LEFT JOIN membership_fame cf ON cf.membership_id = c.id
    CROSS JOIN LATERAL crowding_better(c.kind_id, c.type, c.id, ce.location, k.crowding_radius_km, cf.score) n
   WHERE c.admission <> 'refused' AND ce.existence <> 'lost' AND ce.stands_today AND c.stands_today
     AND ce.location IS NOT NULL
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

-- Score every candidate among its kind and type worldwide, then recount the
-- whole catalogue: what the run's after-step calls once the fame is written.
-- Answers how many memberships are crowded out.
CREATE OR REPLACE FUNCTION refresh_crowding() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE crowded integer;
BEGIN
  WITH candidates AS (
    SELECT f.membership_id, m.kind_id, m.type, f.readers, f.guide_editions, f.wikipedia_editions
      FROM membership_fame f
      JOIN source_records m ON m.id = f.membership_id
      JOIN experience_kinds k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.admission <> 'refused' AND e.existence <> 'lost' AND e.stands_today AND m.stands_today
       AND e.location IS NOT NULL
       AND (m.type IS NULL OR m.type <> ALL(k.crowding_exempt_types))
  ), scored AS (
    SELECT membership_id,
           ((percent_rank() OVER (PARTITION BY kind_id, type ORDER BY readers)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY guide_editions > 0)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY wikipedia_editions)) / 3)::real AS score
      FROM candidates
  )
  UPDATE membership_fame f SET score = s.score
    FROM membership_fame f2 LEFT JOIN scored s ON s.membership_id = f2.membership_id
   WHERE f.membership_id = f2.membership_id AND f.score IS DISTINCT FROM s.score;

  PERFORM recount_crowding(NULL);
  SELECT count(*) INTO crowded FROM membership_crowding;
  RETURN crowded;
END $$;

-- A membership's candidacy or a curator's pin on it changes: recount around
-- its place. Its standing is among its candidacy, and refresh_standing()
-- writes a place's standing into every membership of it in the same
-- statement, so a place's opening or end is recounted here. An insert changes nothing, since a membership has no score until
-- the next refresh and no pin until a curator answers.
-- Separate functions per table, so neither reads a field the other's row lacks.
-- The triggers are deferred to the commit: the recount's lock is then held for
-- the last moment of a transaction rather than across a run's sweep, which
-- goes on locking memberships a curator's write may be waiting on.
CREATE OR REPLACE FUNCTION crowding_follows_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE point geometry;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF EXISTS (SELECT 1 FROM experience_kinds WHERE id = OLD.kind_id AND crowding_limit IS NOT NULL) THEN
      SELECT location INTO point FROM experiences WHERE id = OLD.experience_id;
      IF point IS NOT NULL THEN PERFORM recount_crowding(point); END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.experience_id IS DISTINCT FROM OLD.experience_id OR NEW.kind_id IS DISTINCT FROM OLD.kind_id)
       AND EXISTS (SELECT 1 FROM experience_kinds WHERE id = NEW.kind_id AND crowding_limit IS NOT NULL) THEN
      SELECT location INTO point FROM experiences WHERE id = NEW.experience_id;
      IF point IS NOT NULL THEN PERFORM recount_crowding(point); END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_membership_change ON source_records;
CREATE CONSTRAINT TRIGGER crowding_follows_membership_change
  AFTER UPDATE OF admission, type, kind_id, experience_id, crowding_pin, stands_today ON source_records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.admission IS DISTINCT FROM NEW.admission OR OLD.type IS DISTINCT FROM NEW.type
        OR OLD.kind_id IS DISTINCT FROM NEW.kind_id OR OLD.experience_id IS DISTINCT FROM NEW.experience_id
        OR OLD.crowding_pin IS DISTINCT FROM NEW.crowding_pin OR OLD.stands_today IS DISTINCT FROM NEW.stands_today)
  EXECUTE FUNCTION crowding_follows_membership();

COMMENT ON COLUMN membership_fame.score IS 'The mean of three percentiles among the candidates of the same kind and type worldwide, set by refresh_crowding(): readers a year, whether a Wikivoyage edition uses the item (a presence, not a count, ADR-0177), and Wikipedia editions. Null for a membership that is no candidate (refused, its place lost, it or its place not standing today, or of a type its kind exempts, ADR-0179), or one measured since the last refresh.';

-- ---------------------------------------------------------------------------
-- The reader's index carries the membership's standing
-- ---------------------------------------------------------------------------

-- Every list, count and map read asks a membership's standing beside the two
-- terms the index is partial on; without the column each probe fetched the
-- membership from the heap. Rebuilt only where it does not carry it yet, and
-- here, before the standing columns are written: a CREATE INDEX may not meet
-- the deferred crowding triggers' pending events (db/migrations/README.md).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE tablename = 'source_records' AND indexname = 'idx_source_records_reader'
                      AND indexdef LIKE '%INCLUDE (id, stands_today)%') THEN
        DROP INDEX IF EXISTS idx_source_records_reader;
        CREATE INDEX idx_source_records_reader
            ON source_records(experience_id, kind_id) INCLUDE (id, stands_today)
            WHERE admission <> 'refused' AND curation_state <> 'pending';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The standing columns, derived once over every place that holds a period,
-- and the crowding scored and recounted over the candidates they leave
-- ---------------------------------------------------------------------------

SELECT refresh_standing(ARRAY(SELECT DISTINCT experience_id FROM place_periods));
SELECT refresh_crowding();

COMMIT;
