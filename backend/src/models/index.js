const Region = require('./Region');
const Hierarchy = require('./Hierarchy');
const HierarchyNames = require('./HierarchyNames');

Hierarchy.belongsToMany(Region, {
    through: 'hierarchy_region_mapping', // Name of the intermediate mapping table
    foreignKey: 'alt_region_id', // Foreign key in the mapping table referring to AlternativeHierarchy
    otherKey: 'region_id', // Foreign key in the mapping table referring to Region
});

Hierarchy.belongsTo(HierarchyNames, {
    foreignKey: 'hierarchy_id',
});

Region.belongsToMany(Hierarchy, {
    through: 'hierarchy_mapping', // Name of the intermediate mapping table
    foreignKey: 'region_id', // Foreign key in the mapping table referring to Region
    otherKey: 'alt_region_id', // Foreign key in the mapping table referring to Hierarchy
});

const models = {
    Region,
    Hierarchy,
    HierarchyNames,
};

module.exports = models;
