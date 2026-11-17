/**
 * `/review/kind-rule/:kindId` (#2185): the kind whose rule an arrival's card
 * shows behind ⓘ.
 */

import { z } from 'zod/v4';
import { rowIdSchema } from './rowId.js';

export const kindRuleParamSchema = z.object({
  kindId: rowIdSchema,
});
