/**
 * Every relation's tier (ADR-0124, #1694).
 *
 * - `serving` — what readers and curators read and write, and what the
 *   catalogue's admin screens keep about them. A deployment of the product
 *   carries these. A table a reader or curator route reads is serving,
 *   whatever made it: the region tree reads an imported region's source
 *   (`region_import_state`), the editor the import's open suggestions
 *   (`region_match_suggestions`), and a world view's page the state of its
 *   geometry computation (`geometry_computations`).
 * - `workbench` — what is built from public dumps, imported, cached or kept as
 *   intermediate work, which no reader or curator route reads. It lives in the
 *   `workbench` schema, which a deployment of the serving tables leaves behind.
 *
 * The record is typed against the generated schema, so a table added to the
 * schema without a tier, or a tier for a table that is gone, fails the
 * typecheck. `tableTiers.test.ts` holds each tier to the schema it sits in.
 */

import type { RELATION_SCHEMAS } from './schema.generated.js';

export type Tier = 'serving' | 'workbench';
export type RelationName = keyof typeof RELATION_SCHEMAS;

export const TABLE_TIERS: Record<RelationName, Tier> = {
  administrative_divisions: 'serving',
  ai_learned_rules: 'workbench',
  ai_settings: 'workbench',
  ai_usage_log: 'workbench',
  coverage_expectation_kinds: 'workbench',
  coverage_expectations: 'workbench',
  coverage_judgements: 'workbench',
  coverage_kinds: 'workbench',
  coverage_regions: 'workbench',
  curator_assignments: 'serving',
  curator_queue_set_aside: 'serving',
  data_assertion_acceptances: 'serving',
  dump_builds: 'workbench',
  email_verification_tokens: 'serving',
  enwiki_categories: 'workbench',
  enwiki_category_links: 'workbench',
  enwiki_page_items: 'workbench',
  enwiki_pages: 'workbench',
  enwiki_structure_builds: 'workbench',
  experience_component_item_proposals: 'serving',
  experience_component_item_suggestions: 'serving',
  experience_conflict_decisions: 'serving',
  experience_curation_log: 'serving',
  experience_hand_overs: 'serving',
  experience_held_decisions: 'serving',
  experience_kind_memberships: 'serving',
  experience_kinds: 'serving',
  experience_location_placements: 'serving',
  experience_location_regions: 'serving',
  experience_locations: 'serving',
  experience_merge_proposals: 'serving',
  experience_merge_suggestions: 'serving',
  experience_merges: 'serving',
  experience_parts: 'serving',
  experience_regions: 'serving',
  experience_rejections: 'serving',
  experience_sources: 'serving',
  experience_sync_changes: 'serving',
  experience_sync_logs: 'serving',
  experience_treasure_placements: 'serving',
  experience_treasures: 'serving',
  experience_view_choices: 'serving',
  experience_view_suggestions: 'serving',
  experiences: 'serving',
  geometry_computations: 'serving',
  import_runs: 'workbench',
  readership_month_files: 'workbench',
  readership_months: 'workbench',
  readership_staging: 'workbench',
  refresh_tokens: 'serving',
  region_geom_pieces: 'serving',
  region_image_overlays: 'serving',
  region_import_state: 'serving',
  region_map_images: 'workbench',
  region_match_suggestions: 'serving',
  region_member_effective_geom: 'serving',
  region_member_group_assignments: 'serving',
  region_members: 'serving',
  region_render_geom: 'serving',
  region_subdivision_groups: 'serving',
  regions: 'serving',
  schema_migrations: 'serving',
  treasures: 'serving',
  user_auth_providers: 'serving',
  user_new_badge_views: 'serving',
  user_viewed_treasures: 'serving',
  user_visited_experiences: 'serving',
  user_visited_locations: 'serving',
  user_visited_regions: 'serving',
  users: 'serving',
  wikidata_cache_policy: 'workbench',
  wikidata_claims: 'workbench',
  wikidata_class_closure: 'workbench',
  wikidata_entities: 'workbench',
  wikidata_geoshapes: 'workbench',
  wikidata_labels: 'workbench',
  wikidata_query_cache: 'workbench',
  wikidata_sitelinks: 'workbench',
  wikidata_subset_builds: 'workbench',
  wikipedia_redirect_builds: 'workbench',
  wikipedia_redirects: 'workbench',
  world_views: 'serving',
};

/**
 * Workbench tables that still sit in `public`, each with what holds it there.
 * The list only shrinks: a new workbench table is made in the workbench schema.
 */
export const WORKBENCH_IN_PUBLIC: Partial<Record<RelationName, string>> = {
  ai_learned_rules: 'the world-view import\'s AI extraction, moved with the import state',
  ai_settings: 'the world-view import\'s AI extraction, moved with the import state',
  ai_usage_log: 'the world-view import\'s AI extraction, moved with the import state',
  coverage_expectation_kinds: 'the catalogue-coverage survey, loaded by scripts/catalogue-coverage.sh',
  coverage_expectations: 'the catalogue-coverage survey, loaded by scripts/catalogue-coverage.sh',
  coverage_judgements: 'the catalogue-coverage survey, loaded by scripts/catalogue-coverage.sh',
  coverage_kinds: 'the catalogue-coverage survey; references experience_kinds',
  coverage_regions: 'the catalogue-coverage survey, loaded by scripts/catalogue-coverage.sh',
  import_runs: 'the world-view import\'s state; references world_views',
  region_map_images: 'the world-view import\'s state; references regions',
  wikidata_cache_policy: 'a live cache of Wikidata answers; references experience_sources',
  wikidata_geoshapes: 'a live cache of Wikidata geoshapes, read by the world-view import',
  wikidata_query_cache: 'a live cache of Wikidata answers; references experience_sources',
};
