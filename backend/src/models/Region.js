const { Model, DataTypes } = require('sequelize');
const sequelize = require("../config/db");

class Region extends Model {}

Region.init({
    id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        field: 'id'
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'name'
    },
    parentRegionId: {
        type: DataTypes.INTEGER,
        field: 'parent_region_id',
        references: {
            model: 'regions',
            key: 'id'
        },
        allowNull: true
    },
    hasSubregions: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'has_subregions'
    },
    gadmUid: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'gadm_uid'
    }
}, {
    sequelize,
    tableName: 'regions',
});

module.exports = Region;
