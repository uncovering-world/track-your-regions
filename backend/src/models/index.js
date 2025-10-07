const Region = require('./Region');
const Hierarchy = require('./Hierarchy');
const HierarchyNames = require('./HierarchyNames');
const HierarchyRegionMapping = require('./HierarchyRegionMapping');
const View = require('./View');
const ViewRegionMapping = require('./ViewRegionMapping');

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

// I cannot define many-to-many association between Hierarchy and Region as the primary key of
// Hierarchy is a composite key and Sequelize does not support composite primary keys as foreign
// keys. So I have to define the association manually.

// Define associations for View
View.belongsTo(HierarchyNames, {
  foreignKey: 'hierarchy_id',
  targetKey: 'hierarchyId',
});

HierarchyNames.hasMany(View, {
  foreignKey: 'hierarchy_id',
});

// Define associations for ViewRegionMapping
ViewRegionMapping.belongsTo(View, {
  foreignKey: 'view_id',
});

View.hasMany(ViewRegionMapping, {
  foreignKey: 'view_id',
});

const models = {
  Region,
  Hierarchy,
  HierarchyNames,
  HierarchyRegionMapping,
  View,
  ViewRegionMapping,
};

module.exports = models;
