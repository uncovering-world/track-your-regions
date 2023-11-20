const Region = require('./Region');
const Hierarchy = require('./Hierarchy');
const HierarchyNames = require('./HierarchyNames');

Hierarchy.belongsToMany(Region, {
    through: 'region_group_mapping', // Name of the intermediate mapping table
    foreignKey: 'alternative_hierarchy_id', // Foreign key in the mapping table referring to AlternativeHierarchy
    otherKey: 'region_id', // Foreign key in the mapping table referring to Region
});

Hierarchy.belongsTo(HierarchyNames, {
    foreignKey: 'hierarchy_id',
});

Region.belongsToMany(Hierarchy, {
    through: 'region_group_mapping', // Name of the intermediate mapping table
    foreignKey: 'region_id', // Foreign key in the mapping table referring to Region
    otherKey: 'alternative_hierarchy_id', // Foreign key in the mapping table referring to Hierarchy
});

const models = {
    Region,
    Hierarchy,
    HierarchyNames,
};

module.exports = models;
