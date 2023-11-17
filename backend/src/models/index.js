const Region = require('./Region');
const AlternativeHierarchy = require('./AlternativeHierarchy');

AlternativeHierarchy.belongsToMany(Region, {
    through: 'region_group_mapping', // Name of the intermediate mapping table
    foreignKey: 'alternative_hierarchy_id', // Foreign key in the mapping table referring to AlternativeHierarchy
    otherKey: 'region_id', // Foreign key in the mapping table referring to Region
});

Region.belongsToMany(AlternativeHierarchy, {
    through: 'region_group_mapping', // Name of the intermediate mapping table
    foreignKey: 'region_id', // Foreign key in the mapping table referring to Region
    otherKey: 'alternative_hierarchy_id', // Foreign key in the mapping table referring to AlternativeHierarchy
});

const models = {
    Region,
    AlternativeHierarchy
};

module.exports = models;
