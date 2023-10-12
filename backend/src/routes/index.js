const express = require('express');

const regionRoutes = require('./regionRoutes');

const router = express.Router();

router.use('/region', regionRoutes);

module.exports = router;
