const express = require('express');
const bodyParser = require('body-parser');
const regionRoutes = require('./routes/regionRoutes');

const app = express();

app.use(bodyParser.json());
app.use('/regions', regionRoutes);

module.exports = app;
