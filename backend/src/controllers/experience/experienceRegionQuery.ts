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

import {
  hideLostSql,
  hideRefusedSql,
  hidePendingSql,
  lifecycleSelectSql,
  offeredLocationSql,
  publishedContentSql,
  readerPositionSql,
} from './experienceLifecycle.js';
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
  //
  // A refusal has no toggle and never gets one. `includeLostRows` exists so a
  // reader can ask to see what no longer exists; a row this category's rule
  // turned down is not something the reader is missing, it is something that
  // should never have been offered (ADR-0024). The curation queue reads it
  // through its own query.
  //
  // `hidePendingSql` has no toggle either, and for a different reason than
  // refusal's: a region list is a *set*, and the curator relaxation
  // (ADR-0025) stops at the three by-id reads precisely so a curator's set
  // matches a reader's — see `maySeeUnreadExperience`.
  const lifecycleFilter = ` AND ${hideRefusedSql()}`
    + (includeLostRows ? '' : ` AND ${hideLostSql()}`)
    + ` AND ${hidePendingSql()}`;
  // The same rule as an expression, for the count: one aggregate answers how
  // many the list is showing and another how many it is holding back, so the
  // page can offer the toggle only where there is something behind it.
  const lifecyclePredicate = (includeLostRows
    ? hideRefusedSql()
    : `${hideRefusedSql()} AND ${hideLostSql()}`)
    + ` AND ${hidePendingSql()}`;
  // Refused rows are excluded here too. This number is an offer to reveal, and
  // revealing would not bring back a row the other predicate still hides.
  // Pending rows are excluded for the same reason: showing lost rows again
  // would not un-hide one that is also unread, so it must not be counted as
  // something the toggle would reveal.
  const lostHiddenPredicate = `e.existence = 'lost' AND ${hideRefusedSql()} AND ${hidePendingSql()}`;
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
      ${readerPositionSql('e')},
        e.metadata->>'inDanger' as in_danger,
        -- Unconditional, and with no curator relaxation, unlike the count of
        -- an experience in this same read: this is a per-object number a
        -- region-wide list shows every caller the same way. It can disagree
        -- with what a curator sees on GET /:id/locations for the same
        -- experience -- that read widens for a curator whose scope reaches
        -- it (ADR-0025), this count never does -- and that disagreement is
        -- deliberate, not a bug to close: this number answers what the
        -- catalogue offers, the by-id read answers what one caller may see.
        (SELECT COUNT(*)::int FROM experience_locations el
           WHERE el.experience_id = e.id AND ${offeredLocationSql()}
             AND ${publishedContentSql('el')}) as location_count,
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
        COUNT(DISTINCT e.id) FILTER (WHERE ${lostHiddenPredicate})::int AS lost_hidden
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
      ${readerPositionSql('e')},
        e.metadata->>'inDanger' as in_danger,
        -- Unconditional, and with no curator relaxation, unlike the count of
        -- an experience in this same read: this is a per-object number a
        -- region-wide list shows every caller the same way. It can disagree
        -- with what a curator sees on GET /:id/locations for the same
        -- experience -- that read widens for a curator whose scope reaches
        -- it (ADR-0025), this count never does -- and that disagreement is
        -- deliberate, not a bug to close: this number answers what the
        -- catalogue offers, the by-id read answers what one caller may see.
        (SELECT COUNT(*)::int FROM experience_locations el
           WHERE el.experience_id = e.id AND ${offeredLocationSql()}
             AND ${publishedContentSql('el')}) as location_count,
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
        COUNT(DISTINCT e.id) FILTER (WHERE ${lostHiddenPredicate})::int AS lost_hidden
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
