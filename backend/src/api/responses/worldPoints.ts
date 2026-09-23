/**
 * What the world points client's call answers (ADR-0066): the success body of
 * `GET /api/experiences/points`, which `frontend/src/api/worldPoints.ts` calls,
 * declared once.
 *
 * The exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { POINTS_DETAILS } from '../../controllers/experience/worldPointsVocabulary.js';

export const PointsDetail = z.enum(POINTS_DETAILS)
  .describe('The tier asked for: `overview` is the heatmap\'s read, `markers` the pins\'.');
export type PointsDetail = z.infer<typeof PointsDetail>;

export const WorldPointsResponse = z.strictObject({
  detail: PointsDetail,
  folded: z.boolean().describe('Echoed rather than assumed, so a layer cannot draw one fold with the other\'s data.'),
  count: z.number().int(),
  truncated: z.literal(true).optional().describe(
    'Present only when the read hit its cap. A density picture built from a subset is wrong rather than incomplete,'
    + ' so this is never silent.',
  ),
  lng: z.array(z.number()),
  lat: z.array(z.number()),
  locationId: z.array(z.number().int()).optional().describe("Markers only: the pin's identity, for hover and for opening a card."),
  experienceId: z.array(z.number().int()).optional(),
  name: z.array(z.string().nullable()).optional(),
  experienceName: z.array(z.string()).optional(),
  kindId: z.array(z.number().int().nullable()).optional()
    .describe('Markers only: what the pin is coloured by (`kindColors.ts` owns the palette).'),
  type: z.array(z.string().nullable()).optional(),
  locationCount: z.array(z.number().int()).optional()
    .describe("Folded only: how many places the pin stands for, which is the badge's number."),
}).describe('The map\'s points, one array per field, all of them the same length.');
export type WorldPointsResponse = z.infer<typeof WorldPointsResponse>;
