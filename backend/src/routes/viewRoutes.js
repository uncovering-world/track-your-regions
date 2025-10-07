const express = require('express');
const {
  check, query, body, validationResult,
} = require('express-validator');
const viewController = require('../controllers/viewController');
const { getDataTypeRange } = require('../utils/dataTypes');
const { View, Hierarchy } = require('../models');

const router = express.Router();

// Get all views
router.get(
  '/',
  [
    query('hierarchyId').optional().isInt(
      { min: 0, max: getDataTypeRange(Hierarchy, 'hierarchyId').max },
    ).withMessage('Hierarchy ID must be a valid non-negative integer'),
    query('includeInactive').optional().isBoolean().withMessage('includeInactive must be a boolean'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.getViews(req, res);
  },
);

// Get a specific view by ID
router.get(
  '/:viewId',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.getViewById(req, res);
  },
);

// Get all regions in a view
router.get(
  '/:viewId/regions',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.getViewRegions(req, res);
  },
);

// Create a new view
router.post(
  '/',
  [
    body('name').isString().notEmpty().withMessage('Name is required and must be a string'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('hierarchyId').isInt(
      { min: 0, max: getDataTypeRange(Hierarchy, 'hierarchyId').max },
    ).withMessage('Hierarchy ID must be a valid non-negative integer'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.createView(req, res);
  },
);

// Update a view
router.put(
  '/:viewId',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
    body('name').optional().isString().notEmpty()
      .withMessage('Name must be a non-empty string'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.updateView(req, res);
  },
);

// Delete a view
router.delete(
  '/:viewId',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.deleteView(req, res);
  },
);

// Add regions to a view
router.post(
  '/:viewId/regions',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
    body('regions').isArray({ min: 1 }).withMessage('Regions must be a non-empty array'),
    body('regions.*.regionId').isInt().withMessage('Region ID must be an integer'),
    body('regions.*.hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.addRegionsToView(req, res);
  },
);

// Remove regions from a view
router.delete(
  '/:viewId/regions',
  [
    check('viewId').isInt(
      { min: 0, max: getDataTypeRange(View, 'id').max },
    ).withMessage('View ID must be a valid non-negative integer'),
    body('regions').isArray({ min: 1 }).withMessage('Regions must be a non-empty array'),
    body('regions.*.regionId').isInt().withMessage('Region ID must be an integer'),
    body('regions.*.hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return viewController.removeRegionsFromView(req, res);
  },
);

module.exports = router;
