const { Region } = require('../models');

exports.getRootRegions = async (req, res) => {
    try {
        const regions = await Region.findAll({
            where: {
                parentRegionId: null,
            },
        });
        res.status(200).json(regions);
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

        res.status(200).json(subregions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
