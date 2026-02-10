import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import {
  getViews,
  getViewById,
  createView,
  updateView,
  deleteView,
  getViewDivisions,
  addDivisionsToView,
  removeDivisionsFromView,
} from '../controllers/viewController.js';
import {
  createViewSchema,
  updateViewSchema,
  addDivisionsToViewSchema,
  removeDivisionsFromViewSchema,
} from '../types/index.js';

const router = Router();

// View CRUD
router.get('/', getViews);
router.post('/', validate(createViewSchema), createView);
router.get('/:viewId', getViewById);
router.put('/:viewId', validate(updateViewSchema), updateView);
router.delete('/:viewId', deleteView);

// View divisions management
router.get('/:viewId/regions', getViewDivisions);  // Legacy path
router.get('/:viewId/divisions', getViewDivisions);  // New path
router.post('/:viewId/regions', validate(addDivisionsToViewSchema), addDivisionsToView);  // Legacy
router.post('/:viewId/divisions', validate(addDivisionsToViewSchema), addDivisionsToView);
router.delete('/:viewId/regions', validate(removeDivisionsFromViewSchema), removeDivisionsFromView);  // Legacy
router.delete('/:viewId/divisions', validate(removeDivisionsFromViewSchema), removeDivisionsFromView);

export default router;
