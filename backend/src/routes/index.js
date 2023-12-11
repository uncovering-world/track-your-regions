const express = require('express');

const regionRoutes = require('./regionRoutes');

const router = express.Router();

/**
 * Initialize region routes and incorporate them under the '/api/regions' base path.
 * @returns {express.Router} The router with the region routes attached.
 */
router.use('/api/regions', regionRoutes);

module.exports = router;
