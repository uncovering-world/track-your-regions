/**
 * The answered neighbours of an arrival in its kind (#2185): one place of the
 * same kind and type a curator kept, and one a curator turned away, so a
 * curator deciding whether the Dormition Cathedral is a tower sees what the
 * catalogue already holds as one and what it refused.
 *
 * Each exported schema is the type of the same name in the web's generated
 * client, and the handler's body is held to it by `respond()`.
 *
 * A module of this directory imports only `zod/v4`, the generated row types,
 * vocabulary constants, the schemas of the other modules here, and the pure
 * helpers beside `respond()` in `backend/src/api/`.
 */

import { z } from 'zod/v4';
import { ImageCredit } from './experiences.js';

const KindNeighbour = z.strictObject({
  placeId: z.number().int(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  imageCredit: ImageCredit.nullable(),
});

export const KindNeighbours = z.strictObject({
  kept: KindNeighbour.nullable().describe(
    'The place of the same kind and type a curator kept most recently, readers offered it; null where none is.',
  ),
  refused: KindNeighbour.extend({
    reason: z.string().nullable().describe(
      'Why the place is out of the kind, as the membership records it: a curator\'s "kept out by a curator", or the '
      + 'rule\'s own reason a curator upheld, which may be about the place\'s fame or state rather than its kind.',
    ),
  }).nullable().describe(
    'The place of the same kind and type a curator turned away from the kind most recently, one the caller may be shown; '
    + 'null where none is.',
  ),
}).describe("An arrival's answered neighbours in its kind and type, one kept and one refused (#2185).");
export type KindNeighbours = z.infer<typeof KindNeighbours>;
