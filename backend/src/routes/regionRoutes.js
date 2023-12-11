const express = require('express');
const { check, query, validationResult } = require('express-validator');
const regionController = require('../controllers/regionController');

const router = express.Router();

/**
 * @route GET /api/regions/hierarchies
 * @desc Fetch all hierarchies.
 * @access Public
 */
router.get(
  '/hierarchies',
  async (req, res) => {
    await regionController.getHierarchies(req, res);
  },
);
/**
 * @route GET /api/regions/root
 * @desc Fetch the root regions for a given hierarchy.
 * @access Public
 * @param {number} [hierarchyId] - The ID of the hierarchy to fetch root regions for (optional).
 * @returns {Response} The response object containing root regions data or an error message.
 */
router.get(
  '/root',
  ...[
    check('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return regionController.getRootRegions(req, res);
  },
);
/**
 * @route GET /api/regions/:regionId
 * @desc Fetch details for a specific region.
 * @access Public
 * @param {number} regionId - The ID of the region to fetch details for.
 * @param {number} [hierarchyId] - The ID of the hierarchy the region belongs to (optional).
 * @returns {Response} The response object containing region details or an error message.
 */
router.get(
  '/:regionId',
  ...[
    check('regionId').isInt().withMessage('Region ID must be an integer'),
    check('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return regionController.getRegionById(req, res);
  },
);
/**
 * @route GET /api/regions/:regionId/subregions
 * @desc Fetch the subregions for a region.
 * @access Public
 * @param {number} regionId - The ID of the region to fetch subregions for.
 * @param {boolean} [getAll] - Flag to get all subregions or just direct subregions (optional).
 * @param {number} [hierarchyId] - The ID of the hierarchy the region belongs to (optional).
 * @returns {Response} The response object containing subregions data or an error message.
 */
router.get(
  '/:regionId/subregions',
  ...[
    check('regionId').isInt().withMessage('Region ID must be an integer'),
    query('getAll').optional().isBoolean().withMessage('getAll must be a boolean'),
    query('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return regionController.getSubregions(req, res);
  },
);

/**
 * @route GET /api/regions/:regionId/ancestors
 * @desc Fetch the ancestor regions for a given region in the hierarchy.
 * @access Public
 * @param {number} regionId - The ID of the region to fetch ancestors for.
 * @returns {Response} The response object containing ancestors data or an error message.
 */
router.get(
  '/:regionId/ancestors',
  ...[
    check('regionId').isInt().withMessage('Region ID must be an integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return regionController.getAncestors(req, res);
  },
);

/**
 * @route GET /api/regions/:regionId/geometry
 * @desc Fetch the geometry for a region.
 * @access Public
 * @param {number} regionId - The ID of the region.
 * @param {boolean} [resolveEmpty] - Flag to resolve empty geometry data (optional).
 * @returns {Response} The response object containing geometry data or an error message.
 */
router.get(
  '/:regionId/geometry',
  ...[
    check('regionId').isInt().withMessage('Region ID must be an integer'),
    check('resolveEmpty').optional().isBoolean().withMessage('resolveEmpty must be a boolean'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => error.msg);
      return res.status(400).json({ errors: errorMessages });
    }
    return regionController.getGeometry(req, res);
  },
);

module.exports = router;
