/**
 * Builds the two statements a region read needs.
 *
 * Its own file because the read has accumulated one conditional per feature —
 * curator scope, descendant rejections, the lifecycle filter, the reader's id
 * for the "New" chip — and it was the branching that grew rather than the work.
 * Leaving it inline pushed the controller past the 500-line guideline and its
 * handler past the complexity one; neither number is the point, but both were
 * measuring the same thing.
 */

import { hideLostSql, lifecycleSelectSql, offeredLocationSql } from './experienceLifecycle.js';
import { isNewSql } from './experienceNewBadge.js';

/**
 * The two statements a region read needs, and their parameters.
 *
 * Extracted because the handler had accumulated one conditional per feature —
 * curator scope, descendant rejections, the lifecycle filter, the reader's id —
 * and the branching was the part that grew, not the work.
 *
 * Both branches bind `regionId, limit, offset` in that order, and the reader's
 * id fourth when there is one; the `is_new` fragment is written against `$4`
 * for that reason.
 */
export function buildRegionQueries(opts: {
  regionId: number;
  includeChildren: boolean;
  showRejected: boolean;
  includeLostRows: boolean;
  limit: number;
  offset: number;
  userId?: number;
}): { query: string; countQuery: string; params: (number | string)[] } {
  const { regionId, includeChildren, showRejected, includeLostRows, limit, offset, userId } = opts;

  // Rejection fields: include for curators, filter for others
  // For includeChildren, check rejections against all descendant regions (not just $1)
  const simpleRejectionJoin = `LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = $1`;
  const descendantRejectionJoin = `LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id IN (SELECT id FROM descendant_regions)`;
  const rejectionFilter = showRejected ? '' : ' AND rej.id IS NULL';
  // `former` is deliberately absent here: it stays in the list, and the card
  // labels it from the columns selected above.
  const lifecycleFilter = includeLostRows ? '' : ` AND ${hideLostSql()}`;
  // The same rule as an expression, for the count: one aggregate answers how
  // many the list is showing and another how many it is holding back, so the
  // page can offer the toggle only where there is something behind it.
  const lifecyclePredicate = includeLostRows ? 'TRUE' : hideLostSql();
  // The chip's personal half needs to know who is asking. Anonymous readers
  // bind nothing and fall back to the category window, which is the whole rule
  // for them — there is nobody to have shown it to. Both branches bind
  // regionId, limit and offset in that order, so the reader lands on $4.
  const readerParam = userId ? '$4' : 'NULL';

  // Identical in both branches, so computed once: only the statements differ.
  // The order is what `isNewSql`'s `$4` is written against.
  const params: (number | string)[] = userId
    ? [regionId, limit, offset, userId]
    : [regionId, limit, offset];

  let query: string;
  let countQuery: string;

  if (includeChildren) {
    const rejectionSelect = showRejected
      ? `, bool_or(rej.id IS NOT NULL) as is_rejected, MAX(rej.reason) as rejection_reason`
      : '';
    query = `
      WITH RECURSIVE descendant_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendant_regions dr ON r.parent_region_id = dr.id
      )
      SELECT
        e.id,
        e.external_id,
        e.name,
        e.short_description,
        e.category,
        e.country_codes,
        e.country_names,
        e.image_url,
        e.created_at,
        ST_X(e.location) as longitude,
        ST_Y(e.location) as latitude,
        e.metadata->>'inDanger' as in_danger,
        (SELECT COUNT(*)::int FROM experience_locations el
           WHERE el.experience_id = e.id AND ${offeredLocationSql()}) as location_count,
        s.name as category_name,
        s.display_priority as category_priority,
        ${lifecycleSelectSql()},
        ${isNewSql('e', readerParam)} AS is_new
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
      ${descendantRejectionJoin}
      WHERE er.region_id IN (SELECT id FROM descendant_regions)
      ${rejectionFilter}
      ${lifecycleFilter}
      GROUP BY e.id, s.name, s.display_priority
      ORDER BY e.name
      LIMIT $2 OFFSET $3
    `;
    countQuery = `
      WITH RECURSIVE descendant_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendant_regions dr ON r.parent_region_id = dr.id
      )
      SELECT
        COUNT(DISTINCT e.id) FILTER (WHERE ${lifecyclePredicate})::int AS total,
        COUNT(DISTINCT e.id) FILTER (WHERE e.existence = 'lost')::int AS lost_hidden
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
      ${descendantRejectionJoin}
      WHERE er.region_id IN (SELECT id FROM descendant_regions)
      ${rejectionFilter}
    `;
  } else {
    const rejectionSelect = showRejected
      ? `, rej.id IS NOT NULL as is_rejected, rej.reason as rejection_reason`
      : '';
    query = `
      SELECT
        e.id,
        e.external_id,
        e.name,
        e.short_description,
        e.category,
        e.country_codes,
        e.country_names,
        e.image_url,
        e.created_at,
        ST_X(e.location) as longitude,
        ST_Y(e.location) as latitude,
        e.metadata->>'inDanger' as in_danger,
        (SELECT COUNT(*)::int FROM experience_locations el
           WHERE el.experience_id = e.id AND ${offeredLocationSql()}) as location_count,
        s.name as category_name,
        s.display_priority as category_priority,
        ${lifecycleSelectSql()},
        ${isNewSql('e', readerParam)} AS is_new
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
      ${simpleRejectionJoin}
      WHERE er.region_id = $1
      ${rejectionFilter}
      ${lifecycleFilter}
      ORDER BY e.name
      LIMIT $2 OFFSET $3
    `;
    countQuery = `
      SELECT
        COUNT(DISTINCT e.id) FILTER (WHERE ${lifecyclePredicate})::int AS total,
        COUNT(DISTINCT e.id) FILTER (WHERE e.existence = 'lost')::int AS lost_hidden
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
      ${simpleRejectionJoin}
      WHERE er.region_id = $1
      ${rejectionFilter}
    `;
  }


  return { query, countQuery, params };
}
