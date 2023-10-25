const { Region } = require('../models');
const { Model, DataTypes, QueryTypes } = require('sequelize');
const sequelize  = require("../config/db");


exports.getGeometry = async (req, res) => {
    const { regionId } = req.params;
    const region = await Region.findOne({
        where: { id: regionId }
    });

    if (!region) {
        return res.status(404).json({ message: 'Region not found' });
    }

    let geometry = region.geom;

    if (!geometry) {
        const query = `
            WITH RECURSIVE Subregions AS (
                SELECT id, geom
                FROM regions
                WHERE id = :regionId
                UNION ALL
                SELECT r.id, r.geom
                FROM regions r
                INNER JOIN Subregions s ON r.parent_region_id = s.id
                WHERE s.geom IS NULL
            )
            SELECT ST_AsGeoJSON(ST_Multi(ST_Union(geom))) as geometry
            FROM Subregions
            WHERE geom IS NOT NULL;
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
        const regions = await Region.findAll({
            where: {
                parentRegionId: null,
            },
        });
        res.status(200).json(regions.map(region => region.toApiFormat()));
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

// Retrieve subregions for a specific region
exports.getSubregions = async (req, res) => {
    const { regionId } = req.params;

    try {
        // Check if the region exists
        const region = await Region.findOne({
            where: { id: regionId }
        });

        if (!region) {
            return res.status(404).json({ message: 'Region not found' });
        }

        // Retrieve subregions
        const subregions = await Region.findAll({
            where: { parentRegionId: regionId }
        });

        if (subregions.length === 0) {
            return res.status(202).json({ message: 'Region has no subregions' });
        }

        res.status(200).json(subregions.map(region => region.toApiFormat()));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
