const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/db');

class Hierarchy extends Model {
    // Transform the returned object to API format
    toApiFormat() {
        return {
            regionId: this.regionId,
            parentId: this.parentId,
            regionName: this.regionName,
            hasSubregions: this.hasSubregions,
        };
    }
}

Hierarchy.init({
    regionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        field: 'region_id'
    },
    parentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'hierarchy',
            key: 'region_id'
        },
        field: 'parent_id'
    },
    hierarchyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'hierarchy_id',
        references: {
            model: 'hierarchy_names',
            key: 'hierarchy_id'
        }
    },
    regionName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'region_name'
    },
}, {
    sequelize,
    modelName: 'Hierarchy',
    tableName: 'hierarchy',
    timestamps: false
});

module.exports = Hierarchy;
