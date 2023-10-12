const express = require('express');

const regionRoutes = require('./regionRoutes');

const router = express.Router();

router.use('/regions', regionRoutes);

module.exports = router;
