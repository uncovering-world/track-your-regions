/**
 * The review queue's facets: what each chip would leave, counted over the
 * union of open questions under every filter but the chip's own (ADR-0051).
 *
 * Split from `reviewQueueKeys.ts`, which builds the union and the page, because
 * the counts are a subject of their own — five aggregates, the regions a chip
 * may name, and the JSON the endpoint returns them as — and they read the
 * union's CTEs (`searched`, `scoped`, `keys`) without deciding them. The
 * statement is still one: these are fragments `queryQueueKeys` splices into it.
 */

import type { QueueFacets } from '../../api/responses/reviewQueue.js';

/**
 * The filters as predicates over `scoped k`, bound by the keys module: each
 * facet counts under every one of them but its own.
 */
interface FacetFilters {
  source: string;
  kind: string;
  region: string;
  run: string;
}

/**
 * The regions a facet may name: the roots of the public world views plus
 * whatever region this curator is assigned — an assignment is what a
 * region-scoped curator's whole queue is about, so it is offered as a chip
 * even where it is not a root of anything public.
 *
 * Each root carries the world view it is a root *of*, because the name alone
 * does not identify it: the development catalogue offers two roots called
 * Europe, one in the Administrative world view and one in Wikivoyage Regions,
 * and a chip listing the bare name would ask a curator to pick between two
 * identical rows. The control shows the world view only where a name repeats
 * (Task 10), so this is a fact the chip needs, not a label it must print.
 */
export function regionRootsCte(userId: string): string {
  return `
, region_roots AS (
    SELECT r.id, r.name, w.name AS world_view FROM regions r
    JOIN world_views w ON w.id = r.world_view_id
    WHERE r.parent_region_id IS NULL AND w.is_public
    UNION
    SELECT r.id, r.name, w.name AS world_view FROM curator_assignments ca
    JOIN regions r ON r.id = ca.region_id
    JOIN world_views w ON w.id = r.world_view_id
    WHERE ca.user_id = ${userId} AND ca.scope_type = 'region'
  )`;
}

/** The five facet aggregates, each under every filter but its own. */
export function facetsSql(f: FacetFilters, userId: string): string {
  return `
, facet_kind AS (
    SELECT v.value, count(*)::int AS count
    FROM scoped k
    CROSS JOIN LATERAL unnest(CASE WHEN k.kind = 'waiting' THEN k.subs ELSE ARRAY[k.kind] END) AS v(value)
    WHERE ${f.source} AND ${f.region} AND ${f.run}
    GROUP BY v.value
  )
, facet_source AS (
    -- Every source, counted or not, which is facet_region's shape below and
    -- for the same reason: a chip states what picking it would leave, and a
    -- source whose count under the other chips is zero would otherwise drop out
    -- of the menu that a curator picked it in — leaving a filter they can see
    -- the effect of and cannot untick. Dimmed at 0 instead.
    SELECT cat.id, cat.name, COALESCE(counted.n, 0) AS count
    FROM experience_sources cat
    LEFT JOIN (
      SELECT k.source_id, count(*)::int AS n
      FROM scoped k
      WHERE ${f.kind} AND ${f.region} AND ${f.run}
      GROUP BY k.source_id
    ) counted ON counted.source_id = cat.id
  )
, facet_region AS (
    -- Counted through the root's own assignment row rather than by walking the
    -- tree: placement propagates a location's region to every ancestor
    -- (assignAncestors, step 3 of regionAssignmentService.ts, denormalised
    -- into experience_regions by step 4), so a placed object carries a row for
    -- its root and the count is a join. That is a dependency on the placement
    -- writer, and it is confined to this count: the region *filter* walks
    -- region_subtree itself, so what a curator filters by does not rest on
    -- the propagation having run. Walking here instead cost 330 ms — see the
    -- note at the top of reviewQueueKeys.ts.
    SELECT rr.id, rr.name, rr.world_view, COALESCE(counted.n, 0) AS count
    FROM region_roots rr
    LEFT JOIN (
      SELECT er.region_id AS root_id, count(*)::int AS n
      FROM scoped k
      JOIN experience_regions er ON er.experience_id = k.id
      JOIN region_roots roots ON roots.id = er.region_id
      WHERE ${f.source} AND ${f.kind} AND ${f.run}
      GROUP BY er.region_id
    ) counted ON counted.root_id = rr.id
    UNION ALL
    SELECT NULL, 'Unplaced', NULL, count(*)::int
    FROM scoped k
    WHERE ${f.source} AND ${f.kind} AND ${f.run}
      AND NOT EXISTS (SELECT 1 FROM experience_regions er WHERE er.experience_id = k.id)
  )
, facet_run AS (
    -- Over searched rather than scoped: a run this curator set aside is the
    -- one chip that must still be listed, with its count, or the batch has no
    -- way back. The flag is read from the table for the same reason — scoped
    -- has already dropped those rows, so anything computed from it would say
    -- false about every run in the default view.
    SELECT k.run_id AS id, l.source_id AS source_id, l.completed_at,
           count(*)::int AS count,
           EXISTS (SELECT 1 FROM curator_queue_set_aside sa
                    WHERE sa.user_id = ${userId} AND sa.sync_log_id = k.run_id) AS set_aside
    FROM searched k
    JOIN experience_sync_logs l ON l.id = k.run_id
    WHERE ${f.source} AND ${f.kind} AND ${f.region}
    GROUP BY k.run_id, l.source_id, l.completed_at
  )
, aside_counts AS (
    -- Batches, and only batches: the unit a curator set aside is the run
    -- (ADR-0051 decision 4), and it is what the chip names. A count of the rows
    -- behind them was returned beside it and read by nobody.
    SELECT count(DISTINCT k.run_id)::int AS batches
    FROM keys k
    WHERE EXISTS (SELECT 1 FROM curator_queue_set_aside sa
                   WHERE sa.user_id = ${userId} AND sa.sync_log_id = k.run_id)
  )`;
}

/** The five facets as the endpoint returns them, one JSON object. */
export const FACETS_JSON_SQL = `json_build_object(
  'kind', (SELECT COALESCE(json_agg(json_build_object('kind', x.value, 'count', x.count)
                                    ORDER BY x.count DESC, x.value), '[]'::json) FROM facet_kind x),
  'source', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name, 'count', x.count)
                                      ORDER BY x.count DESC, x.name), '[]'::json) FROM facet_source x),
  'region', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name,
                                                       'worldView', x.world_view, 'count', x.count)
                                      ORDER BY x.count DESC, x.name), '[]'::json) FROM facet_region x),
  'run', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'sourceId', x.source_id,
                                                     'completedAt', x.completed_at,
                                                     'count', x.count, 'setAside', x.set_aside)
                                   ORDER BY x.completed_at DESC NULLS LAST), '[]'::json) FROM facet_run x),
  'setAside', (SELECT json_build_object('batches', x.batches) FROM aside_counts x)
)`;

/** What a statement that returned no facets row answers. */
export const EMPTY_FACETS: QueueFacets = {
  kind: [], source: [], region: [], run: [], setAside: { batches: 0 },
};
