const express = require('express');

const regionRoutes = require('./regionRoutes');

const router = express.Router();

router.use('/api/regions', regionRoutes);

module.exports = router;
