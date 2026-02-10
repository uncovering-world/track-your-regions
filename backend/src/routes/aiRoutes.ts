/**
 * AI Routes for region grouping suggestions
 */

import { Router } from 'express';
import {
  checkAIStatus,
  suggestGroup,
  suggestGroupsBatch,
  generateDescriptions,
  getModels,
  setCurrentModel,
  setCurrentWebSearchModel,
} from '../controllers/aiController.js';
import { validate } from '../middleware/errorHandler.js';
import {
  setModelBodySchema,
  suggestGroupBodySchema,
  suggestGroupsBatchBodySchema,
  generateDescriptionsBodySchema,
} from '../types/index.js';

const router = Router();

// Check if AI features are available
router.get('/status', checkAIStatus);

// Model management
router.get('/models', getModels);
router.post('/models', validate(setModelBodySchema), setCurrentModel);
router.post('/models/web-search', validate(setModelBodySchema), setCurrentWebSearchModel);

// Suggest group for a single region
router.post('/suggest-group', validate(suggestGroupBodySchema), suggestGroup);

// Suggest groups for multiple regions (batch)
router.post('/suggest-groups-batch', validate(suggestGroupsBatchBodySchema), suggestGroupsBatch);

// Generate group descriptions
router.post('/generate-group-descriptions', validate(generateDescriptionsBodySchema), generateDescriptions);

export default router;
