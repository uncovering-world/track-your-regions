/**
 * The health check, mounted at the root (ADR-0071): public, and never kept,
 * since its point is the answer now.
 */

import { defineRoute } from '../api/route.js';
import { HealthStatus } from '../api/responses/health.js';
import { getHealth } from '../controllers/healthController.js';

export const healthRoutes = [
  defineRoute({
    method: 'get', path: '/health', access: 'public', cache: 'no-store',
    summary: 'Report whether the server is up and its database answering, or 503 if not',
    response: HealthStatus,
    handler: getHealth,
  }),
];

