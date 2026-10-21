/**
 * Jev's reading of what a visitor finds at a place arriving for a curator
 * (#1768, ADR-0087, ADR-0128).
 * POST /api/experiences/:id/visit-suggestion
 *
 * For a place a gated source is bringing in, the stored reading where one
 * was made for the place as it stands, or a new one: Jev is asked one
 * `choice` over six readings (`visitReading.ts`) — something to see, a part
 * of a larger place, an object kept elsewhere, nothing left, not one place,
 * or a place visited for something its kinds do not offer — and the answer
 * is stored with its confidence and the place it was about
 * (`services/sync/visit/visitSuggestions.ts`). A deployment without Jev answers that it has none.
 * The reading is shown beside the arrival and never applied: a curator
 * decides. A POST because a call may be made, and paid for.
 *
 * Asked in the scope of an arriving membership's source, not of every source
 * the place holds: the question is about the arrival, so a curator who holds
 * Archaeology alone is answered about the Capitoline Museums' Archaeology
 * arrival though the place is also an art museum.
 *
 * What Jev is sent is the catalogue's: the place's name, countries and kinds,
 * the map's tag, and the lead of its English Wikipedia article, read from
 * Wikipedia for the question. Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { VisitSuggestion as VisitSuggestionResponse } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { jevConfigured } from '../../services/jev/jevClient.js';
import type { VisitAsked, VisitReading } from '../../services/sync/visit/visitReading.js';
import type { idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { arrivalOpenSql } from './reviewQueuePredicates.js';
import { readVisit } from '../../services/sync/visit/readVisit.js';
import { askedSql, newestReadingSql } from '../../services/sync/visit/visitSuggestions.js';

interface PlaceRow {
  asked: VisitAsked;
  /** The sources of the place's open arrivals; none where it is not arriving. */
  arrivingSourceIds: number[];
  stored: { reading: VisitReading | null; confidence: number } | null;
}

async function placeOf(experienceId: number): Promise<PlaceRow | null> {
  const result = await pool.query<{
    asked: VisitAsked; arriving_source_ids: number[] | null;
    stored: PlaceRow['stored'];
  }>(
    `SELECT ${askedSql('e')} AS asked,
            (SELECT array_agg(DISTINCT m.source_id ORDER BY m.source_id) FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id AND ${arrivalOpenSql('e', 'm')}) AS arriving_source_ids,
            ${newestReadingSql('e')} AS stored
       FROM experiences e WHERE e.id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? { asked: row.asked, arrivingSourceIds: row.arriving_source_ids ?? [], stored: row.stored } : null;
}

/** The place is still arriving, under the lock: what a reading is shown for here. */
const STILL_ARRIVING = (e: string) => `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m
                                         WHERE m.experience_id = ${e}.id AND ${arrivalOpenSql(e, 'm')})`;

export async function suggestVisit(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<VisitSuggestionResponse> {
  const place = await placeOf(id);
  if (!place) throw notFound('Experience not found');
  // Asked only of a place arriving for a curator: a call is paid for, and a
  // place already offered or refused is no question on any card.
  if (place.arrivingSourceIds.length === 0) {
    return { configured: jevConfigured(), suggestion: null };
  }
  const scopes = await Promise.all(
    place.arrivingSourceIds.map(sourceId => resolveExperienceScope(caller.id, caller.role, id, sourceId)),
  );
  if (!scopes.some(scope => scope.permitted)) {
    throw createError('You do not have curator permissions for this experience', 403);
  }
  if (!jevConfigured()) return { configured: false, suggestion: null };
  // Asked already for the place as it stands: Jev's reading, or none where its
  // answer was refused — either way not asked, nor paid for, again.
  if (place.stored) {
    return {
      configured: true,
      suggestion: place.stored.reading === null ? null
        : { reading: place.stored.reading, confidence: Number(place.stored.confidence) },
    };
  }
  return { configured: true, suggestion: await readVisit(id, place.asked, STILL_ARRIVING) };
}
