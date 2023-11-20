
const { Region, Hierarchy , HierarchyNames} = require('../models');
const { QueryTypes } = require('sequelize');
const sequelize  = require("../config/db");

exports.getHierarchies = async (req, res) => {
    try {
        const hierarchies = await HierarchyNames.findAll();
        res.status(200).json(hierarchies.map(hierarchy => hierarchy.toApiFormat()));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

exports.getGeometry = async (req, res) => {
    const { regionId } = req.params;
    const resolveEmpty = req.query.resolveEmpty === 'true';

    // Check if the region exists
    const region = await Region.findOne({
        where: { id: regionId }
    });
    if (!region) {
        return res.status(404).json({ message: 'Region not found' });
    }

    let geometry = region.geom;

   if (!geometry) {
        if (!resolveEmpty) {
            return res.status(204).json({ message: 'Geometry not found' });
        }
        const query = `
            WITH RECURSIVE Subregions AS (SELECT id, ST_Simplify(geom, 0.01) as simplified_geom
                                          FROM regions
                                          WHERE id = :regionId
                                          UNION ALL
                                          SELECT r.id, ST_Simplify(r.geom, 0.01) as simplified_geom
                                          FROM regions r
                                                   INNER JOIN Subregions s ON r.parent_region_id = s.id
                                          WHERE s.simplified_geom IS NULL)
            SELECT ST_AsGeoJSON(ST_Multi(ST_Union(simplified_geom))) as geometry
            FROM Subregions
            WHERE simplified_geom IS NOT NULL;
        `;

        const result = await sequelize.query(query, {
            replacements: { regionId },
            type: QueryTypes.SELECT
        });

        geometry = result.length > 0 ? result[0].geometry : null;

        if (geometry) {
            // Update the geometry in the database
            await Region.update({ geom: geometry }, {
                where: { id: regionId }
            });
        } else {
            return res.status(404).json({ message: 'Geometry not found' });
        }
    }

    return res.status(200).json({ geometry });
};


exports.getAncestors = async (req, res) => {
    const { regionId } = req.params;

    // Check if the region exists
    const region = await Region.findOne({
        where: { id: regionId }
    });
    if (!region) {
        return res.status(404).json({ message: 'Region not found' });
    }

    try {
        const ancestors = await Region.getAncestors(regionId);
        res.status(200).json(ancestors);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}


exports.getRootRegions = async (req, res) => {
    try {
        let { hierarchyId } = req.query.hierarchyId || {};
        // If hierarchyId is not provided use default hierarchy
        if (!hierarchyId) {
            hierarchyId = 1;
        }

        const hierarchy_regions = await Hierarchy.findAll({
            where: {
                parentId: null,
                hierarchyId: hierarchyId
            },
        });
        res.status(200).json(hierarchy_regions.map(region => region.toApiFormat()));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getRegionById = async (req, res) => {
    try {
        const { regionId } = req.params;
        const region = await Region.findByPk(regionId);

        if (!region) {
            return res.status(404).json({ message: 'Region not found' });
        }

        res.status(200).json(region);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};


async function getAllSubregions(regionId) {
    const query = `
    WITH RECURSIVE Subregions AS (
        SELECT id, parent_region_id as parentRegionId, name
        FROM regions
        WHERE parent_region_id = :regionId
        UNION ALL
        SELECT r.id, r.parent_region_id as parentRegionId, r.name
        FROM regions r
        INNER JOIN Subregions s ON r.parent_region_id = s.id
    )
    SELECT * FROM Subregions;
`;

    const result = await sequelize.query(query, {
        replacements: { regionId },
        type: QueryTypes.SELECT,
        mapToModel: true, // Required to map the result to Region instances
        model: Region // The model to map to
    });

    return result;
}


// Retrieve subregions for a specific region
exports.getSubregions = async (req, res) => {
    const { regionId } = req.params;
    const { getAll } = req.query;

    try {
        // Check if the region exists
        const region = await Region.findOne({
            where: { id: regionId }
        });

        if (!region) {
            return res.status(404).json({ message: 'Region not found' });
        }

        // Retrieve subregions
        let subregions;
        // Check the getAll query parameter
        if (getAll === 'true') {
            subregions = await getAllSubregions(regionId);
        } else {
            subregions = await Region.findAll({
                where: { parentRegionId: regionId }
            });
        }

        if (subregions.length === 0) {
            return res.status(202).json({ message: 'Region has no subregions' });
        }

        res.status(200).json(subregions.map(region => region.toApiFormat()));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
