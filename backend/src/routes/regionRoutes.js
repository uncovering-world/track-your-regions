const express = require('express');
const regionController = require('../controllers/regionController');

const router = express.Router();

router.get('/root', regionController.getRootRegions);
router.get('/:regionId', regionController.getRegionById);
router.get('/:regionId/subregions', regionController.getSubregions);

module.exports = router;
