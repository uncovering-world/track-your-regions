require('dotenv-flow').config();

module.exports = {
  db_user: process.env.DB_USER,
  db_password: process.env.DB_PASSWORD,
  db_name: process.env.DB_NAME,
  db_host: process.env.DB_HOST || 'localhost',
  db_dialect: 'postgres',
};
