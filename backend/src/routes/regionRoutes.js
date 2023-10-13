const express = require('express');
const regionController = require('../controllers/regionController');
const { check, validationResult } = require('express-validator');

const router = express.Router();

router.get('/root', regionController.getRootRegions);
router.get('/:regionId',
    ...[
        check('regionId').isInt().withMessage('Region ID must be an integer')
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
        check('regionId').isInt().withMessage('Region ID must be an integer')
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


module.exports = router;
