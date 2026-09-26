/**
 * The health check: GET /health, which the test stack's readiness probe
 * (`scripts/test-stack.sh`) and `scripts/frontend-mode.sh` read by its status.
 */

import type { HealthStatus } from '../api/responses/health.js';
import { pool } from '../db/index.js';
import { Refusal } from '../middleware/errorHandler.js';

/**
 * The server up and its database answering, or a 503 whose body says which:
 * the same fields as the answer, with `database: 'disconnected'`, beside the
 * sentence every refusal carries.
 */
export async function getHealth(): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new Refusal(503, {
      error: 'The database is not answering',
      status: 'error',
      database: 'disconnected',
      timestamp,
    });
  }
  return { status: 'ok', database: 'connected', timestamp };
}
