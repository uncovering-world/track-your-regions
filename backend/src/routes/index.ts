import { Router } from 'express';
import { routerOf } from '../api/route.js';
import { initOpenAI } from '../services/ai/openaiService.js';
import { MOUNTS } from './mounts.js';

// Initialize OpenAI on module load
initOpenAI();

const router = Router();

// Every route is declared, access and all, and mounted from the one list the
// OpenAPI document is built from (ADR-0071).
for (const { prefix, routes } of MOUNTS) {
  router.use(prefix, routerOf(routes));
}

export default router;
