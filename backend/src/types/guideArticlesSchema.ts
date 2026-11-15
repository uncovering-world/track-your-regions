/**
 * `/review/guide-articles/:membershipId` (#2520): the membership whose item
 * the Wikivoyage articles behind a guide's yes are read for.
 */

import { z } from 'zod/v4';
import { rowIdSchema } from './rowId.js';

export const guideArticlesParamSchema = z.object({
  membershipId: rowIdSchema,
});
