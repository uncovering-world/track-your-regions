-- 264-the-model-adds-columns.sql
--
-- The clean catalogue model, additive half, step 2 of 4 (#2634, ADR-0217,
-- ADR-0218, ADR-0219, ADR-0224): every column of the model that a table of
-- today gains and today's code neither reads nor has to write.
--
-- Each column is nullable or carries a default, so every INSERT of today's
-- writers stays valid; each CHECK, foreign key and unique key added here names
-- only new columns, or holds trivially on today's rows (an id paired with its
-- own row's place; a shape test on a class item that is NULL on every row).
-- What tightens a column today's code writes, renames, retypes or drops is not
-- here: it lands with the code that answers for it, in the slices of #2458.
-- Among them: experiences.claimed_location (its
-- CHECK reads curated_fields as an array), experience_curation_log.actor (the
-- log writer has to say who acted), experience_sync_logs.mode (it replaces
-- is_dry_run), the point tables' record_id (#2124),
-- region_geom_pieces.ordinal (the cut writes it), and
-- experience_sources.licence, added nullable here and required once the
-- seeds and the admin panel write it.
--
-- The derived columns (experiences.pin, extent, shape_min_zoom,
-- boundary_simple, path_simple, length_m; source_records.stands_today;
-- experience_treasures.here_today; world_views.ground_missing_count) arrive
-- empty or at their default: their triggers come with the slices that switch
-- the readers to them, and those recompute them: a derived value is
-- recomputed, never copied (#2634).
-- 266 fills the columns whose value today's rows already state.
--
-- Two columns rewrite their table: place_periods.id (a serial, numbering the
-- rows it finds) and treasures.is_wikidata_item (a stored generated column).
-- Every other ADD COLUMN takes a constant default or none and writes no row.
-- No row is written by this file, so no deferred trigger event is pending when
-- the ALTERs run (db/migrations/README.md). Re-runnable: ADD COLUMN IF NOT
-- EXISTS, each constraint added only where it is missing, CREATE INDEX IF NOT
-- EXISTS. Runs before the next re-application of 01-schema.sql, which declares
-- the same; in either order the two arrive at the same schema.

\set ON_ERROR_STOP on

BEGIN;

-- The ALTERs take each table exclusively for milliseconds, except the two
-- rewrites: a long transaction on them must not stall their writers behind
-- this one.
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS gadm_country character(3);

ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS kind_id integer;
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS reason_code character varying(20);
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS reason_text text;
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS record_id integer;
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS sync_log_id integer;
ALTER TABLE experience_curation_log ADD COLUMN IF NOT EXISTS undoes_log_id integer;

ALTER TABLE experience_hand_overs ADD COLUMN IF NOT EXISTS container_id integer;
ALTER TABLE experience_hand_overs ADD COLUMN IF NOT EXISTS decided_at timestamp with time zone;
ALTER TABLE experience_hand_overs ADD COLUMN IF NOT EXISTS decided_by integer;

ALTER TABLE experience_held_decisions ADD COLUMN IF NOT EXISTS treasure_id integer;

ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS form character varying(20) DEFAULT 'place'::character varying NOT NULL;
ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS list_kept_outside boolean DEFAULT false NOT NULL;
ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS tick_paints character varying(10) DEFAULT 'ground'::character varying NOT NULL;
ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS tick_verb character varying(12);
ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS tracks_distance boolean DEFAULT false NOT NULL;

ALTER TABLE experience_merge_proposals ADD COLUMN IF NOT EXISTS shared_item character varying(20);
ALTER TABLE experience_merge_proposals ADD COLUMN IF NOT EXISTS with_part_id integer;

ALTER TABLE experience_parts ADD COLUMN IF NOT EXISTS ordinal integer;
ALTER TABLE experience_parts ADD COLUMN IF NOT EXISTS role character varying(10) DEFAULT 'part'::character varying NOT NULL;

ALTER TABLE experience_regions ADD COLUMN IF NOT EXISTS former_region_name character varying(255);
ALTER TABLE experience_regions ADD COLUMN IF NOT EXISTS offered_region_ids integer[];

ALTER TABLE experience_rejections ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS licence character varying(20);
ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS work_enter_editions smallint;
ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS work_stay_editions smallint;

ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS record_id integer;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS code_version character varying(40);
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS quota_remaining integer;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS reused_from_sync_log_id integer;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS subset_dumped_at timestamp with time zone;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_pins_agreeing integer DEFAULT 0 NOT NULL;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_pins_asked integer DEFAULT 0 NOT NULL;

ALTER TABLE experience_treasure_placements ADD COLUMN IF NOT EXISTS evidence character varying(12) DEFAULT 'statement'::character varying NOT NULL;
ALTER TABLE experience_treasure_placements ADD COLUMN IF NOT EXISTS handed_by_source_id integer;

ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS copy_item character varying(20);
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS decided_at timestamp with time zone;
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS decided_by integer;
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS first_seen_sync_log_id integer;
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS here_today boolean DEFAULT true NOT NULL;
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS refused_by integer;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access character varying(10) DEFAULT 'open'::character varying NOT NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_decided_at timestamp with time zone;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_decided_by integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_from_circa boolean DEFAULT false NOT NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_from_day smallint;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_from_month smallint;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_from_span character varying(10);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_from_year integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_read_at timestamp with time zone;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_reason character varying(12);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_ref character varying(64);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS access_tag character varying(100);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS address_read_at timestamp with time zone;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS address_ref character varying(64);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS address_source character varying(8);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS address_tag character varying(100);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS boundary_simple geometry(MultiPolygon,4326);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS boundary_view_id integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS class_item character varying(20);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS description_source character varying(16);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS extent double precision[];
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS length_m integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS location_ref character varying(64);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS location_ref_read_at timestamp with time zone;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS location_ref_tag character varying(100);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path_simple geometry(MultiLineString,4326);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path_view_id integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS pin geometry(Point,4326);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS shape_min_zoom smallint;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS shape_pinned_at timestamp with time zone;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS shape_pinned_by integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS sitelinks_count integer;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS unesco_url character varying(1000);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS wikipedia_url character varying(1000);

ALTER TABLE membership_fame ADD COLUMN IF NOT EXISTS atlas_obscura boolean;

ALTER TABLE place_periods ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE place_periods ADD COLUMN IF NOT EXISTS decided_at timestamp with time zone;
ALTER TABLE place_periods ADD COLUMN IF NOT EXISTS id serial;
ALTER TABLE place_periods ADD COLUMN IF NOT EXISTS kind_id integer;
ALTER TABLE place_periods ADD COLUMN IF NOT EXISTS use_item text;

ALTER TABLE record_periods ADD COLUMN IF NOT EXISTS of_membership boolean DEFAULT false NOT NULL;
ALTER TABLE record_periods ADD COLUMN IF NOT EXISTS read_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE record_periods ADD COLUMN IF NOT EXISTS refused_at timestamp with time zone;
ALTER TABLE record_periods ADD COLUMN IF NOT EXISTS refused_by integer;
ALTER TABLE record_periods ADD COLUMN IF NOT EXISTS use_item text;

ALTER TABLE regions ADD COLUMN IF NOT EXISTS counts boolean DEFAULT false NOT NULL;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS ended boolean DEFAULT false NOT NULL;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_circa boolean DEFAULT false NOT NULL;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_day smallint;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_first integer;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_month smallint;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_property character varying(12);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_span character varying(10);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_statement text;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS from_year integer;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_circa boolean DEFAULT false NOT NULL;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_day smallint;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_last integer;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_month smallint;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_property character varying(12);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_span character varying(10);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_statement text;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS until_year integer;

ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admission_decided_at timestamp with time zone;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admission_decided_by integer;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admission_evidence jsonb;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admission_pin_evidence jsonb;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admitted_for_item character varying(20);
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS admitted_for_label text;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS part_role character varying(10);
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS refused_at timestamp with time zone;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS refused_by integer;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_length_m integer;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_makers jsonb;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_region_codes character(3)[];
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_region_items character varying(20)[];
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_region_labels text[];
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS stands_today boolean DEFAULT true NOT NULL;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS tier character varying(12);
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS visitor_finds character varying(10) DEFAULT 'unknown'::character varying NOT NULL;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS visitor_finds_decided_at timestamp with time zone;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS visitor_finds_decided_by integer;
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS visitor_finds_signal character varying(13);
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS visitor_finds_source_id integer;

ALTER TABLE treasures ADD COLUMN IF NOT EXISTS candidate_venue_items character varying(40)[] DEFAULT '{}'::character varying[] NOT NULL;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS found_at_item character varying(20);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS found_at_label character varying(500);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS iconic_by character varying(12);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS is_wikidata_item boolean GENERATED ALWAYS AS ((external_id)::text ~ '^Q[1-9][0-9]*$'::text) STORED;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS kind_answer_slug character varying(80);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS kind_answered_at timestamp with time zone;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS kind_answered_by integer;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS made_circa boolean DEFAULT false NOT NULL;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS made_day smallint;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS made_month smallint;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS made_span character varying(10);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS made_year integer;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS readers_12m integer;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS readers_through_month date;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS same_object_id integer;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS shown_nowhere_at timestamp with time zone;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS shown_nowhere_by integer;
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS version_of_item character varying(20);

ALTER TABLE user_visit_trips ADD COLUMN IF NOT EXISTS at_link_id integer;
ALTER TABLE user_visit_trips ADD COLUMN IF NOT EXISTS first_day integer;
ALTER TABLE user_visit_trips ADD COLUMN IF NOT EXISTS last_day integer;
ALTER TABLE user_visit_trips ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamp with time zone;

ALTER TABLE world_views ADD COLUMN IF NOT EXISTS finalized_at timestamp with time zone;
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS ground_missing_count integer DEFAULT 0 NOT NULL;
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS ground_missing_since timestamp with time zone;
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS is_canon boolean DEFAULT false NOT NULL;
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS source_credit character varying(255);
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS source_licence character varying(40);

-- ---------------------------------------------------------------------------
-- Constraints on the new columns
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'administrative_divisions_gadm_country_check' AND conrelid = 'administrative_divisions'::regclass) THEN
    ALTER TABLE administrative_divisions ADD CONSTRAINT administrative_divisions_gadm_country_check CHECK ((gadm_country ~ '^[A-Z0-9]{3}$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'world_views_credit_pair' AND conrelid = 'world_views'::regclass) THEN
    ALTER TABLE world_views ADD CONSTRAINT world_views_credit_pair CHECK (((source_credit IS NULL) = (source_licence IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'world_views_ground_missing_ok' AND conrelid = 'world_views'::regclass) THEN
    ALTER TABLE world_views ADD CONSTRAINT world_views_ground_missing_ok CHECK (((ground_missing_count >= 0) AND ((ground_missing_count = 0) = (ground_missing_since IS NULL))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_from_span_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_from_span_check CHECK ((from_span IN ('decade', 'century', 'millennium')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_from_property_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_from_property_check CHECK (((from_property)::text ~ '^P[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_from_statement_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_from_statement_check CHECK (source_id_fits_scheme('wikidata-statement'::text, from_statement));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_until_span_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_until_span_check CHECK ((until_span IN ('decade', 'century', 'millennium')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_until_property_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_until_property_check CHECK (((until_property)::text ~ '^P[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_until_statement_check' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_until_statement_check CHECK (source_id_fits_scheme('wikidata-statement'::text, until_statement));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_period' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_period CHECK (period_ok(from_year, from_month, from_day, (from_span)::text, from_circa, ended, until_year, until_month, until_day, (until_span)::text, until_circa, from_first, until_last));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_closed_says_when' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_closed_says_when CHECK (((NOT ended) OR (until_year IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regions_id_view' AND conrelid = 'regions'::regclass) THEN
    ALTER TABLE regions ADD CONSTRAINT regions_id_view UNIQUE (id, world_view_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_kinds_form_check' AND conrelid = 'experience_kinds'::regclass) THEN
    ALTER TABLE experience_kinds ADD CONSTRAINT experience_kinds_form_check CHECK ((form IN ('place', 'work', 'food', 'drink', 'event', 'route', 'activity', 'title', 'person', 'species', 'object', 'sound')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_kinds_tick_verb_check' AND conrelid = 'experience_kinds'::regclass) THEN
    ALTER TABLE experience_kinds ADD CONSTRAINT experience_kinds_tick_verb_check CHECK ((tick_verb IN ('tried', 'attended', 'saw', 'walked', 'cycled', 'read', 'watched')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sources_work_enter_editions_check' AND conrelid = 'experience_sources'::regclass) THEN
    ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_work_enter_editions_check CHECK ((work_enter_editions > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_kinds_tick_paints_check' AND conrelid = 'experience_kinds'::regclass) THEN
    ALTER TABLE experience_kinds ADD CONSTRAINT experience_kinds_tick_paints_check CHECK ((tick_paints IN ('ground', 'held_at', 'asks_where')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_kinds_distance_walks' AND conrelid = 'experience_kinds'::regclass) THEN
    ALTER TABLE experience_kinds ADD CONSTRAINT experience_kinds_distance_walks CHECK (((NOT tracks_distance) OR (tick_verb IN ('walked', 'cycled'))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sources_work_stay_editions_check' AND conrelid = 'experience_sources'::regclass) THEN
    ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_work_stay_editions_check CHECK ((work_stay_editions > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sources_licence_check' AND conrelid = 'experience_sources'::regclass) THEN
    ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_licence_check CHECK ((licence IN ('CC0 1.0', 'CC BY-SA 4.0', 'CC BY 4.0', 'ODbL 1.0', 'OGL 3.0', 'own')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sources_work_line' AND conrelid = 'experience_sources'::regclass) THEN
    ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_work_line CHECK ((((work_enter_editions IS NULL) = (work_stay_editions IS NULL)) AND ((work_stay_editions IS NULL) OR (work_stay_editions <= work_enter_editions))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_length_m_check' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_length_m_check CHECK ((length_m > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_address_osm_provenance' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_address_osm_provenance CHECK (((((address_source)::text = 'osm'::text) = (address_ref IS NOT NULL)) AND ((address_ref IS NULL) = (address_tag IS NULL)) AND ((address_ref IS NULL) = (address_read_at IS NULL)) AND ((address_ref IS NULL) OR source_id_fits_scheme('osm-object'::text, (address_ref)::text))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_region_labels_pair' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_region_labels_pair CHECK ((((reported_region_items IS NULL) = (reported_region_labels IS NULL)) AND ((reported_region_items IS NULL) = (reported_region_codes IS NULL)) AND (NOT (cardinality(reported_region_items) IS DISTINCT FROM cardinality(reported_region_labels))) AND (NOT (cardinality(reported_region_items) IS DISTINCT FROM cardinality(reported_region_codes)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_check' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_check CHECK ((access IN ('open', 'restricted', 'none')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_reason_check' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_reason_check CHECK ((access_reason IN ('men_only', 'permit', 'guided_only', 'outside_only')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_links_are_http' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_links_are_http CHECK ((((wikipedia_url IS NULL) OR ((wikipedia_url)::text ~ '^https://[a-z-]+\.wikipedia\.org/wiki/.+'::text)) AND ((unesco_url IS NULL) OR ((unesco_url)::text ~ '^https?://whc\.unesco\.org/.+'::text))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_address_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_address_ok CHECK ((((address IS NULL) = (address_source IS NULL)) AND ((address_source IS NULL) OR (address_source IN ('wikidata', 'osm', 'curator')))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_sitelinks_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_sitelinks_ok CHECK (((sitelinks_count IS NULL) OR (sitelinks_count >= 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_shape_pin_is_a_pair' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_shape_pin_is_a_pair CHECK (((shape_pinned_by IS NULL) OR (shape_pinned_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_location_ref_osm_provenance' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_location_ref_osm_provenance CHECK (((((location_ref IS NOT NULL) AND source_id_fits_scheme('osm-object'::text, (location_ref)::text)) = (location_ref_read_at IS NOT NULL)) AND ((location_ref_read_at IS NULL) = (location_ref_tag IS NULL))));
  END IF;
  -- One spelling of an OpenStreetMap object, 'node/…', 'way/…' or 'relation/…', or a Wikidata item.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_location_ref_form' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_location_ref_form CHECK (((location_ref IS NULL) OR source_id_fits_scheme('osm-object'::text, (location_ref)::text) OR source_id_fits_scheme('wikidata'::text, (location_ref)::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_class_item_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_class_item_ok CHECK (((class_item IS NULL) OR (((class_item)::text ~ '^Q[1-9][0-9]*$'::text) AND ((shape)::text = 'none'::text))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_extent_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_extent_ok CHECK (((extent IS NULL) OR (array_length(extent, 1) = 4)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_osm_provenance' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_osm_provenance CHECK ((((access_ref IS NULL) = (access_tag IS NULL)) AND ((access_ref IS NULL) = (access_read_at IS NULL)) AND ((access_ref IS NULL) OR (((access)::text <> 'open'::text) AND source_id_fits_scheme('osm-object'::text, (access_ref)::text)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_min_zoom_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_min_zoom_ok CHECK ((((shape_min_zoom IS NULL) OR ((shape_min_zoom >= 0) AND (shape_min_zoom <= 22))) AND ((extent IS NOT NULL) OR (shape_min_zoom IS NULL))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_reason' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_reason CHECK ((((access)::text = 'restricted'::text) = (access_reason IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_answered' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_answered CHECK ((((access)::text = 'open'::text) OR (access_decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_decided_pair' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_decided_pair CHECK (((access_decided_by IS NULL) OR (access_decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_finds_decided_pair' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_finds_decided_pair CHECK (((visitor_finds_decided_by IS NULL) OR (visitor_finds_decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_since_ok' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_since_ok CHECK ((approx_date_ok(access_from_year, access_from_month, access_from_day, (access_from_span)::text, access_from_circa) AND ((access_from_span IS NULL) OR (access_from_span IN ('decade', 'century', 'millennium'))) AND (((access)::text <> 'open'::text) OR (access_from_year IS NULL))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_tier_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_tier_check CHECK ((tier IN ('world', 'surroundings', 'regional')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_refusal_pair' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_refusal_pair CHECK (((refused_by IS NULL) OR (refused_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_admitted_for_item_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_admitted_for_item_check CHECK (((admitted_for_item)::text ~ '^Q[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_part_role_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_part_role_check CHECK ((part_role IN ('part', 'copy', 'section')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_reported_region_items_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_reported_region_items_check CHECK (((reported_region_items IS NULL) OR (array_to_string(reported_region_items, ','::text) ~ '^Q[1-9][0-9]*(,Q[1-9][0-9]*)*$'::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_reported_region_codes_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_reported_region_codes_check CHECK (((reported_region_codes IS NULL) OR (array_to_string(reported_region_codes, ','::text) ~ '^[A-Z0-9]{3}(,[A-Z0-9]{3})*$'::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_reported_length_m_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_reported_length_m_check CHECK ((reported_length_m > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_visitor_finds_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_visitor_finds_check CHECK ((visitor_finds IN ('something', 'unknown', 'nothing')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_visitor_finds_signal_check' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_visitor_finds_signal_check CHECK ((visitor_finds_signal IN ('other_kind', 'own_article', 'picture', 'mapped_object', 'traveller')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_finds_has_proposer' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_finds_has_proposer CHECK ((((visitor_finds)::text = 'unknown'::text) OR (visitor_finds_signal IS NOT NULL) OR (visitor_finds_decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_decided_pair' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_decided_pair CHECK (((admission_decided_by IS NULL) OR (admission_decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_id_experience' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_id_experience UNIQUE (id, experience_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sync_logs_quota_remaining_check' AND conrelid = 'experience_sync_logs'::regclass) THEN
    ALTER TABLE experience_sync_logs ADD CONSTRAINT experience_sync_logs_quota_remaining_check CHECK ((quota_remaining >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_use_item_check' AND conrelid = 'place_periods'::regclass) THEN
    ALTER TABLE place_periods ADD CONSTRAINT place_periods_use_item_check CHECK (source_id_fits_scheme('wikidata'::text, use_item));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_periods_use_item_check' AND conrelid = 'record_periods'::regclass) THEN
    ALTER TABLE record_periods ADD CONSTRAINT record_periods_use_item_check CHECK (source_id_fits_scheme('wikidata'::text, use_item));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_periods_refused_pair' AND conrelid = 'record_periods'::regclass) THEN
    ALTER TABLE record_periods ADD CONSTRAINT record_periods_refused_pair CHECK (((refused_by IS NULL) OR (refused_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_reason_text_reason_code_check' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_reason_text_reason_code_check CHECK (((reason_text IS NULL) OR (reason_code IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_held_decisions_one_object' AND conrelid = 'experience_held_decisions'::regclass) THEN
    ALTER TABLE experience_held_decisions ADD CONSTRAINT experience_held_decisions_one_object CHECK ((num_nonnulls(record_id, treasure_id) <= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_batch_id_sync_log_id_check' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_batch_id_sync_log_id_check CHECK (((batch_id IS NULL) OR (sync_log_id IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_reason_code_check' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_reason_code_check CHECK ((reason_code IN ('not-this-kind', 'not-worth-a-visit', 'wrong-place', 'duplicate', 'gone', 'source-text', 'missing-from-rule', 'not-one-place', 'other')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_parts_role_check' AND conrelid = 'experience_parts'::regclass) THEN
    ALTER TABLE experience_parts ADD CONSTRAINT experience_parts_role_check CHECK ((role IN ('part', 'copy', 'section')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_parts_ordinal_check' AND conrelid = 'experience_parts'::regclass) THEN
    ALTER TABLE experience_parts ADD CONSTRAINT experience_parts_ordinal_check CHECK ((ordinal > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_merge_proposals_shared_item_check' AND conrelid = 'experience_merge_proposals'::regclass) THEN
    ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_shared_item_check CHECK (((shared_item)::text ~ '^Q[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_merge_proposals_answer_with_part_id_check' AND conrelid = 'experience_merge_proposals'::regclass) THEN
    ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_answer_with_part_id_check CHECK ((((answer)::text = 'one_with_part'::text) = (with_part_id IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_merge_proposals_with_part_id_place_a_place_b_check' AND conrelid = 'experience_merge_proposals'::regclass) THEN
    ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_with_part_id_place_a_place_b_check CHECK (((with_part_id IS NULL) OR ((with_part_id <> place_a) AND (with_part_id <> place_b))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_merge_proposals_found_by_shared_item_check' AND conrelid = 'experience_merge_proposals'::regclass) THEN
    ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_found_by_shared_item_check CHECK ((((found_by)::text = 'shared_item'::text) = (shared_item IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_readers_12m_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_readers_12m_check CHECK ((readers_12m >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_shown_nowhere_pair' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_shown_nowhere_pair CHECK (((shown_nowhere_by IS NULL) OR (shown_nowhere_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_iconic_by_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_iconic_by_check CHECK ((iconic_by IN ('editions', 'readership')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_readers_through_month_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_readers_through_month_check CHECK ((readers_through_month = (date_trunc('month'::text, (readers_through_month)::timestamp with time zone))::date));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_found_at_item_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_found_at_item_check CHECK (((found_at_item)::text ~ '^Q[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_version_of_item_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_version_of_item_check CHECK (((version_of_item)::text ~ '^Q[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_kind_answer_slug_check' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_kind_answer_slug_check CHECK (((kind_answer_slug)::text ~ '^[a-z0-9][a-z0-9-]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_made_ok' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_made_ok CHECK ((approx_date_ok(made_year, made_month, made_day, (made_span)::text, made_circa) AND ((made_year IS NULL) OR (made_year >= '-200000'::integer))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_readers_pair' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_readers_pair CHECK (((readers_12m IS NULL) = (readers_through_month IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_found_at_label' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_found_at_label CHECK (((found_at_item IS NULL) OR (found_at_label IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_kind_answer_pair' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_kind_answer_pair CHECK ((((kind_answer_slug IS NULL) = (kind_answered_at IS NULL)) AND ((kind_answered_by IS NULL) OR (kind_answered_at IS NOT NULL))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_same_object_id_key' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_same_object_id_key UNIQUE (same_object_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_copy_item_check' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_copy_item_check CHECK (((copy_item)::text ~ '^Q[1-9][0-9]*$'::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_refusal_pair' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_refusal_pair CHECK (((refused_by IS NULL) OR (refused_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_decided_pair' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_decided_pair CHECK (((decided_by IS NULL) OR (decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasure_placements_evidence_check' AND conrelid = 'experience_treasure_placements'::regclass) THEN
    ALTER TABLE experience_treasure_placements ADD CONSTRAINT experience_treasure_placements_evidence_check CHECK ((evidence IN ('statement', 'venue_side', 'shelf', 'hand_over')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasure_placements_hand_over' AND conrelid = 'experience_treasure_placements'::regclass) THEN
    ALTER TABLE experience_treasure_placements ADD CONSTRAINT experience_treasure_placements_hand_over CHECK ((((evidence)::text = 'hand_over'::text) = (handed_by_source_id IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_hand_overs_container_is_answer' AND conrelid = 'experience_hand_overs'::regclass) THEN
    ALTER TABLE experience_hand_overs ADD CONSTRAINT experience_hand_overs_container_is_answer CHECK (((container_id IS NULL) OR (decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_hand_overs_decided_pair' AND conrelid = 'experience_hand_overs'::regclass) THEN
    ALTER TABLE experience_hand_overs ADD CONSTRAINT experience_hand_overs_decided_pair CHECK (((decided_by IS NULL) OR (decided_at IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_id_visit_id_key' AND conrelid = 'user_visit_trips'::regclass) THEN
    ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_id_visit_id_key UNIQUE (id, visit_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_use_item_of_use' AND conrelid = 'place_periods'::regclass) THEN
    ALTER TABLE place_periods ADD CONSTRAINT place_periods_use_item_of_use CHECK (((use_item IS NULL) OR ((says)::text = 'used'::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_kind_of_standing' AND conrelid = 'place_periods'::regclass) THEN
    ALTER TABLE place_periods ADD CONSTRAINT place_periods_kind_of_standing CHECK (((kind_id IS NULL) OR (says IN ('stood', 'closed'))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_periods_use_item_of_use' AND conrelid = 'record_periods'::regclass) THEN
    ALTER TABLE record_periods ADD CONSTRAINT record_periods_use_item_of_use CHECK (((use_item IS NULL) OR ((says)::text = 'used'::text)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_periods_membership_of_standing' AND conrelid = 'record_periods'::regclass) THEN
    ALTER TABLE record_periods ADD CONSTRAINT record_periods_membership_of_standing CHECK (((NOT of_membership) OR (says IN ('stood', 'closed'))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_visitor_finds_source_id_fkey' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_visitor_finds_source_id_fkey FOREIGN KEY (visitor_finds_source_id) REFERENCES experience_sources(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_visitor_finds_decided_by_fkey' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_visitor_finds_decided_by_fkey FOREIGN KEY (visitor_finds_decided_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sync_logs_reused_from_sync_log_id_fkey' AND conrelid = 'experience_sync_logs'::regclass) THEN
    ALTER TABLE experience_sync_logs ADD CONSTRAINT experience_sync_logs_reused_from_sync_log_id_fkey FOREIGN KEY (reused_from_sync_log_id) REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_shape_pinned_by_fkey' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_shape_pinned_by_fkey FOREIGN KEY (shape_pinned_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_access_decided_by_fkey' AND conrelid = 'experiences'::regclass) THEN
    ALTER TABLE experiences ADD CONSTRAINT experiences_access_decided_by_fkey FOREIGN KEY (access_decided_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_admission_decided_by_fkey' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_admission_decided_by_fkey FOREIGN KEY (admission_decided_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_refused_by_fkey' AND conrelid = 'source_records'::regclass) THEN
    ALTER TABLE source_records ADD CONSTRAINT source_records_refused_by_fkey FOREIGN KEY (refused_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_sync_changes_record_id_fkey' AND conrelid = 'experience_sync_changes'::regclass) THEN
    ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_record_id_fkey FOREIGN KEY (record_id) REFERENCES source_records(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_kind_id_fkey' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_kind_id_fkey FOREIGN KEY (kind_id) REFERENCES experience_kinds(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_periods_refused_by_fkey' AND conrelid = 'record_periods'::regclass) THEN
    ALTER TABLE record_periods ADD CONSTRAINT record_periods_refused_by_fkey FOREIGN KEY (refused_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_periods_kind_id_fkey' AND conrelid = 'place_periods'::regclass) THEN
    ALTER TABLE place_periods ADD CONSTRAINT place_periods_kind_id_fkey FOREIGN KEY (kind_id) REFERENCES experience_kinds(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_sync_log_id_fkey' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_sync_log_id_fkey FOREIGN KEY (sync_log_id) REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_undoes_log_id_fkey' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_undoes_log_id_fkey FOREIGN KEY (undoes_log_id) REFERENCES experience_curation_log(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_curation_log_record_id_fkey' AND conrelid = 'experience_curation_log'::regclass) THEN
    ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_record_id_fkey FOREIGN KEY (record_id) REFERENCES source_records(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_merge_proposals_with_part_id_fkey' AND conrelid = 'experience_merge_proposals'::regclass) THEN
    ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_with_part_id_fkey FOREIGN KEY (with_part_id) REFERENCES experiences(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_first_seen_sync_log_id_fkey' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_first_seen_sync_log_id_fkey FOREIGN KEY (first_seen_sync_log_id) REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_decided_by_fkey' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_shown_nowhere_by_fkey' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_shown_nowhere_by_fkey FOREIGN KEY (shown_nowhere_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_kind_answered_by_fkey' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_kind_answered_by_fkey FOREIGN KEY (kind_answered_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_same_object_id_fkey' AND conrelid = 'treasures'::regclass) THEN
    ALTER TABLE treasures ADD CONSTRAINT treasures_same_object_id_fkey FOREIGN KEY (same_object_id) REFERENCES experiences(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_held_decisions_treasure_id_fkey' AND conrelid = 'experience_held_decisions'::regclass) THEN
    ALTER TABLE experience_held_decisions ADD CONSTRAINT experience_held_decisions_treasure_id_fkey FOREIGN KEY (treasure_id) REFERENCES treasures(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_refused_by_fkey' AND conrelid = 'experience_treasures'::regclass) THEN
    ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_refused_by_fkey FOREIGN KEY (refused_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasure_placements_handed_by_source_id_fkey' AND conrelid = 'experience_treasure_placements'::regclass) THEN
    ALTER TABLE experience_treasure_placements ADD CONSTRAINT experience_treasure_placements_handed_by_source_id_fkey FOREIGN KEY (handed_by_source_id) REFERENCES experience_sources(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_hand_overs_container_id_fkey' AND conrelid = 'experience_hand_overs'::regclass) THEN
    ALTER TABLE experience_hand_overs ADD CONSTRAINT experience_hand_overs_container_id_fkey FOREIGN KEY (container_id) REFERENCES experiences(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_hand_overs_decided_by_fkey' AND conrelid = 'experience_hand_overs'::regclass) THEN
    ALTER TABLE experience_hand_overs ADD CONSTRAINT experience_hand_overs_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_visit_trips_at_link_id_fkey' AND conrelid = 'user_visit_trips'::regclass) THEN
    ALTER TABLE user_visit_trips ADD CONSTRAINT user_visit_trips_at_link_id_fkey FOREIGN KEY (at_link_id) REFERENCES experience_treasures(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_admin_divisions_gadm_country ON administrative_divisions USING btree (gadm_country) WHERE ((parent_id IS NOT NULL) AND (gadm_country IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS curation_log_undone_once ON experience_curation_log USING btree (undoes_log_id) WHERE (undoes_log_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_curation_log_batch ON experience_curation_log USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experience_parts_order ON experience_parts USING btree (whole_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_experience_regions_asking ON experience_regions USING btree (region_id) WHERE (offered_region_ids IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sync_changes_record ON experience_sync_changes USING btree (record_id) WHERE (record_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_triggered_by ON experience_sync_logs USING btree (triggered_by) WHERE (triggered_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experience_treasures_decided_by ON experience_treasures USING btree (decided_by) WHERE (decided_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experience_treasures_left ON experience_treasures USING btree (experience_id) WHERE (NOT here_today);
CREATE INDEX IF NOT EXISTS idx_experience_treasures_refused_by ON experience_treasures USING btree (refused_by) WHERE (refused_by IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS experiences_boundary_view_once ON experiences USING btree (boundary_view_id) WHERE (boundary_view_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS experiences_path_view_once ON experiences USING btree (path_view_id) WHERE (path_view_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_access_decided_by ON experiences USING btree (access_decided_by) WHERE (access_decided_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_access ON experiences USING btree (access) WHERE ((access)::text <> 'open'::text);
CREATE INDEX IF NOT EXISTS idx_experiences_area_outline ON experiences USING gist (boundary) WHERE (((shape)::text = 'area'::text) AND (boundary IS NOT NULL) AND (merged_into_id IS NULL));
CREATE INDEX IF NOT EXISTS idx_experiences_class_item ON experiences USING btree (class_item) WHERE (class_item IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_created_by ON experiences USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_former ON experiences USING btree (id) WHERE ((source_membership)::text <> 'present'::text);
CREATE INDEX IF NOT EXISTS idx_experiences_path ON experiences USING gist (path) WHERE (path IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_pin ON experiences USING gist (pin) WHERE (pin IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_shape_pinned_by ON experiences USING btree (shape_pinned_by) WHERE (shape_pinned_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_experiences_shown_by_parts ON experiences USING btree (id) WHERE ((shape)::text = 'none'::text);
CREATE INDEX IF NOT EXISTS idx_place_periods_begins ON place_periods USING btree (from_first) WHERE (((says)::text = 'stood'::text) AND (NOT ended) AND (from_first IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_place_periods_closures ON place_periods USING btree (experience_id) WHERE ((says)::text = 'closed'::text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_periods_open_standing ON place_periods USING btree (experience_id, kind_id) NULLS NOT DISTINCT WHERE (((says)::text = 'stood'::text) AND (NOT ended));
CREATE UNIQUE INDEX IF NOT EXISTS place_periods_order ON place_periods USING btree (experience_id, kind_id, says, ordinal) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_record_periods_refused ON record_periods USING btree (record_id) WHERE (refused_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ris_source_url ON region_import_state USING btree (source_url) WHERE (source_url IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_regions_counts ON regions USING btree (world_view_id) WHERE counts;
CREATE INDEX IF NOT EXISTS idx_regions_name_trgm ON regions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_source_records_admission_decided_by ON source_records USING btree (admission_decided_by) WHERE (admission_decided_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_source_records_finds_decided_by ON source_records USING btree (visitor_finds_decided_by) WHERE (visitor_finds_decided_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_source_records_finds ON source_records USING btree (whole_id) WHERE ((visitor_finds)::text <> 'unknown'::text);
CREATE INDEX IF NOT EXISTS idx_source_records_refused_by ON source_records USING btree (refused_by) WHERE (refused_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_source_records_region ON source_records USING gin (reported_region_items) WHERE (reported_region_items IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_treasures_homeless ON treasures USING btree (id) WHERE ((candidate_venue_items <> '{}'::character varying[]) AND (shown_nowhere_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_treasures_kind_answered_by ON treasures USING btree (kind_answered_by) WHERE (kind_answered_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_treasures_shown_nowhere_by ON treasures USING btree (shown_nowhere_by) WHERE (shown_nowhere_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_treasures_versions ON treasures USING btree (version_of_item) WHERE (version_of_item IS NOT NULL);
CREATE INDEX IF NOT EXISTS user_visit_trips_at_link ON user_visit_trips USING btree (at_link_id) WHERE (at_link_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS users_deletion_due ON users USING btree (deletion_requested_at) WHERE (deletion_requested_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_world_views_ground_missing ON world_views USING btree (id) WHERE (ground_missing_count > 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_views_one_canon ON world_views USING btree (is_canon) WHERE is_canon;

COMMIT;
