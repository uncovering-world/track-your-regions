const turf = require('@turf/turf');

const { QueryTypes } = require('sequelize');
const {
  Region, Hierarchy, HierarchyNames, HierarchyRegionMapping,
} = require('../models');
const sequelize = require('../config/db');

exports.getHierarchies = async (req, res) => {
  try {
    const hierarchies = await HierarchyNames.findAll();
    res.status(200).json(hierarchies.map((hierarchy) => hierarchy.toApiFormat()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getGeometry = async (req, res) => {
  const { regionId } = req.params;
  const resolveEmpty = req.query.resolveEmpty === 'true';
  const hierarchyId = req.query.hierarchyId || 1;

  // Check if the region exists
  const region = await Hierarchy.findOne({
    where: {
      regionId,
      hierarchyId,
    },
  });
  if (!region) {
    return res.status(404).json({ message: 'Region not found' });
  }

  // Find all subdivisions of the region
  const divisions = await getDivisions(regionId, hierarchyId, res);
  let geometries = [];
  let notCompleted = false;
  for (const division of divisions) {
    const regionId = division.id;
    const { geom } = division;
    if (geom) {
      geometries.push(geom);
    } else if (!resolveEmpty) {
      notCompleted = true;
      break;
    } else {
      // Find ids and geometries of all subdivisions of the division
      const query = `
                    WITH RECURSIVE Subregions AS (
                        SELECT r.id as region_id, ST_Simplify(r.geom, 0.0) as simplified_geom
                        FROM regions r
                        WHERE r.parent_region_id = :regionId
                        UNION ALL
                        SELECT r_r.id, ST_Simplify(r_r.geom, 0.0) as simplified_geom_r
                        FROM regions r_r
                        INNER JOIN Subregions s ON r_r.parent_region_id = s.region_id
                        WHERE s.simplified_geom IS NULL)
                    SELECT ST_Multi(ST_Union(simplified_geom)) as geometry
                    FROM Subregions
                    WHERE simplified_geom IS NOT NULL;
                `;
      const result = await sequelize.query(query, {
        replacements: { regionId },
        type: QueryTypes.SELECT,
      });
      const result_geometry = result[0].geometry;
      // Update the geometry of the region
      if (result_geometry) {
        geometries.push(result_geometry);
        // Asynchronously update the geometry of the region
        Region.update({ geom: result_geometry }, {
          where: { id: regionId },
        }).then().catch((err) => console.log(err));
      }
    }
  }

  geometries = geometries.filter((g) => g != null);

  if (geometries.length === 0) {
    return res.status(204).json({ message: 'No geometries found' });
  }

  if (notCompleted) {
    return res.status(204).json({ message: 'Not all geometries are available' });
  }

  // Combine all geometries into a single MultiPolygon
  let combinedGeometry = geometries[0];
  let result;
  for (let i = 0; i < geometries.length; i++) {
    combinedGeometry = turf.union(combinedGeometry, geometries[i]);
  }
  // Check the type of the combined geometry
  if (combinedGeometry.geometry.type !== 'MultiPolygon') {
    result = turf.multiPolygon([combinedGeometry.geometry.coordinates]);
  } else {
    result = turf.multiPolygon(combinedGeometry.geometry.coordinates);
  }

  return res.status(200).json(result);
};

exports.getAncestors = async (req, res) => {
  const { regionId } = req.params;
  const hierarchyId = req.query.hierarchyId || 1;

  // Check if the region exists
  const region = await Hierarchy.findOne({
    where: {
      regionId,
      hierarchyId,
    },
  });
  if (!region) {
    return res.status(404).json({ message: 'Region not found' });
  }

  try {
    const ancestors = await Hierarchy.getAncestors(regionId, hierarchyId);
    res.status(200).json(ancestors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getRootRegions = async (req, res) => {
  try {
    const hierarchyId = req.query.hierarchyId || 1;

    const hierarchy_regions = await Hierarchy.findAll({
      where: {
        parentId: null,
        hierarchyId,
      },
    });
    res.status(200).json(hierarchy_regions.map((region) => region.toApiFormat()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getRegionById = async (req, res) => {
  try {
    const { regionId } = req.params;
    const hierarchyId = req.query.hierarchyId || 1;

    const region = await Hierarchy.findOne({
      where: {
        regionId,
        hierarchyId,
      },
    });

    if (!region) {
      return res.status(404).json({ message: 'Region not found' });
    }

    res.status(200).json(region.toApiFormat());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

async function getAllSubregions(regionId, hierarchyId) {
  const query = `
        WITH RECURSIVE Subregions AS (
            SELECT *
            FROM hierarchy
            WHERE parent_id = :regionId AND hierarchy_id = :hierarchyId
            UNION ALL
            SELECT h.*
            FROM hierarchy h
            INNER JOIN Subregions s ON h.parent_id = s.region_id AND h.hierarchy_id = :hierarchyId
        )
        SELECT * FROM Subregions;
    `;

  return await sequelize.query(query, {
    replacements: { regionId, hierarchyId },
    type: QueryTypes.SELECT,
    mapToModel: true,
    model: Hierarchy,
  });
}

// Retrieve the divisions of a region. It does not include subdivisions of the divisions.
async function getDivisions(regionId, hierarchyId) {
  const regions = (await getSubregions(regionId, hierarchyId, false)).data;
  // Add the region itself
  regions.push(await Hierarchy.findOne({
    where: {
      regionId,
      hierarchyId,
    },
  }));
  let result_divisions = [];
  for (const region of regions) {
    const query = `
            SELECT r.* FROM hierarchy_region_mapping hrm
            JOIN regions r ON hrm.region_id = r.id
            WHERE alt_region_id = :regionId AND hierarchy_id = :hierarchyId
            `;
    const result = await sequelize.query(query, {
      replacements: { regionId: region.regionId, hierarchyId },
      type: QueryTypes.SELECT,
      mapToModel: true,
      model: Region,
    });
    result_divisions = result_divisions.concat(result.map((region) => region.dataValues));
  }
  return result_divisions;
}

// Retrieve subregions for a specific region
getSubregions = async (regionId, hierarchyId, getAll) => {
  try {
    // Check if the region exists
    const region = await Hierarchy.findOne({
      where: {
        regionId,
        hierarchyId,
      },
    });

    if (!region) {
      return { data: [], message: 'Region not found', status: 404 };
    }

    // Retrieve subregions
    let subregions;
    // Check the getAll query parameter
    if (getAll === 'true') {
      subregions = await getAllSubregions(regionId, hierarchyId);
    } else {
      subregions = await Hierarchy.findAll({
        where: { parentId: regionId, hierarchyId },
        mapToModel: true,
        model: Hierarchy,
      });
    }

    if (subregions.length === 0) {
      return { data: [], message: 'Region has no subregions', status: 202 };
    }

    return { data: subregions, status: 200 };
  } catch (err) {
    console.error(err);
    return { data: [], message: 'Internal Server Error', status: 500 };
  }
};

exports.getSubregions = async (req, res) => {
  const { regionId } = req.params;
  const getAll = req.query.getAll || false;
  const hierarchyId = req.query.hierarchyId || 1;

  const subregions = await getSubregions(regionId, hierarchyId, getAll);
  const result = subregions.data ? subregions.data.map(
    (r) => r.toApiFormat(),
  ) : { message: subregions.message };
  return res.status(subregions.status).json(result);
};
