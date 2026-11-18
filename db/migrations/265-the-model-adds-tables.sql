-- 265-the-model-adds-tables.sql
--
-- The clean catalogue model, additive half, step 3 of 4 (#2634): the new
-- tables that hang only on tables of today, with the triggers that guard their
-- own rows. Nothing of today's code reads or writes any of them, so they
-- arrive empty and 266 fills those whose rows today's catalogue already
-- states. The one trigger on a table of today, regions_delete_reasks_held_at
-- on regions, writes only experience_relations, which holds no row until
-- the slice of #2458 that moves the relations' writer.
--
-- * region_changes (ADR-0219 decision 6): each structural change of a region.
-- * experience_sync_bars (ADR-0175): a run's admission bars, in place of
--   experience_sync_logs.world_bars.
-- * record_geometries (ADR-0146, ADR-0059 decision 2): a source record's view
--   of an outline or a line, with its OpenStreetMap provenance; the two
--   foreign keys experiences.boundary_view_id and path_view_id are added with
--   it, deferred, keyed on the place so a place shows only its own records'
--   views.
-- * experience_websites, experience_makers, experience_subject_lines,
--   experience_subjects: what a record holds beside its row, in place of
--   metadata keys and source_records.facts.makers.
-- * record_listings, place_seasons, place_past_positions,
--   place_past_position_regions, experience_time_proposals (ADR-0217): a
--   record's list periods, a place's seasons and past positions, and the
--   proposals of time a run makes.
-- * record_heritage_inscriptions, record_danger_periods, record_rule_reads:
--   the typed facts of a membership, in place of source_records.facts.
-- * experience_lies_within, experience_relations,
--   experience_relation_periods, experience_series_proposals: relations
--   between records beside part-of.
-- * experience_treasure_periods, experience_treasure_period_views: when a
--   work was at a venue, as a curator settled it and as each source said.
-- * place_arrival_points (ADR-0218 decision 7): where a traveller arrives.
-- * settlements, settlement_names: the places a traveller names a trip by.
--
-- The triggers here guard each table's own rows (an inscription only on a
-- World Heritage membership, a class read only as an item, a relation's
-- periods only on held_at and never overlapping, a relation with periods
-- staying held_at, a record's Danger List stays never overlapping and in
-- order, a work's periods never overlapping, an arrival point only on ground)
-- and keep experience_treasures.here_today, a column only this table's rows
-- move. held_at_on() reads where an event was held on a trip's days (a
-- relation with no period holds for every date). A region delete re-asks
-- every held_at relation on it rather than failing on it (#2634): the
-- relation loses its target and is proposed again. The
-- triggers that derive rows of today's tables from these (the listing's
-- source_membership, the regions a relation or a past position places a
-- record in, the trips a link period decides) come with the slices that move
-- the writers (the slices of #2458).
--
-- A "Writer" line below names the module ADR-0069 makes a table's only
-- writer; that module writes the table from the slice of #2458 that moves it,
-- and nothing but 266 writes it before. A trigger a comment marks "with its
-- slice of #2458" is not created here and comes with that slice.
--
-- Re-runnable: CREATE TABLE and CREATE INDEX IF NOT EXISTS, constraints added
-- where missing, functions CREATE OR REPLACE, triggers dropped before they are
-- created. Order-independent with 01-schema.sql, which declares the same.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Each structural change of a region, marked as a redrawing or a replacement as an entity
-- (ADR-0219 decision 6). Writer: db/regionWriter.ts, in the transaction of the change.
-- A plain member edit writes no row: a region whose members or outline change is the same region.
CREATE TABLE IF NOT EXISTS region_changes (
    id                  SERIAL CONSTRAINT region_changes_pkey PRIMARY KEY,
    world_view_id       integer NOT NULL CONSTRAINT region_changes_world_view_id_fkey REFERENCES world_views(id) ON DELETE CASCADE,
    -- the region changed. SET NULL when a redrawing deletes it; the row stays as the
    -- history of what happened to it.
    region_id           integer CONSTRAINT region_changes_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
    -- its name at the change: "Languedoc-Roussillon".
    region_name         varchar(255) NOT NULL,
    -- 'redrawn': nothing changed in fact, ticks carry over (Languedoc-Roussillon into Occitanie, 2016).
    -- 'replaced': a change of country or power; the region is closed and kept (Artsakh, 2024).
    kind                varchar(10) NOT NULL CONSTRAINT region_changes_kind_check CHECK (kind IN ('redrawn', 'replaced')),
    -- what the editor did (@tyr/shared/regionChanges):
    act                 varchar(14) NOT NULL CONSTRAINT region_changes_act_check CHECK (act IN
                          ('deleted', 'merged', 'flattened', 'pruned', 'split', 'gained_children',
                           'view_replaced', 'closed')),
    -- S, the region the old one's ticks and placements went to (a merge's target, a flatten's parent,
    -- else the parent; the covering region of a replacing view). NULL on a closing and on a split.
    successor_region_id integer CONSTRAINT region_changes_successor_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
    decided_by          integer CONSTRAINT region_changes_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT region_changes_kind_act CHECK ((kind = 'replaced') = (act = 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_region_changes_region ON region_changes (region_id) WHERE region_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_region_changes_view ON region_changes (world_view_id, decided_at DESC);

-- The bars a run measured on each kind's pool (ADR-0175 decisions 1 and 5), in place
-- of world_bars jsonb: a kind's line is the bar of its last real, closed run that read the
-- pool, and the card shows a membership's figures beside the kind's median.
-- Writer (ADR-0069): the run's admission step, services/sync/admissionStep.ts, at the run's close; nothing else. A platform beside Wikipedia (#2630) enters the key in its own slice.
CREATE TABLE IF NOT EXISTS experience_sync_bars (
    sync_log_id  integer NOT NULL CONSTRAINT experience_sync_bars_sync_log_id_fkey REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    kind_id      integer NOT NULL CONSTRAINT experience_sync_bars_kind_id_fkey REFERENCES experience_kinds(id),
    tier         varchar(12) NOT NULL CONSTRAINT experience_sync_bars_tier_check CHECK (tier IN ('world','surroundings')),
    signal       varchar(10) NOT NULL CONSTRAINT experience_sync_bars_signal_check CHECK (signal IN ('editions','readers','guides')),
    statistic    varchar(8)  NOT NULL CONSTRAINT experience_sync_bars_statistic_check CHECK (statistic IN ('enter','stay','median')),
    value        real NOT NULL CONSTRAINT experience_sync_bars_value_check CHECK (value >= 0),
    -- The readership year the bar was measured on: 2025 for a run of 2026 that read
    -- the last twelve complete months' dumps. NULL on an editions or guides bar.
    readers_year smallint CONSTRAINT experience_sync_bars_readers_year_check CHECK (readers_year > 2000),
    -- A run that had no readership year keeps the bars of an earlier run (ADR-0175 d6) and
    -- names it, so the admin reads which run's bars admitted.
    kept_from_sync_log_id integer CONSTRAINT experience_sync_bars_kept_from_sync_log_id_fkey REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    CONSTRAINT experience_sync_bars_pkey PRIMARY KEY (sync_log_id, kind_id, tier, signal, statistic)
);

CREATE TABLE IF NOT EXISTS record_geometries (
    id            serial CONSTRAINT record_geometries_pkey PRIMARY KEY,
    -- The source record whose view this is. Its source owns it (ADR-0146): Archaeology's (5)
    -- record of Pompeii holds the excavation polygon; Bridges' (8) record of the Øresund Bridge
    -- holds its line; a World Heritage component's part record may one day hold the
    -- component's inscribed polygon. A separation or merge moves the record and the view with it.
    record_id     integer NOT NULL,
    -- The record's place, carried with the record by the composite key below (ON UPDATE CASCADE: a
    -- separation or a merge that moves the source record moves the view with it), so experiences can only show a
    -- view of one of its own source records (ADR-0146: a view is its own record's). Pompeii shows Archaeology's
    -- outline of Pompeii; it cannot show another place's.
    experience_id integer NOT NULL,
    -- What the geometry outlines: 'outline' (the thing itself: a World Heritage property's
    -- inscribed area, a square's surface, a town's built quarter), 'buffer' (a World Heritage
    -- buffer zone: kept, never shown as the record's outline, ADR-0218 d6; Yakushima),
    -- 'line' (a bridge's deck, a canal, a trail's route).
    role          varchar(7) NOT NULL CONSTRAINT record_geometries_role_check CHECK (role IN ('outline', 'buffer', 'line')),
    geom          geometry(Geometry, 4326) NOT NULL,
    -- Whose data it is, for the credit and the separable extract: 'osm' ("© OpenStreetMap
    -- contributors", ODbL, ADR-0059 d3). A source whose polygons are under another licence
    -- adds its word here with its credit.
    origin        varchar(8) NOT NULL DEFAULT 'osm' CONSTRAINT record_geometries_origin_check CHECK (origin IN ('osm')),
    -- The objects it was built from: {relation/20039866} for the Øresund Bridge's line;
    -- {way/1155256213} for Nemrut's excavation outline.
    object_refs   text[] NOT NULL,
    -- The tag that made the object count: 'historic=archaeological_site', 'bridge=yes',
    -- 'route=hiking'. NULL where the source read the object by its item alone.
    tag_read      varchar(100),
    -- The door OpenStreetMap answered through (ADR-0134): 'local' (the layer), 'qlever',
    -- 'overpass' (OsmReaderName).
    door          varchar(8) NOT NULL CONSTRAINT record_geometries_door_check CHECK (door IN ('local', 'qlever', 'overpass')),
    -- The instant the data was current to: the layer's replication timestamp, or the live
    -- read. Replaces experiences.path_updated_at.
    read_at       timestamptz NOT NULL,
    -- The run no longer finds the objects, but a curator's claim shows this view, so it is
    -- kept (ADR-0146 d4: a claim refuses every run). NULL otherwise: an unclaimed view the
    -- source lost is deleted (ADR-0212 d3).
    missing_since timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    -- One view per source record and role: no history of lines (#1948: "no line versions
    -- are kept"; the PCT's 2018 reroute changes nothing stored).
    CONSTRAINT record_geometries_one_per_role UNIQUE (record_id, role),
    CONSTRAINT record_geometries_id_experience UNIQUE (id, experience_id),
    CONSTRAINT record_geometries_of_record FOREIGN KEY (record_id, experience_id)
        REFERENCES source_records (id, experience_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT record_geometries_type_fits_role CHECK (
        CASE role WHEN 'line' THEN GeometryType(geom) = 'MULTILINESTRING'
                  ELSE GeometryType(geom) = 'MULTIPOLYGON' END),
    CONSTRAINT record_geometries_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom)),
    CONSTRAINT record_geometries_names_objects CHECK (cardinality(object_refs) >= 1),
    CONSTRAINT record_geometries_osm_refs CHECK (origin <> 'osm' OR
        array_to_string(object_refs, ',') ~ '^(node|way|relation)/[0-9]+(,(node|way|relation)/[0-9]+)*$')
);
-- The check of claimed views whose source lost them.
CREATE INDEX IF NOT EXISTS idx_record_geometries_missing ON record_geometries (record_id) WHERE missing_since IS NOT NULL;

-- record_geometries is searched by its record's place and role on every pick of a shown view.
CREATE INDEX IF NOT EXISTS idx_record_geometries_experience ON record_geometries (experience_id, role);

-- experiences' shown views, added once record_geometries exists (the cycle experiences → record_geometries →
-- source_records → experiences is closed here). The key is (view, place), so a record shows only a view of
-- its own records, and DEFERRABLE INITIALLY DEFERRED, so the trigger below (with its slice) re-points the shown
-- view before commit when its source record is deleted or moved (the RI check runs at commit, after it). A merge
-- that moves the record moves the view's experience_id with it, and the folded place's shown view is re-pointed
-- in the same transaction (experiences_boundary_view_once no longer refuses the survivor's own outline).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_boundary_view_fk') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_boundary_view_fk FOREIGN KEY (boundary_view_id, id)
            REFERENCES record_geometries (id, experience_id) DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_path_view_fk') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_path_view_fk FOREIGN KEY (path_view_id, id)
            REFERENCES record_geometries (id, experience_id) DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;
-- With its slice of #2458: a trigger AFTER INSERT/UPDATE/DELETE that re-copies the view a record shows,
-- and picks the next outline/line view when none is chosen.

CREATE TABLE IF NOT EXISTS experience_websites (
    experience_id integer NOT NULL CONSTRAINT experience_websites_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
        -- the record whose site it is: the Mauritshuis
    url           varchar(1000) NOT NULL,
        -- the parsed, normalised URL the item's P856 gives: 'https://www.mauritshuis.nl/' and '…/en/'
    language      varchar(16),
        -- P407 on the statement, BCP 47: 'nl', 'en'; NULL when the statement names none
    ordinal       smallint NOT NULL DEFAULT 0,
        -- the source's order; a reader takes the first in their language, else the first
    CONSTRAINT experience_websites_pkey PRIMARY KEY (experience_id, url),
    CONSTRAINT experience_websites_are_http CHECK (url ~ '^https?://[^ ]+$'),
    CONSTRAINT experience_websites_not_whc CHECK (url !~* '^https?://([a-z0-9-]+\.)*whc\.unesco\.org')
        -- never the Centre's page as "official"; that is unesco_url
);

CREATE TABLE IF NOT EXISTS experience_makers (
    experience_id integer NOT NULL CONSTRAINT experience_makers_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    ordinal       smallint NOT NULL CONSTRAINT experience_makers_ordinal_check CHECK (ordinal >= 0),
        -- the source's order: Nelson's Pillar 0 = its architect, 1 = its sculptor
    maker_item    varchar(16) CONSTRAINT experience_makers_maker_item_check CHECK (maker_item ~ '^Q[1-9][0-9]*$'),
        -- the maker's Wikidata item; NULL for a maker known only by name
    maker_label   varchar(250) NOT NULL,
        -- 'William Wilkins' (architect of Nelson's Pillar); 'Thomas Kirk' (its statue)
    role          varchar(9) NOT NULL CONSTRAINT experience_makers_role_check CHECK (role IN ('creator', 'architect')),
        -- MAKER_ROLES in @tyr/shared/makers: P170 → creator, P84 → architect
    CONSTRAINT experience_makers_pkey PRIMARY KEY (experience_id, ordinal),
    CONSTRAINT experience_makers_label_stored CHECK (maker_label = btrim(maker_label) AND maker_label <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS experience_makers_once ON experience_makers (experience_id, maker_item, role) WHERE maker_item IS NOT NULL;

CREATE TABLE IF NOT EXISTS experience_subject_lines (
    experience_id integer NOT NULL CONSTRAINT experience_subject_lines_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    line          varchar(12) NOT NULL CONSTRAINT experience_subject_lines_line_check CHECK (line IN ('commemorates', 'depicts')),
        -- Lincoln Memorial 'commemorates'; Christ the Redeemer 'depicts'
    via           varchar(24) NOT NULL CONSTRAINT experience_subject_lines_via_check CHECK (via IN (
                    'commemorates', 'memorials-category', 'main-subject', 'named-after', 'statues-category',
                    'depicts', 'lead', 'war-narrowed-by-event', 'war-narrowed-by-lead', 'war-narrowed-to-person',
                    'curator')),
        -- the step that answered (COMMEMORATION_STEPS / DEPICTION_STEPS): Statue of Unity 'memorials-category';
        -- Shaheed Minar, Dhaka 'lead'; a curator's list 'curator'
    read_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experience_subject_lines_pkey PRIMARY KEY (experience_id, line)
);
-- No row: the line was never read. A row with no subjects: read, and nobody named; with via
-- 'curator' and the claim subjects.<line>, a curator's "nobody" that survives every run.

CREATE TABLE IF NOT EXISTS experience_subjects (
    experience_id integer NOT NULL,
    line          varchar(12) NOT NULL,
    ordinal       smallint NOT NULL CONSTRAINT experience_subjects_ordinal_check CHECK (ordinal >= 0),
    item          varchar(16) CONSTRAINT experience_subjects_item_check CHECK (item ~ '^Q[1-9][0-9]*$'),
        -- the subject's item: Abraham Lincoln's on the Lincoln Memorial; NULL for a group named in words
    words         varchar(250),
        -- a group with no item, kept apart from its context: Soviet War Memorial, Schönholzer Heide:
        -- 'the Red Army soldiers who fell in the Battle of Berlin'
    label         varchar(250) NOT NULL,
        -- the shown name, tidied, within Wikidata's 250-character limit: 'Abraham Lincoln'
    article_url   varchar(1000) CONSTRAINT experience_subjects_article_url_check CHECK (article_url IS NULL OR article_url ~ '^https://en\.wikipedia\.org/wiki/.+'),
        -- the subject's English article, or the defining event's for a group in words
    role          varchar(60),
        -- the form a figure is shown in (P3831): Neptune Fountain, Berlin 'as women' (its four rivers)
    life_event    varchar(8) CONSTRAINT experience_subjects_life_event_check CHECK (life_event IN ('born', 'lived', 'studied', 'worked', 'created', 'died')),
        -- what happened here, on a life-place marker: 'Albert Einstein lived here' → 'lived'
    -- Provenance and the curator's answer (a dedication is a subject: there is no experience_dedications table):
    source_id     integer NOT NULL CONSTRAINT experience_subjects_source_id_fkey REFERENCES experience_sources(id),
        -- the source whose run read it (Monuments & memorials, 6), or 11 for a curator's line
    read_from     varchar(14) NOT NULL CONSTRAINT experience_subjects_read_from_check CHECK (read_from IN ('statement', 'osm-tag', 'lead-reading', 'curator')),
    statement     varchar(80) CONSTRAINT experience_subjects_statement_check CHECK (statement IS NULL OR source_id_fits_scheme('wikidata-statement', statement)),
        -- the P547 / P180 statement read, where read_from = 'statement'
    decided_at    timestamptz,
    decided_by    integer CONSTRAINT experience_subjects_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    refused_at    timestamptz,
    refused_by    integer CONSTRAINT experience_subjects_refused_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experience_subjects_pkey PRIMARY KEY (experience_id, line, ordinal),
    CONSTRAINT experience_subjects_experience_id_line_fkey FOREIGN KEY (experience_id, line) REFERENCES experience_subject_lines (experience_id, line) ON DELETE CASCADE,
    CONSTRAINT experience_subjects_named CHECK (item IS NOT NULL OR words IS NOT NULL),
    CONSTRAINT experience_subjects_role_on_depicts CHECK (role IS NULL OR line = 'depicts'),
    CONSTRAINT experience_subjects_life_event_on_commemorates CHECK (life_event IS NULL OR line = 'commemorates'),
    CONSTRAINT experience_subjects_statement_read CHECK ((read_from = 'statement') = (statement IS NOT NULL)),
    CONSTRAINT experience_subjects_one_answer CHECK (num_nonnulls(decided_at, refused_at) <= 1),
    CONSTRAINT experience_subjects_verdict_pairs CHECK (
        (decided_by IS NULL OR decided_at IS NOT NULL) AND (refused_by IS NULL OR refused_at IS NOT NULL)),
    CONSTRAINT experience_subjects_cap CHECK (ordinal < 50)        -- MAX_COMMEMORATED_SUBJECTS, held to @tyr/shared by a type test
);
CREATE UNIQUE INDEX IF NOT EXISTS experience_subjects_one_line ON experience_subjects (experience_id, item) WHERE item IS NOT NULL;
    -- a subject stands on one line only (Big Vishnu's Garuda moves from Depicts to Commemorates)

CREATE TABLE IF NOT EXISTS record_listings (
    record_id       INTEGER NOT NULL CONSTRAINT record_listings_record_id_fkey REFERENCES source_records(id) ON DELETE CASCADE,
        -- the membership (or part record) on a list kept outside the catalogue: Liverpool's World
        -- Heritage record; the Western Tien-Shan part record of Maidantal.
    ordinal         SMALLINT NOT NULL CONSTRAINT record_listings_ordinal_check CHECK (ordinal > 0),
        -- time order of the record's listings; a second listing after a gap would be 2 (no World
        -- Heritage site has one yet).
    -- the period block, the same seventeen columns and comments as place_periods:
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT,
    from_span VARCHAR(10) CONSTRAINT record_listings_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CONSTRAINT record_listings_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CONSTRAINT record_listings_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT,
    until_span VARCHAR(10) CONSTRAINT record_listings_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CONSTRAINT record_listings_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CONSTRAINT record_listings_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    from_first INTEGER, until_last INTEGER,
        -- from_*: the list's own start: Liverpool inscribed 2004 (UNESCO's dataset, every offered
        -- World Heritage record); from_property NULL for a dataset date, P580 for a designation.
        -- until_*: 21 July 2021 (offered from P582 of the P1435 statement, confirmed by a curator).
    ending          VARCHAR(10) CONSTRAINT record_listings_ending_check CHECK (ending IN ('delisted', 'dropped')),
        -- 'delisted': the list struck the whole site off (Dresden Elbe Valley 2009); 'dropped': a
        -- serial site's list stopped giving a component (Maidantal, October 2026, once answered).
    source_id       INTEGER NOT NULL CONSTRAINT record_listings_source_id_fkey REFERENCES experience_sources(id),
        -- UNESCO (1) for the run's row, World Heritage components (10) for a part record's,
        -- Curators (11) for a former written on a record that had no period.
    decided_by      INTEGER CONSTRAINT record_listings_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
        -- the curator who closed (former) or reopened the listing, and when.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT record_listings_pkey PRIMARY KEY (record_id, ordinal),
    CONSTRAINT record_listings_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT record_listings_ending_of_end CHECK (ending IS NULL OR ended),
    CONSTRAINT record_listings_curator_decides CHECK (source_id <> 11 OR decided_at IS NOT NULL),
    CONSTRAINT record_listings_decided_pair CHECK (decided_by IS NULL OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_record_listings_open ON record_listings (record_id) WHERE NOT ended;

-- With its slice of #2458: a trigger per event deriving source_records.source_membership from
--   these rows ('present' where the record has no listing row or an open one, 'former'
--   otherwise; only what differs), from which derive_place_listing() follows; and one refusing a
--   source_membership other than the listing rows say (the stands_today_is_derived pattern).

CREATE TABLE IF NOT EXISTS place_seasons (
    id                 SERIAL CONSTRAINT place_seasons_pkey PRIMARY KEY,
    experience_id      INTEGER NOT NULL CONSTRAINT place_seasons_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
        -- the record the season is of: Sceilg Mhichíl; the Gion Matsuri (shape none).
    at_experience_id   INTEGER CONSTRAINT place_seasons_at_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
        -- The season holds only where the record is met at this record: puffins (a
        -- species) at Látrabjarg, 15 Jun -> 15 Aug. NULL: wherever the record is.
    says               VARCHAR(4) NOT NULL CONSTRAINT place_seasons_says_check CHECK (says IN ('open', 'held')),
        -- open: the place can be visited in the window (Sceilg Mhichíl, boats May -> Sep);
        -- held: the event takes place (the Gion Matsuri, 1 -> 31 July).
    rule_kind          VARCHAR(16) NOT NULL CONSTRAINT place_seasons_rule_kind_check CHECK (rule_kind IN ('window', 'easter_offset', 'weekday_of_month', 'lunar_date', 'words')),
        -- how the dates of a year are found: a fixed window; days from Easter (Holy Week in
        -- Seville, Maslenitsa); a weekday of a month (La Tomatina, last Wednesday of August); a day
        -- of a lunar calendar (Chinese New Year); or words alone (a date a committee announces).
    from_month         SMALLINT CONSTRAINT place_seasons_from_month_check CHECK (from_month BETWEEN 1 AND 12),   -- window: 5 (Sceilg Mhichíl)
    from_day           SMALLINT CONSTRAINT place_seasons_from_day_check CHECK (from_day BETWEEN 1 AND 31),      -- window: 15; NULL = the month as a whole
    until_month        SMALLINT CONSTRAINT place_seasons_until_month_check CHECK (until_month BETWEEN 1 AND 12),  -- window: 9; may precede from_month (wraps the new year)
    until_day          SMALLINT CONSTRAINT place_seasons_until_day_check CHECK (until_day BETWEEN 1 AND 31),     -- window: 30
    shifts             BOOLEAN NOT NULL DEFAULT false,
        -- the window moves with the weather and reads "usually" (a mountain pass, June -> October).
    easter_calendar    VARCHAR(9) CONSTRAINT place_seasons_easter_calendar_check CHECK (easter_calendar IN ('western', 'orthodox')),
        -- easter_offset: Holy Week in Seville 'western'; Maslenitsa 'orthodox'.
    easter_offset_days SMALLINT CONSTRAINT place_seasons_easter_offset_days_check CHECK (easter_offset_days BETWEEN -100 AND 100),
        -- Palm Sunday -7 (Holy Week); Maslenitsa -55 (Orthodox Easter 2026 fell on 12 April and Maslenitsa ran
        -- 16 → 22 February, Easter − 55 to − 49, Forgiveness Sunday the last day).
    rule_month         SMALLINT CONSTRAINT place_seasons_rule_month_check CHECK (rule_month BETWEEN 1 AND 12),    -- weekday_of_month: 8 (La Tomatina)
    rule_weekday       SMALLINT CONSTRAINT place_seasons_rule_weekday_check CHECK (rule_weekday BETWEEN 1 AND 7),   -- ISO, 3 = Wednesday
    rule_week          SMALLINT CONSTRAINT place_seasons_rule_week_check CHECK (rule_week IN (-1, 1, 2, 3, 4, 5)), -- -1 = the last
    lunar_calendar     VARCHAR(8) CONSTRAINT place_seasons_lunar_calendar_check CHECK (lunar_calendar IN ('chinese', 'hebrew', 'islamic', 'hindu')),
    lunar_month        SMALLINT CONSTRAINT place_seasons_lunar_month_check CHECK (lunar_month BETWEEN 1 AND 13),   -- Chinese New Year: 1
    lunar_day          SMALLINT CONSTRAINT place_seasons_lunar_day_check CHECK (lunar_day BETWEEN 1 AND 30),     -- 1
    duration_days      SMALLINT CONSTRAINT place_seasons_duration_days_check CHECK (duration_days BETWEEN 1 AND 366),
        -- days from the computed first day: Holy Week 8 (Palm Sunday -> Easter Sunday); Maslenitsa 7.
        -- Until #2633 the writer writes 'window' and 'words' rows only: Holy Week in Seville is one 'words' row,
        -- "March or April", and no window (ADR-0224 d8; a window from 1 March to 30 April would tell a "held on your
        -- dates" read a false span: Palm Sunday is never before 15 March, Easter never after 25 April). What #2633
        -- needs beyond these columns — a cycle of several years (Documenta every 5, Oberammergau every 10), an
        -- offset on a weekday or lunar rule (Notting Hill's Sunday before the last Monday of August), a lunar month
        -- that runs to its own end (Ramadan, 29 or 30 days), and proposals of a computable rule — is #2633's own
        -- later, additive migration.
    rule_words         TEXT CONSTRAINT place_seasons_rule_words_check CHECK (rule_words IS NULL OR btrim(rule_words) <> ''),
        -- the rule as a card reads it where no computable rule is held: "March or April". For a
        -- computable rule the words are generated (@tyr/shared/recurrence) and this is NULL.
    source_id          INTEGER NOT NULL CONSTRAINT place_seasons_source_id_fkey REFERENCES experience_sources(id),
        -- the source whose pass proposed it, or Curators (11) for a curator's completion.
    rule_statement     TEXT CONSTRAINT place_seasons_rule_statement_check CHECK (source_id_fits_scheme('wikidata-statement', rule_statement)),
        -- La Tomatina's P837 statement, where Wikidata proposed it.
    decided_by         INTEGER CONSTRAINT place_seasons_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at         TIMESTAMPTZ NOT NULL,
        -- a season is never written without a curator (ADR-0217 d9), so every row is answered.
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_seasons_window CHECK (rule_kind <> 'window' OR (from_month IS NOT NULL AND until_month IS NOT NULL
        AND (from_day IS NULL) = (until_day IS NULL))),
    CONSTRAINT place_seasons_window_only CHECK (rule_kind = 'window' OR (from_month IS NULL AND from_day IS NULL AND until_month IS NULL AND until_day IS NULL AND NOT shifts)),
    CONSTRAINT place_seasons_easter CHECK ((rule_kind = 'easter_offset') = (easter_calendar IS NOT NULL AND easter_offset_days IS NOT NULL)),
    CONSTRAINT place_seasons_weekday CHECK ((rule_kind = 'weekday_of_month') = (rule_month IS NOT NULL AND rule_weekday IS NOT NULL AND rule_week IS NOT NULL)),
    CONSTRAINT place_seasons_lunar CHECK ((rule_kind = 'lunar_date') = (lunar_calendar IS NOT NULL AND lunar_month IS NOT NULL AND lunar_day IS NOT NULL)),
    CONSTRAINT place_seasons_computed_lasts CHECK ((rule_kind IN ('easter_offset', 'weekday_of_month', 'lunar_date')) = (duration_days IS NOT NULL)),
    CONSTRAINT place_seasons_words CHECK ((rule_kind = 'words') = (rule_words IS NOT NULL)),
    CONSTRAINT place_seasons_not_itself CHECK (at_experience_id IS DISTINCT FROM experience_id)
);
CREATE INDEX IF NOT EXISTS idx_place_seasons_of ON place_seasons (experience_id);
CREATE INDEX IF NOT EXISTS idx_place_seasons_at ON place_seasons (at_experience_id) WHERE at_experience_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS place_past_positions (
    id               SERIAL CONSTRAINT place_past_positions_pkey PRIMARY KEY,
    experience_id    INTEGER NOT NULL CONSTRAINT place_past_positions_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
        -- the record that moved: the Arch of Neutrality in Ashgabat.
    location         geometry(Point, 4326) NOT NULL,
        -- where it stood then: 37.9369, 58.3800 (the city centre). Today's point stays experiences.location.
    -- the period block, the same seventeen columns and comments as place_periods:
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT,
    from_span VARCHAR(10) CONSTRAINT place_past_positions_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CONSTRAINT place_past_positions_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CONSTRAINT place_past_positions_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT,
    until_span VARCHAR(10) CONSTRAINT place_past_positions_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CONSTRAINT place_past_positions_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CONSTRAINT place_past_positions_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    from_first INTEGER, until_last INTEGER,
        -- 1998 -> 2010, ended. A record that moved keeps one stood period (ADR-0217 d11).
    location_statement TEXT CONSTRAINT place_past_positions_location_statement_check CHECK (source_id_fits_scheme('wikidata-statement', location_statement)),
        -- the P625 statement with an end time it was proposed from.
    source_id        INTEGER NOT NULL CONSTRAINT place_past_positions_source_id_fkey REFERENCES experience_sources(id),
    decided_by       INTEGER CONSTRAINT place_past_positions_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at       TIMESTAMPTZ NOT NULL,
        -- a past position is a proposal a curator answers (ADR-0217 d11, d13).
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_past_positions_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT place_past_positions_ended CHECK (ended)
);
CREATE INDEX IF NOT EXISTS idx_place_past_positions_of ON place_past_positions (experience_id);
-- ADR-0217 decision 11: the catalogue as of a date is read with its past positions — lists, kinds and counts —
-- so a past position is placed in regions and searched by place like today's pin. London Bridge (in London until
-- 1968, at Lake Havasu City since 1971) counts in London as of 1965; the Arch of Neutrality is drawn at the city
-- centre for a date before 2010. The as-of reader takes the position whose period meets the date, else the pin.
CREATE INDEX IF NOT EXISTS idx_place_past_positions_location ON place_past_positions USING GIST (location);

-- Derived: the open leaf regions each past position lies in, written only by
-- refresh_place_shape_regions() (with its slice of #2458), with the record's shape regions, from the same placement rule applied to
-- the past point. Read by the as-of lists and counts.
CREATE TABLE IF NOT EXISTS place_past_position_regions (
    position_id integer NOT NULL CONSTRAINT place_past_position_regions_position_id_fkey REFERENCES place_past_positions(id) ON DELETE CASCADE,
    region_id   integer NOT NULL CONSTRAINT place_past_position_regions_region_id_fkey REFERENCES regions(id) ON DELETE CASCADE,
    CONSTRAINT place_past_position_regions_pkey PRIMARY KEY (position_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_place_past_position_regions_region ON place_past_position_regions (region_id);

CREATE TABLE IF NOT EXISTS experience_time_proposals (
    id               SERIAL CONSTRAINT experience_time_proposals_pkey PRIMARY KEY,
    experience_id    INTEGER NOT NULL CONSTRAINT experience_time_proposals_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    record_id        INTEGER CONSTRAINT experience_time_proposals_record_id_fkey REFERENCES source_records(id) ON DELETE CASCADE,
        -- the membership a proposal is about, where it is one: Liverpool's World Heritage record
        -- (listing_end); the Art Museums record of a museum a closure pauses alone.
    what             VARCHAR(14) NOT NULL CONSTRAINT experience_time_proposals_what_check CHECK (what IN ('closure', 'season', 'listing_end', 'past_position')),
    pass             VARCHAR(26) NOT NULL CONSTRAINT experience_time_proposals_pass_check CHECK (pass IN ('osm-opening-hours', 'wikidata-open-period',
                         'wikidata-yearly-rule', 'wikivoyage-season', 'wikidata-designation-end', 'wikidata-dated-coordinate')),
        -- what read it: the Pergamon Museum's 'off' on its OSM object; Sceilg Mhichíl's Wikivoyage
        -- page; Liverpool's P1435 end time; the Arch of Neutrality's dated P625.
    source_id        INTEGER CONSTRAINT experience_time_proposals_source_id_fkey REFERENCES experience_sources(id),
        -- the run whose pass it was, where the pass belongs to a source (UNESCO for a designation end).
    -- the period block, the same seventeen columns and comments as place_periods:
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT,
    from_span VARCHAR(10) CONSTRAINT experience_time_proposals_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CONSTRAINT experience_time_proposals_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CONSTRAINT experience_time_proposals_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT,
    until_span VARCHAR(10) CONSTRAINT experience_time_proposals_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CONSTRAINT experience_time_proposals_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CONSTRAINT experience_time_proposals_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    from_first INTEGER, until_last INTEGER,
        -- closure, listing_end, past_position: the proposed period. The Pergamon Museum: from and
        -- until unknown, open ("closed now"); Turku Cathedral: 9 Feb 2026 -> 2 Dec 2028; Liverpool:
        -- until 21 July 2021.
    season_says      VARCHAR(4) CONSTRAINT experience_time_proposals_season_says_check CHECK (season_says IN ('open', 'held')),
    season_from_month SMALLINT CONSTRAINT experience_time_proposals_season_from_month_check CHECK (season_from_month BETWEEN 1 AND 12),
    season_from_day  SMALLINT CONSTRAINT experience_time_proposals_season_from_day_check CHECK (season_from_day BETWEEN 1 AND 31),
    season_until_month SMALLINT CONSTRAINT experience_time_proposals_season_until_month_check CHECK (season_until_month BETWEEN 1 AND 12),
    season_until_day SMALLINT CONSTRAINT experience_time_proposals_season_until_day_check CHECK (season_until_day BETWEEN 1 AND 31),
        -- season: the window read ("Boats sail May-Sep": open, 5 -> 9; Verla "Oct-Apr: off" read as open 5 -> 9).
    location         geometry(Point, 4326),
        -- past_position: the point the item dates.
    statement        TEXT CONSTRAINT experience_time_proposals_statement_check CHECK (source_id_fits_scheme('wikidata-statement', statement)),
    osm_ref          TEXT CONSTRAINT experience_time_proposals_osm_ref_check CHECK (source_id_fits_scheme('osm-object', osm_ref)),
    osm_tag          VARCHAR(255),
        -- ADR-0059 provenance: 'way/123' (the one OSM spelling) and the opening_hours value as read
        -- ("2026 Feb 09 - 2028 Dec 02 off").
    page_title       TEXT,
    page_revision    INTEGER CONSTRAINT experience_time_proposals_page_revision_check CHECK (page_revision > 0),
    quote_start      INTEGER CONSTRAINT experience_time_proposals_quote_start_check CHECK (quote_start >= 0),
    quote_end        INTEGER,
        -- Wikivoyage: the page, the revision read and the sentence's offsets in it; the card shows
        -- the sentence from that revision, and none of the CC BY-SA text is kept (ADR-0217 d13).
    fingerprint      TEXT NOT NULL,
        -- what the proposal was read from, as one string: the statement id, 'way/123:off',
        -- 'wv:Skellig_Michael@123456:812-850'. A refused fingerprint is never proposed again.
    read_at          TIMESTAMPTZ NOT NULL,
    decided_by       INTEGER CONSTRAINT experience_time_proposals_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at       TIMESTAMPTZ,
    refused_by       INTEGER CONSTRAINT experience_time_proposals_refused_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    refused_at       TIMESTAMPTZ,
        -- the answer: decided (its completed row was written to place_periods, place_seasons,
        -- record_listings or place_past_positions) or refused (nothing written; Wikidata's stale
        -- 'temporarily closed' on the Ipiranga Museum would be refused, were it read).
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT experience_time_proposals_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT etp_one_answer CHECK (decided_at IS NULL OR refused_at IS NULL),
    CONSTRAINT etp_season_shape CHECK ((what = 'season') = (season_says IS NOT NULL AND season_from_month IS NOT NULL AND season_until_month IS NOT NULL)),
    CONSTRAINT etp_position_shape CHECK ((what = 'past_position') = (location IS NOT NULL)),
    CONSTRAINT etp_listing_on_record CHECK (what <> 'listing_end' OR record_id IS NOT NULL),
    CONSTRAINT etp_osm_pass CHECK ((pass = 'osm-opening-hours') = (osm_ref IS NOT NULL)),
    CONSTRAINT etp_wikivoyage_pass CHECK ((pass = 'wikivoyage-season') = (page_title IS NOT NULL AND page_revision IS NOT NULL AND quote_end > quote_start)),
    CONSTRAINT etp_period_unused_by_season CHECK (what <> 'season' OR (from_year IS NULL AND until_year IS NULL AND NOT ended))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etp_fingerprint ON experience_time_proposals (experience_id, what, fingerprint);
CREATE INDEX IF NOT EXISTS idx_etp_open ON experience_time_proposals (experience_id) WHERE decided_at IS NULL AND refused_at IS NULL;

-- What UNESCO's dataset says of an inscription: one row per World Heritage membership.
CREATE TABLE IF NOT EXISTS record_heritage_inscriptions (
    record_id          integer CONSTRAINT record_heritage_inscriptions_pkey PRIMARY KEY CONSTRAINT record_heritage_inscriptions_record_id_fkey REFERENCES source_records(id) ON DELETE CASCADE,
    -- The criteria the site is inscribed under: the Struve Geodetic Arc {'(ii)','(iii)','(vi)'}.
    -- NULL where the dataset no longer carries the property (the Dresden Elbe Valley, the
    -- Arabian Oryx Sanctuary and Liverpool were delisted and whc001 dropped them).
    criteria           varchar(6)[]
                       CONSTRAINT record_heritage_inscriptions_criteria_check CHECK (criteria IS NULL OR (cardinality(criteria) > 0 AND criteria <@ ARRAY['(i)','(ii)','(iii)','(iv)',
                              '(v)','(vi)','(vii)','(viii)','(ix)','(x)']::varchar[])),
    -- The inscribed property's area and its buffer zone, in hectares, as the dataset gives
    -- them; read by the near-pairs threshold (ADR-0046) and the check that names an outline
    -- more than three times the inscribed area. NULL where the dataset gives none.
    area_ha            numeric(14,2) CONSTRAINT record_heritage_inscriptions_area_ha_check CHECK (area_ha > 0),
    buffer_zone_ha     numeric(14,2) CONSTRAINT record_heritage_inscriptions_buffer_zone_ha_check CHECK (buffer_zone_ha >= 0),
    -- The property crosses a border: the Struve Arc (ten countries) true; Cologne Cathedral false.
    transboundary      boolean NOT NULL,
    -- UNESCO's region of the property (@tyr/shared/unescoRegions); NULL on a delisted site the dataset no longer
    -- carries.
    unesco_region      varchar(40)
                       CONSTRAINT record_heritage_inscriptions_unesco_region_check CHECK (unesco_region IN ('Africa','Arab States','Asia and the Pacific',
                                                'Europe and North America','Latin America and the Caribbean')),
    -- How many components the dataset lists for the property: 34 for the Struve
    -- Arc, so a property held as fewer parts than its source counts is a stored fact.
    components_listed  integer CONSTRAINT record_heritage_inscriptions_components_listed_check CHECK (components_listed > 0)
);
-- Writer (ADR-0069): the UNESCO run (services/sync/unescoSyncService.ts through kindFacts.ts), and a curator's claimed correction
-- ('inscription.criteria', 'inscription.area') through controllers/experience/membershipWriter.ts under the place's
-- LockedExperience.
-- trg_inscription_on_heritage_record: BEFORE INSERT/UPDATE, refuses a row whose record is
-- not a membership of a kind whose list is kept outside the catalogue and filled by source 1.
-- With its slice of #2458: a trigger AFTER UPDATE OF area_ha marking the place due for pairing
-- (mark_pairing_due(), in place of today's facts->'areaHectares' condition).

-- When the property stood on the List of World Heritage in Danger: a period per stay, with
-- its dates. Cologne Cathedral 2004 -> 2006; Liverpool 2012 -> 21 July 2021 (its delisting);
-- the Dresden Elbe Valley 2006 -> 2009; the Bamiyan Valley 2003 -> open.
CREATE TABLE IF NOT EXISTS record_danger_periods (
    record_id   integer NOT NULL CONSTRAINT record_danger_periods_record_id_fkey REFERENCES source_records(id) ON DELETE CASCADE,
    ordinal     smallint NOT NULL CONSTRAINT record_danger_periods_ordinal_check CHECK (ordinal > 0),
    -- the period block, the same seventeen columns and comments as place_periods:
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT,
    from_span VARCHAR(10) CONSTRAINT record_danger_periods_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CONSTRAINT record_danger_periods_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CONSTRAINT record_danger_periods_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT,
    until_span VARCHAR(10) CONSTRAINT record_danger_periods_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CONSTRAINT record_danger_periods_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CONSTRAINT record_danger_periods_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    from_first INTEGER, until_last INTEGER,
        -- Cologne Cathedral: 2004 -> 2006, ended; Aleppo: 2013 -> open.
    -- Who said it: UNESCO (1) for the dataset's danger list, Curators (11) for a curator's claimed correction.
    source_id   integer NOT NULL CONSTRAINT record_danger_periods_source_id_fkey REFERENCES experience_sources(id),
    decided_by  integer CONSTRAINT record_danger_periods_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    decided_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT record_danger_periods_pkey PRIMARY KEY (record_id, ordinal),
    CONSTRAINT record_danger_periods_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT record_danger_periods_curator_decides CHECK (source_id <> 11 OR decided_at IS NOT NULL),
    CONSTRAINT record_danger_periods_decided_pair CHECK (decided_by IS NULL OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_record_danger_periods_open ON record_danger_periods (record_id) WHERE NOT ended;
-- Writer: the UNESCO run (services/sync/dangerListing.ts), and a curator's claimed 'danger' through membershipWriter.ts.
-- 266 carries today's current stay, with its from_year, and closes it once the facts no longer read it.

-- What a Wikidata kind's rule read to admit the membership: its bookkeeping, shown on the
-- card and never a reader's filter. Writer: the Wikidata runs' kind-facts step
-- (services/sync/kindFacts.ts) in the run's transaction; no curator writes it.
CREATE TABLE IF NOT EXISTS record_rule_reads (
    record_id               integer CONSTRAINT record_rule_reads_pkey PRIMARY KEY CONSTRAINT record_rule_reads_record_id_fkey REFERENCES source_records(id) ON DELETE CASCADE,
    -- The classes (P31 through the subset's closure) the rule matched: Cologne Cathedral in
    -- Places of worship, the item of 'cathedral'.
    wikidata_classes        text[] NOT NULL DEFAULT '{}',
    -- English Wikipedia categories a rule read as a second vote (ADR-0060 d3).
    wikipedia_categories    text[] NOT NULL DEFAULT '{}',
    -- Archaeology's reading of what the item is ('site' / 'museum' / 'find spot').
    archaeology_nature      varchar(20),
    -- Art Museums' works count and their summed sitelinks at the venue (ADR-0023).
    artwork_count           integer CONSTRAINT record_rule_reads_artwork_count_check CHECK (artwork_count >= 0),
    total_artwork_sitelinks integer CONSTRAINT record_rule_reads_total_artwork_sitelinks_check CHECK (total_artwork_sitelinks >= 0),
    -- Public art's and Monuments & memorials' answer that the item is an artwork, which the
    -- buildings' veto and the catalogue check read (the Rock Garden of Chandigarh
    -- answered yes). NULL where the kind asks no such question.
    answered_artwork        boolean,
    read_at                 timestamptz NOT NULL DEFAULT now()
);
-- Each class id is checked by trg_rule_reads_items (every element ~ '^Q[1-9][0-9]*$');
-- a CHECK cannot iterate an array without a function, so the function is the CHECK.

-- experience_dedications is not created: a dedication is a row of experience_subjects.

-- #2125: derived from geometry, unlike "part of". A visit to the
-- inner record reads the outer as visited, and the outer is not counted in "k of N".
-- Writer: refresh_lies_within() alone, with its slice of #2458.
CREATE TABLE IF NOT EXISTS experience_lies_within (
    -- The place inside: the Alexander Column; the Altes Museum; Old Faithful.
    inner_id integer NOT NULL CONSTRAINT experience_lies_within_inner_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- The area it stands in, by an outline of its own (shape area, its coordinate emptied by the shape writer):
    -- Palace Square; Museum Island; Yellowstone once its outline is held.
    outer_id integer NOT NULL CONSTRAINT experience_lies_within_outer_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- point: the inner's pin lies in the outer's outline; outline: the inner's own outline lies in it
    -- (at least 99.5 % of its area). A part or a whole is never inner by its point
    -- alone: Neues Museum, a part of Museum Island, is a part, not a lies-within row.
    basis    varchar(8) NOT NULL CONSTRAINT experience_lies_within_basis_check CHECK (basis IN ('point', 'outline')),
    CONSTRAINT experience_lies_within_pkey PRIMARY KEY (inner_id, outer_id),
    CONSTRAINT experience_lies_within_inner_id_outer_id_check CHECK (inner_id <> outer_id)
);
CREATE INDEX IF NOT EXISTS idx_experience_lies_within_outer ON experience_lies_within (outer_id);

-- Every relation between two records that is not "part of" (experience_parts), not "same" (a merge)
-- and not "lies within" (derived). Written by one writer module alone (ADR-0069, #2126): the proposing passes and
-- the curator's answers, the latter under both records' LockedExperience (whole before part, then id).
CREATE TABLE IF NOT EXISTS experience_relations (
    id                 SERIAL CONSTRAINT experience_relations_pkey PRIMARY KEY,
    -- The record the relation is said of: the khachkar (a class object); the Gion Matsuri (an event);
    -- Lascaux IV (a replica); Nelson's Pillar (gone, 1809 to 8 March 1966).
    from_id            integer NOT NULL CONSTRAINT experience_relations_from_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- The other end: Etchmiadzin Cathedral (47 khachkars); Yasaka Shrine; the Lascaux cave;
    -- the Spire of Dublin.
    to_id              integer CONSTRAINT experience_relations_to_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- The region an event is held across, where no one record holds it: Holy Week in Seville (its
    -- processions cross the city; held_at Seville Cathedral would be false), the Notting Hill Carnival. 'held_at'
    -- only, and an open region of the canon (the writer checks the view). Exactly one of
    -- to_id and to_region_id. NO ACTION: regionWriter moves it with the region's placements.
    to_region_id       integer CONSTRAINT experience_relations_to_region_id_fkey REFERENCES regions(id),
    -- met_at: a type, dish or activity is met at a place (ADR-0218 d9); held_at: an event takes place
    -- there (ADR-0224 d2); replica_of: a copy one visits instead (#2134); replaced_by: what
    -- stands in a gone record's stead (Old St. Peter's Basilica by St. Peter's Basilica).
    relation           varchar(12) NOT NULL
                       CONSTRAINT experience_relations_relation_check CHECK (relation IN ('met_at', 'held_at', 'replica_of', 'replaced_by', 'runs_along')),
    -- met_at only. can_be_seen ticks nothing (a museum with one khachkar in a room); one_of_them makes a
    -- visit to the place a visit to the type (Noratus cemetery, the field of khachkars). A proposed pair
    -- starts as can_be_seen; one_of_them is only a curator's answer (ADR-0218 d9, ADR-0224 d1).
    strength           varchar(12) CONSTRAINT experience_relations_strength_check CHECK (strength IN ('one_of_them', 'can_be_seen')),
    -- proposed: waits for a curator (every replica_of and replaced_by; a held_at from a gated source on
    -- a record readers see); standing: a reader sees it (passed unasked, or answered yes); refused: a
    -- curator's no, remembered so the pair is not proposed again (ADR-0053 pattern).
    state              varchar(10) NOT NULL DEFAULT 'proposed'
                       CONSTRAINT experience_relations_state_check CHECK (state IN ('proposed', 'standing', 'refused')),
    -- Who proposed it: the source whose pass read it (a Wikidata statements pass: the Gion Matsuri's P276
    -- Yasaka Shrine; Nelson's Pillar's P167), or the class object's own source for its instances' places. Never
    -- 11: a curator answers a source's proposal and does not enter a relation from
    -- nothing — no card edit adds one today, so none is a kept curator edit.
    source_id          integer NOT NULL CONSTRAINT experience_relations_source_id_fkey REFERENCES experience_sources(id),
    -- The statement read, where a statement proposed it: P276 (location), P167 (structure replaced by),
    -- P1398 (structure replaces), P144 (based on), P31 (instance of) for an instance's place. Shown on
    -- the card as provenance; NULL for a curator's own and for a proposal from names and nearness.
    statement_property varchar(10) CONSTRAINT experience_relations_statement_property_check CHECK (statement_property ~ '^P[1-9][0-9]*$'),
    statement_id       varchar(80),
    -- The run that proposed it.
    sync_log_id        integer CONSTRAINT experience_relations_sync_log_id_fkey REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    proposed_at        timestamptz NOT NULL DEFAULT now(),
    -- A curator's yes, or a strength raised; NULL where it passed the gate unasked.
    decided_at         timestamptz,
    decided_by         integer CONSTRAINT experience_relations_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    refused_at         timestamptz,
    refused_by         integer CONSTRAINT experience_relations_refused_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- 'runs_along': a trail section that follows a canal or a road for a stretch,
    -- in metres along the from record's line: the Canal du Midi path along the canal from 0 to 240,000.
    from_m             integer CONSTRAINT experience_relations_from_m_check CHECK (from_m >= 0),
    to_m               integer,
    CONSTRAINT experience_relations_metres CHECK ((relation = 'runs_along') = (from_m IS NOT NULL) AND (from_m IS NULL) = (to_m IS NULL)
           AND (from_m IS NULL OR from_m < to_m)),
    CONSTRAINT experience_relations_once UNIQUE NULLS NOT DISTINCT (from_id, to_id, to_region_id, relation),
    -- a held_at whose region went (its view deleted) is asked again with no target
    CONSTRAINT experience_relations_one_target CHECK (num_nonnulls(to_id, to_region_id) = 1
        OR (relation = 'held_at' AND state = 'proposed' AND to_id IS NULL AND to_region_id IS NULL)),
    CONSTRAINT experience_relations_region_held_at CHECK (to_region_id IS NULL OR relation = 'held_at'),
    CONSTRAINT experience_relations_not_itself CHECK (from_id IS DISTINCT FROM to_id),
    CONSTRAINT experience_relations_strength_of_met_at CHECK ((relation = 'met_at') = (strength IS NOT NULL)),
    CONSTRAINT experience_relations_one_of_them_answered CHECK (strength IS DISTINCT FROM 'one_of_them' OR decided_at IS NOT NULL),
    CONSTRAINT experience_relations_from_a_source CHECK (source_id <> 11),
    CONSTRAINT experience_relations_refused_state CHECK ((state = 'refused') = (refused_at IS NOT NULL)),
    CONSTRAINT experience_relations_proposed_unanswered CHECK (state <> 'proposed' OR decided_at IS NULL),
    CONSTRAINT experience_relations_decided_pair CHECK (decided_by IS NULL OR decided_at IS NOT NULL),
    CONSTRAINT experience_relations_refused_pair CHECK (refused_by IS NULL OR refused_at IS NOT NULL),
    CONSTRAINT experience_relations_statement_property CHECK ((statement_id IS NULL) OR (statement_property IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_experience_relations_region ON experience_relations (to_region_id) WHERE to_region_id IS NOT NULL;
-- Writer (ADR-0069): the relations' writer module, the run's statement pass and a curator's answer under the lock.
CREATE INDEX IF NOT EXISTS idx_experience_relations_to ON experience_relations (to_id, relation) WHERE state = 'standing';
CREATE INDEX IF NOT EXISTS idx_experience_relations_from ON experience_relations (from_id, relation) WHERE state = 'standing';
CREATE INDEX IF NOT EXISTS idx_experience_relations_asked ON experience_relations (proposed_at) WHERE state = 'proposed';

-- When a held_at relation held: Maslenitsa at its first village until it moves; a biennale at
-- its venue. Written only from a P276 statement's P580/P582 qualifiers, which most statements lack: the
-- Gion Matsuri's held_at Yasaka Shrine has no row here, and a relation with no period holds for every date
-- (held_at_on()). A period narrows when the relation held; an event whose dated periods do
-- not cover a trip's date asks where it was.
-- The period block, whole and under its names and CHECKs.
CREATE TABLE IF NOT EXISTS experience_relation_periods (
    relation_id     integer NOT NULL CONSTRAINT experience_relation_periods_relation_id_fkey REFERENCES experience_relations(id) ON DELETE CASCADE,
    ordinal         smallint NOT NULL CONSTRAINT experience_relation_periods_ordinal_check CHECK (ordinal > 0),
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT,
    from_span VARCHAR(10) CONSTRAINT experience_relation_periods_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CONSTRAINT experience_relation_periods_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),          -- P580 start time
    from_statement TEXT CONSTRAINT experience_relation_periods_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT,
    until_span VARCHAR(10) CONSTRAINT experience_relation_periods_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CONSTRAINT experience_relation_periods_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),        -- P582 end time
    until_statement TEXT CONSTRAINT experience_relation_periods_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    from_first INTEGER, until_last INTEGER,   -- outer days by periodOf (@tyr/shared/lifetime); every read compares these
    CONSTRAINT experience_relation_periods_pkey PRIMARY KEY (relation_id, ordinal),
    CONSTRAINT experience_relation_periods_ok CHECK (period_ok(from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last))   -- period_ok() owns the signature
);

-- ADR-0218 decisions 3 and 9: outside the World Heritage list no rule makes a record
-- a whole; a check proposes candidates and a curator answers. The answered row is also the mark of a
-- confirmed series that has no part yet, which a class object (shape none, no parts) is not.
-- Writers: the series-candidate check and the series answer's writer (under the record's lock).
CREATE TABLE IF NOT EXISTS experience_series_proposals (
    id            SERIAL CONSTRAINT experience_series_proposals_pkey PRIMARY KEY,
    -- The Egyptian pyramids (pin at an arbitrary point in Cairo); Khajuraho in Places of worship.
    experience_id integer NOT NULL CONSTRAINT experience_series_proposals_experience_id_key UNIQUE CONSTRAINT experience_series_proposals_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- far_parts (Wikidata parts with coordinates of their own far apart), second_point (a second distant
    -- coordinate), ensemble_class, part_claims (records already name it as their whole), curator (a
    -- curator made it a series from its card).
    found_by      varchar(14) NOT NULL
                  CONSTRAINT experience_series_proposals_found_by_check CHECK (found_by IN ('far_parts', 'second_point', 'ensemble_class', 'part_claims', 'curator')),
    signal_m      integer,      -- the spread the signal measured, in metres; NULL for a class or a claim
    proposed_at   timestamptz NOT NULL DEFAULT now(),
    -- series: shape none at once through the shape writer (pinned), listed, drawn by its parts once
    -- any is shown; not_series: never asked again; same_place: the second coordinate is another
    -- record of the same thing, and the answer is a merge.
    answer        varchar(12) CONSTRAINT experience_series_proposals_answer_check CHECK (answer IN ('series', 'not_series', 'same_place')),
    answered_at   timestamptz,
    answered_by   integer CONSTRAINT experience_series_proposals_answered_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    taken_back_at timestamptz,
    CONSTRAINT experience_series_proposals_answer_answered_at_check CHECK ((answer IS NULL) = (answered_at IS NULL)),
    CONSTRAINT experience_series_proposals_found_by_answer_check CHECK (found_by <> 'curator' OR answer = 'series')
);

CREATE TABLE IF NOT EXISTS experience_treasure_periods (
  link_id      integer  NOT NULL CONSTRAINT experience_treasure_periods_link_id_fkey REFERENCES experience_treasures(id) ON DELETE CASCADE,
  ordinal      smallint NOT NULL CONSTRAINT experience_treasure_periods_ordinal_check CHECK (ordinal >= 1),
  -- the period block, whole and under these names:
  from_year integer, from_month smallint, from_day smallint,
  from_span varchar(10) CONSTRAINT experience_treasure_periods_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
  from_circa boolean NOT NULL DEFAULT false,
  from_property varchar(12) CONSTRAINT experience_treasure_periods_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
  from_statement text CONSTRAINT experience_treasure_periods_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
  ended boolean NOT NULL DEFAULT false,
  until_year integer, until_month smallint, until_day smallint,
  until_span varchar(10) CONSTRAINT experience_treasure_periods_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
  until_circa boolean NOT NULL DEFAULT false,
  until_property varchar(12) CONSTRAINT experience_treasure_periods_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
  until_statement text CONSTRAINT experience_treasure_periods_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
  from_first integer, until_last integer,
  CONSTRAINT experience_treasure_periods_period CHECK (period_ok(from_year, from_month, from_day, from_span, from_circa, ended,
      until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
  -- How the period ended (the card's words "until 1990, stolen"), from the end cause (P1534) of
  -- the statement or a curator's answer: 'moved' (Guernica, New York until 1981, sale and
  -- restitution included), 'stolen' (The Concert, 1990), 'lost' (whereabouts unknown), 'destroyed'
  -- (a work burnt with the Museu Nacional in 2018). NULL on an open period or an end not told.
  ending       varchar(10) CONSTRAINT experience_treasure_periods_ending_check CHECK (ending IN ('moved', 'stolen', 'lost', 'destroyed')),
  -- What the period says of the work at this venue: 'there' (held and on view: the Ishtar Gate in the
  -- Pergamon Museum's north wing once it reopens) or 'off_view' (held, not on view: the south wing's works while it
  -- stays closed into the 2030s). here_today is false while an off_view period covers today; a trip inside an
  -- off_view period is not refused by the trip check of its slice of #2458 (the venue's closure is what refuses it).
  says         varchar(8) NOT NULL DEFAULT 'there',
  -- Who proposed the row: the run's source, or 11 (Curators) for a curator's own.
  source_id    integer NOT NULL CONSTRAINT experience_treasure_periods_source_id_fkey REFERENCES experience_sources(id),
  -- A curator's answer that wrote or confirmed it; NULL where it passed as a fill.
  decided_at   timestamptz,
  decided_by   integer CONSTRAINT experience_treasure_periods_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experience_treasure_periods_pkey PRIMARY KEY (link_id, ordinal),
  CONSTRAINT experience_treasure_periods_ending CHECK (ending IS NULL OR ended),
  CONSTRAINT experience_treasure_periods_says CHECK (says IN ('there', 'off_view')),
  -- off_view is a curator's answer or a source's statement, never a fill.
  CONSTRAINT experience_treasure_periods_off_view_answered CHECK (says = 'there' OR source_id <> 11 OR decided_at IS NOT NULL),
  CONSTRAINT experience_treasure_periods_off_view_no_ending CHECK (says = 'there' OR ending IS NULL),
  CONSTRAINT experience_treasure_periods_decided_pair CHECK (decided_by IS NULL OR decided_at IS NOT NULL)
);
-- Examples: (The Concert @ Gardner) ordinal 1: from not known (from_* NULL), until 18 March 1990,
-- ended, ending 'stolen': the first cut, which holds only an end. (Guernica @ MoMA)
-- 1 period 1939 -> 1981, 'moved'; (Guernica @ Reina Sofia) 1992 -> open.
-- Triggers:
--   link_periods_do_not_overlap  constraint trigger: the 'there' periods of one link do not overlap by outer
--                                days, and none ends in the future (ADR-0217 d2's rule, for links).
--   link_here_today              AFTER INSERT/UPDATE/DELETE: experience_treasures.here_today :=
--                                (no 'there' period, or one that is open) and no off_view period covers today.
--                                Its only writer.

CREATE TABLE IF NOT EXISTS experience_treasure_period_views (
  link_id      integer  NOT NULL CONSTRAINT experience_treasure_period_views_link_id_fkey REFERENCES experience_treasures(id) ON DELETE CASCADE,
  source_id    integer  NOT NULL CONSTRAINT experience_treasure_period_views_source_id_fkey REFERENCES experience_sources(id),
  ordinal      smallint NOT NULL CONSTRAINT experience_treasure_period_views_ordinal_check CHECK (ordinal >= 1),
  -- the period block, whole and under these names:
  from_year integer, from_month smallint, from_day smallint,
  from_span varchar(10) CONSTRAINT experience_treasure_period_views_from_span_check CHECK (from_span IN ('decade', 'century', 'millennium')),
  from_circa boolean NOT NULL DEFAULT false,
  from_property varchar(12) CONSTRAINT experience_treasure_period_views_from_property_check CHECK (from_property ~ '^P[1-9][0-9]*$'),
  from_statement text CONSTRAINT experience_treasure_period_views_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
  ended boolean NOT NULL DEFAULT false,
  until_year integer, until_month smallint, until_day smallint,
  until_span varchar(10) CONSTRAINT experience_treasure_period_views_until_span_check CHECK (until_span IN ('decade', 'century', 'millennium')),
  until_circa boolean NOT NULL DEFAULT false,
  until_property varchar(12) CONSTRAINT experience_treasure_period_views_until_property_check CHECK (until_property ~ '^P[1-9][0-9]*$'),
  until_statement text CONSTRAINT experience_treasure_period_views_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
  from_first integer, until_last integer,
  CONSTRAINT experience_treasure_period_views_period CHECK (period_ok(from_year, from_month, from_day, from_span, from_circa, ended,
      until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),  -- from_property/until_property 'P580'/'P582' on a P195 or P276 statement
  ending       varchar(10) CONSTRAINT experience_treasure_period_views_ending_check CHECK (ending IN ('moved', 'stolen', 'lost', 'destroyed')),
  sync_log_id  integer CONSTRAINT experience_treasure_period_views_sync_log_id_fkey REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
  CONSTRAINT experience_treasure_period_views_pkey PRIMARY KEY (link_id, source_id, ordinal),
  CONSTRAINT experience_treasure_period_views_ending CHECK (ending IS NULL OR ended)
);
-- Example: Art Museums' view of (Guernica @ MoMA): 1939 -> 1981, ended, ending 'moved',
-- until_property 'P582', until_statement the id of Guernica's P276 statement naming MoMA.

CREATE TABLE IF NOT EXISTS place_arrival_points (
    id            serial CONSTRAINT place_arrival_points_pkey PRIMARY KEY,
    -- The record one arrives at, of any shape but none (a serial site holds none; each of its
    -- parts holds its own). Yellowstone; the Serengeti; a Camino Frances stage.
    experience_id integer NOT NULL CONSTRAINT place_arrival_points_experience_id_fkey REFERENCES experiences(id) ON DELETE CASCADE,
    -- 'entrance' (Yellowstone's North Entrance at Gardiner), 'visitor_centre', 'ticket_office',
    -- 'trailhead', 'landing' (Sceilg Mhichíl's landing), 'stop' (a stage town on a trail
    -- section: Roncesvalles; never a part, #1948).
    role          varchar(14) NOT NULL CONSTRAINT place_arrival_points_role_check CHECK (role IN
                  ('entrance', 'visitor_centre', 'ticket_office', 'trailhead', 'landing', 'stop')),
    -- The name as the source gives it: 'North Entrance', 'Naabi Hill Gate', 'Roncesvalles'.
    name          varchar(500),
    location      geometry(Point, 4326) NOT NULL,
    -- How far along its record's line the point stands, in metres from its start, as the
    -- source states it: Roncesvalles 24,200 on the stage from Saint-Jean. Only on a stop or a
    -- trailhead; it is what a walk from one stop to another turns into kilometres.
    position_m    integer CONSTRAINT place_arrival_points_position_m_check CHECK (position_m >= 0),
    -- Who proposed it: 13 OpenStreetMap (a tourism=information or entrance node
    -- of the layer), 14 Wikivoyage (a typed marker of the English page), the trail's own
    -- source for its stops. Never 11: arrival points are only proposed and a
    -- curator answers; Tsingy de Bemaraha, which no source proposes, holds none and no curator is asked.
    source_id     integer NOT NULL CONSTRAINT place_arrival_points_source_id_fkey REFERENCES experience_sources(id),
    -- The object read: 'node/2441397015'; for Wikivoyage the page and marker,
    -- 'en:Yellowstone_National_Park#North_Entrance'.
    object_ref    text NOT NULL,
    -- The tag that made the object an arrival point, for OpenStreetMap:
    -- 'entrance=main', 'tourism=information'. With object_ref and read_at, the provenance ADR-0059 asks for.
    tag_read      varchar(100),
    read_at       timestamptz NOT NULL DEFAULT now(),
    -- The source stopped proposing it. A confirmed point stays shown, and a check lists it.
    missing_since timestamptz,
    -- The one a navigation link goes to (ADR-0115 targets). A curator's choice among
    -- confirmed points: no source proposes it.
    is_main       boolean NOT NULL DEFAULT false,
    -- The curator's answer: confirmed, or refused (a refused proposal is kept so the next
    -- pass does not ask again, and readers never see it).
    decided_at    timestamptz,
    decided_by    integer CONSTRAINT place_arrival_points_decided_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    refused_at    timestamptz,
    refused_by    integer CONSTRAINT place_arrival_points_refused_by_fkey REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT arrival_points_one_answer CHECK (decided_at IS NULL OR refused_at IS NULL),
    CONSTRAINT arrival_points_main_is_confirmed CHECK (NOT is_main OR decided_at IS NOT NULL),
    CONSTRAINT arrival_points_position_on_a_line CHECK (position_m IS NULL OR role IN ('stop', 'trailhead')),
    CONSTRAINT arrival_points_from_a_source CHECK (source_id <> 11),
    -- every OpenStreetMap object carries its tag, whichever source proposed it (a trail source keyed by OSM
    -- ids proposes its stops); source 13 proposes nothing else.
    CONSTRAINT arrival_points_osm_tag CHECK (object_ref !~ '^(node|way|relation)/' OR tag_read IS NOT NULL),
    CONSTRAINT arrival_points_osm_source_object CHECK (source_id <> 13 OR source_id_fits_scheme('osm-object', object_ref)),
    CONSTRAINT arrival_points_verdict_pairs CHECK (
        (decided_by IS NULL OR decided_at IS NOT NULL) AND (refused_by IS NULL OR refused_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS arrival_points_one_main ON place_arrival_points (experience_id) WHERE is_main;
CREATE UNIQUE INDEX IF NOT EXISTS arrival_points_one_per_object ON place_arrival_points (experience_id, source_id, object_ref);
-- Writer (ADR-0069): the arrival-point pass (services/sync/osm) and a curator's answer under the lock.
CREATE INDEX IF NOT EXISTS idx_arrival_points_record ON place_arrival_points (experience_id);
-- The "still unchecked" list of #505: proposed, unanswered, on a record of any shape.
CREATE INDEX IF NOT EXISTS idx_arrival_points_unanswered ON place_arrival_points (experience_id)
    WHERE decided_at IS NULL AND refused_at IS NULL;

CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER CONSTRAINT settlements_pkey PRIMARY KEY,                      -- GeoNames' geonameid (cities500)
    name VARCHAR(200) NOT NULL,                  -- 'Siena'
    country_code CHAR(2) NOT NULL,               -- 'IT'
    location geometry(Point, 4326) NOT NULL,
    population INTEGER NOT NULL CONSTRAINT settlements_population_check CHECK (population >= 0),
    radius_m INTEGER NOT NULL CONSTRAINT settlements_radius_m_check CHECK (radius_m > 0),  -- the size a pick brings, from population by settlementRadius() (@tyr/shared/ownPoints)
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_location ON settlements USING gist (location);

CREATE TABLE IF NOT EXISTS settlement_names (
    settlement_id INTEGER NOT NULL CONSTRAINT settlement_names_settlement_id_fkey REFERENCES settlements(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,                  -- 'Sienne', 'Сиена'
    CONSTRAINT settlement_names_pkey PRIMARY KEY (settlement_id, name)
);
CREATE INDEX IF NOT EXISTS settlement_names_trgm ON settlement_names USING gin (name gin_trgm_ops);

-- The daily here-today pass and link_here_today() find a link's off-view periods without its 'there' rows.
CREATE INDEX IF NOT EXISTS idx_experience_treasure_periods_off_view
    ON experience_treasure_periods (link_id) WHERE says = 'off_view';

-- ---------------------------------------------------------------------------
-- The triggers that guard the new tables' own rows
-- ---------------------------------------------------------------------------

-- What UNESCO's dataset says of an inscription, and when the property stood on the Danger List, are
-- the World Heritage list's own facts: a row only on a membership of a kind whose list is kept outside
-- the catalogue, filled by source 1 (Cologne Cathedral's World Heritage membership holds criteria
-- (i)(ii)(iv) and its Danger stay 2004 -> 2006; its Places of worship membership holds neither).
-- A CHECK cannot read another row, so the function is the CHECK.
CREATE OR REPLACE FUNCTION inscription_on_heritage_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM source_records r
                     JOIN experience_kinds k ON k.id = r.kind_id
                    WHERE r.id = NEW.record_id AND r.source_id = 1 AND k.list_kept_outside) THEN
        RAISE EXCEPTION '% row on record %: not a World Heritage membership of source 1', TG_TABLE_NAME, NEW.record_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- Each class a kind's rule matched is a Wikidata item: Cologne Cathedral's Places of
-- worship reading holds the item of 'cathedral', never a label. Every element, which a CHECK cannot
-- iterate without a function.
CREATE OR REPLACE FUNCTION rule_reads_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    bad text;
BEGIN
    SELECT c INTO bad FROM unnest(NEW.wikidata_classes) AS c
     WHERE c IS NULL OR c !~ '^Q[1-9][0-9]*$' LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'record_rule_reads.wikidata_classes of record % holds %, not a Wikidata item', NEW.record_id, bad
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- Only a held_at relation carries periods: the Gion Matsuri held at Yasaka Shrine in July, a festival
-- moved to another venue in a given year. Deferred, so a writer may write the relation and its periods
-- in either order inside one transaction.
CREATE OR REPLACE FUNCTION relation_periods_held_at_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_relations r WHERE r.id = NEW.relation_id AND r.relation <> 'held_at') THEN
    RAISE EXCEPTION 'relation % is not held_at and carries no period', NEW.relation_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- One relation's periods do not overlap by outer days; two relations of one event may (a festival held
-- at two venues at once). An unknown start reaches back without bound, an open period forward without
-- bound, and an ended period whose end is unknown covers at least its own start.
CREATE OR REPLACE FUNCTION relation_periods_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash record;
BEGIN
  SELECT a.ordinal AS one, b.ordinal AS other INTO clash
    FROM experience_relation_periods a
    JOIN experience_relation_periods b ON b.relation_id = a.relation_id AND b.ordinal > a.ordinal
   WHERE a.relation_id = NEW.relation_id
     AND COALESCE(a.from_first, -2147483648)
         <= CASE WHEN NOT b.ended THEN 2147483647 ELSE COALESCE(b.until_last, b.from_first, 2147483647) END
     AND COALESCE(b.from_first, -2147483648)
         <= CASE WHEN NOT a.ended THEN 2147483647 ELSE COALESCE(a.until_last, a.from_first, 2147483647) END
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'periods % and % of relation % overlap', clash.one, clash.other, NEW.relation_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- The 'there' periods of one link do not overlap by outer days, and none ends after today (ADR-0217
-- d2's rule, for links): Guernica's MoMA link holds 1939 -> 1981, its Reina Sofia link 1992 -> open; The
-- Concert at the Gardner, from unknown to 18 March 1990, stolen. Bounds as relation_periods_no_overlap()
-- reads them. An 'off_view' period (the Ishtar Gate while the Pergamon Museum's wing is closed) is not
-- read. Deferred, so a writer may renumber a link's periods inside one transaction.
CREATE OR REPLACE FUNCTION link_periods_do_not_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash record;
BEGIN
  IF EXISTS (SELECT 1 FROM experience_treasure_periods p
              WHERE p.link_id = NEW.link_id AND p.says = 'there' AND p.ended
                AND p.until_last > current_day_index()) THEN
    RAISE EXCEPTION 'a period of work link % ends after today', NEW.link_id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.ordinal AS one, b.ordinal AS other INTO clash
    FROM experience_treasure_periods a
    JOIN experience_treasure_periods b ON b.link_id = a.link_id AND b.ordinal > a.ordinal AND b.says = 'there'
   WHERE a.link_id = NEW.link_id AND a.says = 'there'
     AND COALESCE(a.from_first, -2147483648)
         <= CASE WHEN NOT b.ended THEN 2147483647 ELSE COALESCE(b.until_last, b.from_first, 2147483647) END
     AND COALESCE(b.from_first, -2147483648)
         <= CASE WHEN NOT a.ended THEN 2147483647 ELSE COALESCE(a.until_last, a.from_first, 2147483647) END
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'periods % and % of work link % overlap', clash.one, clash.other, NEW.link_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- The only writer of experience_treasures.here_today: a link with no 'there' period is here at every
-- date; one whose 'there' periods have all ended is not (The Concert, stolen 1990); and none is here
-- while an 'off_view' period covers today. links NULL: every link, for the daily pass that
-- catches an off_view period whose known end has come.
CREATE OR REPLACE FUNCTION refresh_link_here_today(links integer[]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  today integer := current_day_index();
  written integer;
BEGIN
  WITH wanted AS (
    SELECT et.id,
           (NOT EXISTS (SELECT 1 FROM experience_treasure_periods p WHERE p.link_id = et.id AND p.says = 'there')
            OR EXISTS (SELECT 1 FROM experience_treasure_periods p
                        WHERE p.link_id = et.id AND p.says = 'there' AND NOT p.ended))
           AND NOT EXISTS (SELECT 1 FROM experience_treasure_periods p
                            WHERE p.link_id = et.id AND p.says = 'off_view'
                              AND period_meets(p.from_first, p.ended, p.until_last, today, today)) AS here
      FROM experience_treasures et
     WHERE links IS NULL OR et.id = ANY(links)
  )
  UPDATE experience_treasures et SET here_today = w.here
    FROM wanted w
   WHERE et.id = w.id AND et.here_today IS DISTINCT FROM w.here;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END;
$$;

CREATE OR REPLACE FUNCTION link_here_today() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_link_here_today(ARRAY[NEW.link_id]);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_link_here_today(ARRAY[OLD.link_id]);
  ELSE
    PERFORM refresh_link_here_today(ARRAY[OLD.link_id, NEW.link_id]);
  END IF;
  RETURN NULL;
END;
$$;

-- An arrival point needs ground to arrive at (ADR-0218 d7): refused on a record of shape 'none' (a
-- serial site holds none; each of its parts holds its own: the Struve Arc's stations). A record
-- that becomes 'none' later (a confirmed series) keeps its rows, which arrivalPointShownSql hides and
-- the check arrival-points-without-ground lists.
CREATE OR REPLACE FUNCTION arrival_point_needs_ground() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM experiences e WHERE e.id = NEW.experience_id AND e.shape = 'none') THEN
    RAISE EXCEPTION 'record % has no ground of its own (shape none): an arrival point belongs on one of its parts (ADR-0218 d7)',
      NEW.experience_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Where an event was held on a trip's days: each standing held_at relation with a
-- target that has no period (a relation with no period holds for every date: the Gion Matsuri at Yasaka
-- Shrine, dates unknown, answers any trip, undated too), and each one with a period that meets the days
-- (any period when the trip is undated). One row answers the trip; none or several, and the product asks
-- where it was (ADR-0224 d2): a festival held at two places asks undated, and one whose only period is
-- 1990 -> 2009 asks for a trip of 2019. The reader of the event's tick, which lands with the visits.
CREATE OR REPLACE FUNCTION held_at_on(event_id integer, first_day integer, last_day integer)
RETURNS TABLE (place_id integer, region_id integer)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT r.to_id, r.to_region_id
      FROM experience_relations r
     WHERE r.from_id = event_id AND r.relation = 'held_at' AND r.state = 'standing'
       AND (r.to_id IS NOT NULL OR r.to_region_id IS NOT NULL)
       AND (first_day IS NULL
            OR NOT EXISTS (SELECT 1 FROM experience_relation_periods p WHERE p.relation_id = r.id)
            OR EXISTS (SELECT 1 FROM experience_relation_periods p
                        WHERE p.relation_id = r.id
                          AND period_meets(p.from_first, p.ended, p.until_last, first_day, COALESCE(last_day, first_day))));
$$;

-- The other half of the held_at-only rule: a relation that holds periods stays held_at. Turning the Gion
-- Matsuri's held_at Yasaka Shrine into a replica_of while a period hangs on it is refused at commit; the writer
-- deletes the periods first, in either order inside its transaction.
CREATE OR REPLACE FUNCTION relation_keeps_its_periods_held_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_relations r
              WHERE r.id = NEW.id AND r.relation <> 'held_at'
                AND EXISTS (SELECT 1 FROM experience_relation_periods p WHERE p.relation_id = r.id)) THEN
    RAISE EXCEPTION 'relation % is no longer held_at and still carries periods', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- A region that goes (its view deleted, or a region delete) takes no event with it: each
-- held_at relation on it loses its target and is proposed again, so the event asks where it is held and is
-- placed by its other relations meanwhile; where the event already holds such a target-less proposal, the
-- duplicate is deleted.
CREATE OR REPLACE FUNCTION reask_held_at_on_regions(gone integer[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- one target-less proposal per event: a second region of the same event, or one already asked, is deleted
  DELETE FROM experience_relations rel
   WHERE rel.to_region_id = ANY (gone)
     AND (EXISTS (SELECT 1 FROM experience_relations o
                   WHERE o.from_id = rel.from_id AND o.relation = 'held_at'
                     AND o.to_id IS NULL AND o.to_region_id IS NULL)
          OR rel.id <> (SELECT min(r2.id) FROM experience_relations r2
                         WHERE r2.to_region_id = ANY (gone) AND r2.from_id = rel.from_id));
  UPDATE experience_relations rel
     SET to_region_id = NULL, state = 'proposed', decided_at = NULL, decided_by = NULL,
         refused_at = NULL, refused_by = NULL, updated_at = now()
   WHERE rel.to_region_id = ANY (gone);
END;
$$;

CREATE OR REPLACE FUNCTION regions_delete_reasks_held_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_relations rel WHERE rel.to_region_id = OLD.id) THEN
    PERFORM reask_held_at_on_regions(ARRAY[OLD.id]);
  END IF;
  RETURN OLD;
END;
$$;

-- The stays on the List of World Heritage in Danger hold together: one record's stays do not overlap (the
-- overlap rule of relation_periods_no_overlap()), their ordinals follow their beginnings (Cologne 2004 -> 2006
-- is stay 1, a stay of 1990 -> 1991 cannot be stay 3), and a curator's stay (Curators, 11) stands only on a
-- membership whose curated_fields claim 'danger', so the next UNESCO run knows to leave it. Deferred: a writer
-- claims the field and writes the stays in either order. curated_fields is still a jsonb list here; the
-- slice that makes it a word array reads the claim as one.
CREATE OR REPLACE FUNCTION danger_periods_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM record_danger_periods d WHERE d.record_id = NEW.record_id AND d.ordinal = NEW.ordinal) THEN
    RETURN NULL;
  END IF;
  SELECT a.ordinal AS one, b.ordinal AS other INTO clash
    FROM record_danger_periods a
    JOIN record_danger_periods b ON b.record_id = a.record_id AND b.ordinal > a.ordinal
   WHERE a.record_id = NEW.record_id
     AND COALESCE(a.from_first, -2147483648)
         <= CASE WHEN NOT b.ended THEN 2147483647 ELSE COALESCE(b.until_last, b.from_first, 2147483647) END
     AND COALESCE(b.from_first, -2147483648)
         <= CASE WHEN NOT a.ended THEN 2147483647 ELSE COALESCE(a.until_last, a.from_first, 2147483647) END
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'danger stays % and % of record % overlap', clash.one, clash.other, NEW.record_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  SELECT a.ordinal AS one, b.ordinal AS other INTO clash
    FROM record_danger_periods a
    JOIN record_danger_periods b ON b.record_id = a.record_id AND b.ordinal > a.ordinal
   WHERE a.record_id = NEW.record_id AND a.from_first > b.from_first
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'danger stay % of record % begins after stay %: the ordinals follow time', clash.one, NEW.record_id, clash.other
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM record_danger_periods d
              WHERE d.record_id = NEW.record_id AND d.ordinal = NEW.ordinal AND d.source_id = 11)
     AND NOT EXISTS (SELECT 1 FROM source_records s
                      WHERE s.id = NEW.record_id AND s.curated_fields ? 'danger') THEN
    RAISE EXCEPTION 'a curator''s danger stay on record % needs the record''s claim on ''danger'' (curated_fields)', NEW.record_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inscription_on_heritage_record ON record_heritage_inscriptions;
CREATE TRIGGER trg_inscription_on_heritage_record
    BEFORE INSERT OR UPDATE OF record_id ON record_heritage_inscriptions
    FOR EACH ROW EXECUTE FUNCTION inscription_on_heritage_record();

DROP TRIGGER IF EXISTS trg_inscription_on_heritage_record ON record_danger_periods;
CREATE TRIGGER trg_inscription_on_heritage_record
    BEFORE INSERT OR UPDATE OF record_id ON record_danger_periods
    FOR EACH ROW EXECUTE FUNCTION inscription_on_heritage_record();

DROP TRIGGER IF EXISTS trg_rule_reads_items ON record_rule_reads;
CREATE TRIGGER trg_rule_reads_items
    BEFORE INSERT OR UPDATE OF wikidata_classes ON record_rule_reads
    FOR EACH ROW EXECUTE FUNCTION rule_reads_items();

DROP TRIGGER IF EXISTS trg_relation_periods_held_at_only ON experience_relation_periods;
CREATE CONSTRAINT TRIGGER trg_relation_periods_held_at_only
    AFTER INSERT OR UPDATE OF relation_id ON experience_relation_periods
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION relation_periods_held_at_only();

DROP TRIGGER IF EXISTS trg_relation_periods_no_overlap ON experience_relation_periods;
CREATE CONSTRAINT TRIGGER trg_relation_periods_no_overlap
    AFTER INSERT OR UPDATE ON experience_relation_periods
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION relation_periods_no_overlap();

DROP TRIGGER IF EXISTS link_periods_do_not_overlap ON experience_treasure_periods;
CREATE CONSTRAINT TRIGGER link_periods_do_not_overlap
    AFTER INSERT OR UPDATE ON experience_treasure_periods
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.says = 'there')
    EXECUTE FUNCTION link_periods_do_not_overlap();

DROP TRIGGER IF EXISTS link_here_today ON experience_treasure_periods;
CREATE TRIGGER link_here_today
    AFTER INSERT OR UPDATE OR DELETE ON experience_treasure_periods
    FOR EACH ROW EXECUTE FUNCTION link_here_today();

DROP TRIGGER IF EXISTS arrival_point_needs_ground ON place_arrival_points;
CREATE TRIGGER arrival_point_needs_ground
  BEFORE INSERT OR UPDATE OF experience_id ON place_arrival_points
  FOR EACH ROW EXECUTE FUNCTION arrival_point_needs_ground();

DROP TRIGGER IF EXISTS trg_relation_keeps_its_periods_held_at ON experience_relations;
CREATE CONSTRAINT TRIGGER trg_relation_keeps_its_periods_held_at
    AFTER UPDATE OF relation ON experience_relations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.relation <> 'held_at')
    EXECUTE FUNCTION relation_keeps_its_periods_held_at();

DROP TRIGGER IF EXISTS trg_danger_periods_hold ON record_danger_periods;
CREATE CONSTRAINT TRIGGER trg_danger_periods_hold
    AFTER INSERT OR UPDATE ON record_danger_periods
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION danger_periods_hold();

DROP TRIGGER IF EXISTS regions_delete_reasks_held_at ON regions;
CREATE TRIGGER regions_delete_reasks_held_at
  BEFORE DELETE ON regions
  FOR EACH ROW EXECUTE FUNCTION regions_delete_reasks_held_at();

COMMIT;
