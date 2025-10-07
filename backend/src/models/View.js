const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/db');

class View extends Model {
  // Transform the returned object to API format
  toApiFormat() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      hierarchyId: this.hierarchyId,
      isActive: this.isActive,
    };
  }
}

View.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'id',
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'name',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'description',
  },
  hierarchyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'hierarchy_id',
    references: {
      model: 'hierarchy_names',
      key: 'hierarchy_id',
    },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
  },
}, {
  sequelize,
  modelName: 'View',
  tableName: 'views',
  timestamps: false,
});

module.exports = View;
