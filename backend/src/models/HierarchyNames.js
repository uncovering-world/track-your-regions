const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/db');

class HierarchyNames extends Model {
  // Transform the returned object to API format
  toApiFormat() {
    return {
      hierarchyId: this.hierarchyId,
      hierarchyName: this.hierarchyName,
    };
  }
}

HierarchyNames.init(
  {
    hierarchyId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      field: 'hierarchy_id',
    },
    hierarchyName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'hierarchy_name',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'is_active',
    },
  },
  {
    sequelize,
    modelName: 'HierarchyNames',
    tableName: 'hierarchy_names',
    timestamps: false,
  },
);

module.exports = HierarchyNames;
