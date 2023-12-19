const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

function buildQuery(queryTerms, hierarchyId) {
  // Split the input query terms into an array of terms
  const queryTermsArray = queryTerms.split(' ').filter((term) => term.trim() !== '');

  // Construct the WHERE clause to match each term in the region name or path
  const nameMatchClauses = queryTermsArray.map((term, index) => `region_name ILIKE :term${index}`).join(' OR ');
  const pathMatchClauses = queryTermsArray.map((term, index) => `result.path ILIKE :term${index}`).join(' AND ');

  // Construct the replacements object to be used in the query
  const replacements = {
    hierarchyId,
  };
  queryTermsArray.forEach((term, index) => {
    replacements[`term${index}`] = `%${term}%`;
  });

  // Construct the SQL query
  const sqlQuery = `
    WITH RECURSIVE PathCTE AS (
      SELECT
        region_id,
        region_name,
        parent_id,
        hierarchy_id,
        CAST(region_name AS VARCHAR(255)) AS path,
        region_name AS main_name,
        region_id AS main_id
      FROM
        hierarchy
      WHERE
        hierarchy_id = :hierarchyId AND (${nameMatchClauses})
      UNION ALL
        SELECT
          parent.region_id,
          parent.region_name,
          parent.parent_id,
          parent.hierarchy_id,
          CAST(parent.region_name || ' > ' || child.path AS VARCHAR(255)) AS path,
          child.main_name AS main_name,
          child.main_id AS main_id
        FROM
          hierarchy parent
        JOIN PathCTE child ON parent.region_id = child.parent_id
        WHERE parent.hierarchy_id = :hierarchyId
      )
      SELECT
        result.main_id,
        result.main_name,
        result.path,
        (
          CASE WHEN result.path ILIKE '%> ' || :inputQuery || '%' THEN 400 ELSE 0 END
          +
          CASE WHEN result.main_name ILIKE '%' || :inputQuery || '%' THEN 300 ELSE 0 END
          +
          CASE WHEN result.main_name ~* :regexPattern THEN 200 ELSE 0 END
          +
          ${queryTermsArray.map((_, index) => `
             CASE WHEN result.main_name ~* ( '(^|\\w)' || :term${index} || '(\\w|$)' ) THEN 100 ELSE 0 END
          `).join(' + ')}
          +
          ${queryTermsArray.map((_, index) => `
            CASE WHEN result.main_name ILIKE '%' || :term${index} || '%' THEN ${index + 1} ELSE 0 END
          `).join(' + ')}
        ) AS relevance_score
      FROM
       PathCTE result
      WHERE
        ${pathMatchClauses}
      ORDER BY relevance_score DESC;
  `;

  return sqlQuery;
}

module.exports = {
  buildQuery,
};
