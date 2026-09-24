/**
 * What the health check answers (ADR-0066): `GET /health`, which the test
 * stack's readiness probe (`scripts/test-stack.sh`) and `scripts/frontend-mode.sh`
 * read, and which no client module calls.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const HealthStatus = z.strictObject({
  status: z.literal('ok'),
  database: z.literal('connected'),
  timestamp: z.string().describe('When the check ran, as an ISO 8601 date.'),
}).describe('The server up, and its database answering.');
export type HealthStatus = z.infer<typeof HealthStatus>;
