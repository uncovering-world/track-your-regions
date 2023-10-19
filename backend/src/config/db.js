const { Sequelize } = require('sequelize');

// Get the db credentials from the .env file
require('dotenv').config();
//Load all present .env.* files
for (const env of ['', '.development', '.production', '.local']) {
    require('dotenv').config({ path: `.env${env}` });
}

// Create a new Sequelize instance
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host:     process.env.DB_HOST || 'localhost',
        dialect:  'postgres',
    },
);

// Test DB connection
sequelize.authenticate()
    .then(() => {
        console.log('Database connection has been established successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

module.exports = sequelize;
