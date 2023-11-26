const {Model, DataTypes} = require('sequelize');
const sequelize = require('../config/db');

class HierarchyRegionMapping extends Model {
    // Transform the returned object to API format
    toApiFormat() {
        return {
            hierarchyId: this.hierarchyId,
            regionId: this.regionId,
            altRegionId: this.altRegionId,
        };
    }
}

HierarchyRegionMapping.init({
    hierarchyId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        field: 'hierarchy_id'
    },
    regionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        field: 'region_id',
        references: {
            model: 'regions',
            key: 'id'
        },
    },
    altRegionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        field: 'alt_region_id'
    },
}, {
    sequelize,
    modelName: 'HierarchyRegionMapping',
    tableName: 'hierarchy_region_mapping',
    timestamps: false
});

module.exports = HierarchyRegionMapping;