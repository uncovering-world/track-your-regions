const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

async function executeQuery(sqlQuery, replacements) {
  try {
    const results = await sequelize.query(sqlQuery, {
      replacements,
      type: QueryTypes.SELECT,
    });
    return results;
  } catch (err) {
    console.error(err);
    throw new Error('Failed to execute SQL query');
  }
}

module.exports = {
  executeQuery,
};
