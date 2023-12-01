const Region = require('./Region');
const Hierarchy = require('./Hierarchy');
const HierarchyNames = require('./HierarchyNames');
const HierarchyRegionMapping = require('./HierarchyRegionMapping');

Hierarchy.belongsTo(HierarchyNames, {
  foreignKey: 'hierarchy_id',
  targetKey: 'hierarchyId',
});

HierarchyNames.hasMany(Hierarchy, {
  foreignKey: 'hierarchy_id',
});

Hierarchy.belongsTo(Region, {
  foreignKey: 'region_id',
});

// I cannot define many-to-many association between Hierarchy and Region as the primary key of Hierarchy is a composite
// key and Sequelize does not support composite primary keys as foreign keys. So I have to define the association
// manually.

const models = {
  Region,
  Hierarchy,
  HierarchyNames,
  HierarchyRegionMapping,
};

module.exports = models;
