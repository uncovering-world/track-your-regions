const express = require('express');

const regionRoutes = require('./regionRoutes');
const viewRoutes = require('./viewRoutes');

const router = express.Router();

router.use('/api/regions', regionRoutes);
router.use('/api/views', viewRoutes);

module.exports = router;
