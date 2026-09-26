/**
 * The health check, mounted at the root (ADR-0071): public, and never kept,
 * since its point is the answer now.
 */

import { defineRoute, routerOf } from '../api/route.js';
import { HealthStatus } from '../api/responses/health.js';
import { getHealth } from '../controllers/healthController.js';

export const healthRoutes = [
  defineRoute({
    method: 'get', path: '/health', access: 'public', cache: 'no-store',
    response: HealthStatus,
    handler: getHealth,
  }),
];

export default routerOf(healthRoutes);
