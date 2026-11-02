/**
 * A curator asks the full OpenStreetMap for a rough point's namesakes, from
 * the approximate-point card (#2243).
 *
 * POST /api/experiences/:id/point-namesakes/:locationId
 *
 * The site is the scope, as for every answer on the card (`componentItemsScope`),
 * and the point must be one of its open rough points. The question goes to the
 * public Overpass instances under their manners, one curator's question at a
 * time (`pointNamesakes.ts`), so the route carries the limiter the card's other
 * live reads do. A point asked already with its name and coordinate is not
 * asked again.
 */

import type { z } from 'zod/v4';
import type { PointNamesakesAnswer } from '../../api/responses/curation.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { askPointNamesakes } from '../../services/sync/pointNamesakes.js';
import type { pointNamesakesParamsSchema } from '../../types/index.js';
import { componentItemsScope } from './componentItemController.js';

export async function askNamesakes(
  { params: { id, locationId }, caller }: { params: z.output<typeof pointNamesakesParamsSchema>; caller: Express.User },
): Promise<PointNamesakesAnswer> {
  const { permitted, found } = await componentItemsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const answer = await askPointNamesakes(id, locationId, caller.id);
  if (!answer) throw notFound('No open roughly placed point of this place has that id');
  return { locationId, ...answer };
}
