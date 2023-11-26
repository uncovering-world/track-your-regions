const express = require('express');
const regionController = require('../controllers/regionController');
const { check, query, validationResult } = require('express-validator');

const router = express.Router();

router.get('/hierarchies',
    async (req, res) => {
        await regionController.getHierarchies(req, res);
    }
);
router.get('/root',
    ...[
        check('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(error => error.msg);
            return res.status(400).json({errors: errorMessages});
        }
        await regionController.getRootRegions(req, res);
    }
);
router.get('/:regionId',
    ...[
        check('regionId').isInt().withMessage('Region ID must be an integer'),
        check('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(error => error.msg);
            return res.status(400).json({errors: errorMessages});
        }
        await regionController.getRegionById(req, res);
    }
);
router.get('/:regionId/subregions',
    ...[
        check('regionId').isInt().withMessage('Region ID must be an integer'),
        query('getAll').optional().isBoolean().withMessage('getAll must be a boolean'),
        query('hierarchyId').optional().isInt().withMessage('Hierarchy ID must be an integer'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(error => error.msg);
            return res.status(400).json({errors: errorMessages});
        }
        await regionController.getSubregions(req, res);
    }
);

router.get('/:regionId/ancestors',
    ...[
        check('regionId').isInt().withMessage('Region ID must be an integer')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(error => error.msg);
            return res.status(400).json({errors: errorMessages});
        }
        await regionController.getAncestors(req, res);
    }
);

router.get('/:regionId/geometry',
    ...[
        check('regionId').isInt().withMessage('Region ID must be an integer'),
        check('resolveEmpty').optional().isBoolean().withMessage('resolveEmpty must be a boolean')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(error => error.msg);
            return res.status(400).json({errors: errorMessages});
        }
        await regionController.getGeometry(req, res);
    }
);

module.exports = router;
