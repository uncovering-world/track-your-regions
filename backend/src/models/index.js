const Region = require('./Region');
const Hierarchy = require('./Hierarchy');
const HierarchyNames = require('./HierarchyNames');
const HierarchyRegionMapping = require('./HierarchyRegionMapping');

/**
 * Establishes a belongs-to association between Hierarchies and HierarchyNames.
 * Specifies that each Hierarchy record must reference one HierarchyName.
 */
Hierarchy.belongsTo(HierarchyNames, {
  foreignKey: 'hierarchy_id',
  targetKey: 'hierarchyId',
});

/**
 * Establishes a one-to-many association between HierarchyNames and Hierarchies.
 * Specifies that each HierarchyName record can have multiple associated Hierarchy records.
 */
HierarchyNames.hasMany(Hierarchy, {
  foreignKey: 'hierarchy_id',
});

/**
 * Establishes a belongs-to association between Hierarchies and Regions.
 * Specifies that each Hierarchy record can be associated with one Region.
 */
Hierarchy.belongsTo(Region, {
  foreignKey: 'region_id',
});

// I cannot define many-to-many association between Hierarchy and Region as the primary key of
// Hierarchy is a composite key and Sequelize does not support composite primary keys as foreign
// keys. So I have to define the association manually.

/**
 * A collection of model entities available in the application.
 */
const models = {
  Region,
  Hierarchy,
  HierarchyNames,
  HierarchyRegionMapping,
};

module.exports = models;
