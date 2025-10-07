const { QueryTypes } = require('sequelize');
const {
  View, ViewRegionMapping, Hierarchy, HierarchyNames,
} = require('../models');
const sequelize = require('../config/db');

/**
 * Get all views for a specific hierarchy.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - An array of views
 * @throws {Error} - If an error occurs during the retrieval
 */
exports.getViews = async (req, res) => {
  try {
    const hierarchyId = req.query.hierarchyId || 1;
    const includeInactive = req.query.includeInactive === 'true';

    const whereClause = { hierarchyId };
    if (!includeInactive) {
      whereClause.isActive = true;
    }

    const views = await View.findAll({
      where: whereClause,
      order: [['name', 'ASC']],
    });

    if (views.length === 0) {
      return res.status(204).json({ message: 'No views found' });
    }

    return res.status(200).json(views.map((view) => view.toApiFormat()));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Get a specific view by ID.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - The view object
 * @throws {Error} - If an error occurs during the retrieval
 */
exports.getViewById = async (req, res) => {
  try {
    const { viewId } = req.params;

    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    return res.status(200).json(view.toApiFormat());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Get all regions belonging to a specific view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - An array of regions in the view
 * @throws {Error} - If an error occurs during the retrieval
 */
exports.getViewRegions = async (req, res) => {
  try {
    const { viewId } = req.params;

    // Check if view exists
    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    // Get regions in this view
    const regions = await sequelize.query(`
      SELECT h.region_id as id, h.region_name as name, h.has_subregions as "hasSubregions"
      FROM view_region_mapping vrm
      JOIN hierarchy h ON vrm.region_id = h.region_id AND vrm.hierarchy_id = h.hierarchy_id
      WHERE vrm.view_id = :viewId
      ORDER BY h.region_name ASC
    `, {
      replacements: { viewId },
      type: QueryTypes.SELECT,
    });

    if (regions.length === 0) {
      return res.status(204).json({ message: 'No regions found in this view' });
    }

    return res.status(200).json(regions);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Create a new view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - The created view object
 * @throws {Error} - If an error occurs during creation
 */
exports.createView = async (req, res) => {
  try {
    const {
      name, description, hierarchyId, isActive,
    } = req.body;

    // Validate that hierarchy exists
    const hierarchy = await HierarchyNames.findOne({
      where: { hierarchyId },
    });

    if (!hierarchy) {
      return res.status(404).json({ message: 'Hierarchy not found' });
    }

    const view = await View.create({
      name,
      description,
      hierarchyId,
      isActive: isActive !== undefined ? isActive : true,
    });

    return res.status(201).json(view.toApiFormat());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Update an existing view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - The updated view object
 * @throws {Error} - If an error occurs during update
 */
exports.updateView = async (req, res) => {
  try {
    const { viewId } = req.params;
    const {
      name, description, isActive,
    } = req.body;

    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    if (name !== undefined) view.name = name;
    if (description !== undefined) view.description = description;
    if (isActive !== undefined) view.isActive = isActive;

    await view.save();

    return res.status(200).json(view.toApiFormat());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Delete a view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - Success message
 * @throws {Error} - If an error occurs during deletion
 */
exports.deleteView = async (req, res) => {
  try {
    const { viewId } = req.params;

    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    await view.destroy();

    return res.status(200).json({ message: 'View deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Add regions to a view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - Success message
 * @throws {Error} - If an error occurs during addition
 */
exports.addRegionsToView = async (req, res) => {
  try {
    const { viewId } = req.params;
    const { regions } = req.body; // Array of {regionId, hierarchyId}

    // Check if view exists
    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    // Validate that all regions exist in the hierarchy
    const regionValidations = await Promise.all(
      regions.map(async (region) => {
        const exists = await Hierarchy.findOne({
          where: {
            regionId: region.regionId,
            hierarchyId: region.hierarchyId || view.hierarchyId,
          },
        });
        return exists !== null;
      }),
    );

    if (regionValidations.includes(false)) {
      return res.status(404).json({ message: 'One or more regions not found in hierarchy' });
    }

    // Add regions to view
    const mappings = regions.map((region) => ({
      viewId: parseInt(viewId, 10),
      regionId: region.regionId,
      hierarchyId: region.hierarchyId || view.hierarchyId,
    }));

    await ViewRegionMapping.bulkCreate(mappings, {
      ignoreDuplicates: true,
    });

    return res.status(201).json({ message: 'Regions added to view successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * Remove regions from a view.
 *
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @returns {Object} - Success message
 * @throws {Error} - If an error occurs during removal
 */
exports.removeRegionsFromView = async (req, res) => {
  try {
    const { viewId } = req.params;
    const { regions } = req.body; // Array of {regionId, hierarchyId}

    // Check if view exists
    const view = await View.findOne({
      where: { id: viewId },
    });

    if (!view) {
      return res.status(404).json({ message: 'View not found' });
    }

    // Remove regions from view
    await Promise.all(
      regions.map(async (region) => {
        await ViewRegionMapping.destroy({
          where: {
            viewId: parseInt(viewId, 10),
            regionId: region.regionId,
            hierarchyId: region.hierarchyId || view.hierarchyId,
          },
        });
      }),
    );

    return res.status(200).json({ message: 'Regions removed from view successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
