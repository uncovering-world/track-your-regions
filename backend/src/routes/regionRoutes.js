const express = require('express');
const { check, query, validationResult } = require('express-validator');
const regionController = require('../controllers/regionController');

const router = express.Router();

router.get(
  '/hierarchies',
  /**
   * Fetches all available hierarchies with no parameters.
   * @returns {Array<Object>} An array of hierarchy objects in the response.
   */
  async (req, res) => {
    await regionController.getHierarchies(req, res);
  },
);
router.get(
  '/root',
  /**
   * Fetches root regions based on a given hierarchy ID from query parameters.
   * @param {string} [hierarchyId] Optional hierarchy ID to filter root regions.
   * @returns {Array<Object> | Array} An array of root regions or an empty array in the response.
   */
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
router.get(
  '/:regionId',
  /**
   * Fetches the details of a specific region based on region ID and hierarchy ID from query parameters.
   * @param {string} regionId The region ID used to identify the region.
   * @param {string} [hierarchyId] Optional hierarchy ID to which the region belongs.
   * @returns {Object | Array} The region details or an empty array in response.
   */
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

router.get(
  '/:regionId/ancestors',
  /**
   * Fetches ancestors of a specific region based on region ID.
   * @param {string} regionId The region ID for which to retrieve ancestors.
   * @returns {Array<Object> | Array} An array of ancestor regions or an empty array in response if no ancestors are found.
   */
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

router.get(
  '/:regionId/geometry',
  /**
   * Retrieves geometry of a specific region based on region ID, with an option to resolve if empty.
   * @param {string} regionId The region ID for which to retrieve geometry.
   * @param {boolean} [resolveEmpty=false] Flag indicating whether to resolve the response with an empty object if no geometry is found.
   * @returns {Object | Array} The geometry data or an empty object in response if 'resolveEmpty' is true.
   */
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
