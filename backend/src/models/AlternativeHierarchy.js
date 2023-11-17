const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/db');

class AlternativeHierarchy extends Model {}

AlternativeHierarchy.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    parent_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'alternative_hierarchy',
            key: 'id'
        }
    },
    hierarchy_type: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    region_group_name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    }
}, {
    sequelize,
    modelName: 'AlternativeHierarchy',
    tableName: 'alternative_hierarchy',
    timestamps: false
});


module.exports = AlternativeHierarchy;
