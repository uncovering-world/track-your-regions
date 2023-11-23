const turf = require('@turf/turf');

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

    // Fetch the corresponding region_id from the Hierarchy table
    const hierarchyEntry = await Hierarchy.findByPk(regionId, {
        include: [{
            model: Region,
            through: {
                attributes: []
            }, // Exclude the attributes of the join table
        }]
    });

    if (!hierarchyEntry || !hierarchyEntry.Regions || hierarchyEntry.Regions.length === 0) {
        return res.status(404).json({ message: 'Region not found' });
    }

    // Process all associated regions
    let geometries = await Promise.all(hierarchyEntry.Regions.map(async (region_elem) => {
        const region = region_elem.dataValues;
        let geometry = region.geom;

        if (!geometry && resolveEmpty) {
            const query = `
                WITH RECURSIVE Subregions AS (
                    SELECT h.region_id as RegionId, ST_Simplify(r.geom, 0.0) as simplified_geom
                    FROM hierarchy h
                    INNER JOIN hierarchy_region_mapping hrm ON hrm.alt_region_id = h.region_id
                    INNER JOIN regions r ON hrm.region_id = r.id
                    WHERE h.region_id = :regionId
                    UNION ALL
                    SELECT hr.region_id, ST_Simplify(rr.geom, 0.0) as simplified_geom
                    FROM hierarchy hr
                    INNER JOIN hierarchy_region_mapping hrmr ON hrmr.alt_region_id = hr.region_id
                    INNER JOIN regions rr ON hrmr.region_id = rr.id
                    INNER JOIN Subregions s ON hr.parent_id = s.RegionId
                    WHERE s.simplified_geom IS NULL
                )
                SELECT ST_Multi(ST_Union(simplified_geom)) as geometry
                FROM Subregions
                WHERE simplified_geom IS NOT NULL;
            `;

            const result = await sequelize.query(query, {
                replacements: { regionId: regionId },
                type: QueryTypes.SELECT
            });

            geometry = result.length > 0 ? result[0].geometry : null;

            if (geometry) {
                // XXX Do we update the geometry in the right table?
                // Optionally update the geometry in the database
                await Region.update({ geom: geometry }, {
                    where: { id: region.id }
                });
            }
        }
        return geometry;
    }));

    geometries = geometries.filter(g => g != null);

    if (geometries.length === 0) {
        return res.status(204).json({ message: 'No geometries found' });
    }

    // Combine all geometries into a single MultiPolygon
    let combinedGeometry = geometries[0];
    for (let i = 0; i < geometries.length; i++) {
        combinedGeometry = turf.union(combinedGeometry, geometries[i]);
    }
    let result;
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
    const hierarchyId = req.query.hierarchyId || 1 ;

    // Check if the region exists
    const region = await Hierarchy.findByPk(regionId)
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
}


exports.getRootRegions = async (req, res) => {
    try {
        let hierarchyId = req.query.hierarchyId || 1;

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

        const region = await Hierarchy.findByPk(regionId);

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
        SELECT region_id, parent_id as parentId, region_name
        FROM hierarchy
        WHERE parent_id = :regionId AND hierarchy_id = :hierarchyId
        UNION ALL
        SELECT h.region_id, h.parent_id as parentId, h.region_name
        FROM hierarchy h
        INNER JOIN Subregions s ON h.parent_id = s.region_id
    )
    SELECT * FROM Subregions;
`;

    return await sequelize.query(query, {
        replacements: { regionId, hierarchyId },
        type: QueryTypes.SELECT,
        mapToModel: true,
        model: Hierarchy
    });

}


// Retrieve subregions for a specific region
exports.getSubregions = async (req, res) => {
    const { regionId } = req.params;
    const { getAll } = req.query;
    const hierarchyId = req.query.hierarchyId || 1;

    try {
        // Check if the region exists
        const region = await Hierarchy.findByPk(regionId)

        if (!region) {
            return res.status(404).json({ message: 'Region not found' });
        }

        // Retrieve subregions
        let subregions;
        // Check the getAll query parameter
        if (getAll === 'true') {
            subregions = await getAllSubregions(regionId, hierarchyId);
        } else {
            subregions = await Hierarchy.findAll({
                where: { parentId: regionId, hierarchyId: hierarchyId }
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
