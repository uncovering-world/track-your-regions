const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/db');

class ViewRegionMapping extends Model {
  // Transform the returned object to API format
  toApiFormat() {
    return {
      viewId: this.viewId,
      regionId: this.regionId,
      hierarchyId: this.hierarchyId,
    };
  }
}

ViewRegionMapping.init({
  viewId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    field: 'view_id',
    references: {
      model: 'views',
      key: 'id',
    },
  },
  regionId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    field: 'region_id',
  },
  hierarchyId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    field: 'hierarchy_id',
  },
}, {
  sequelize,
  modelName: 'ViewRegionMapping',
  tableName: 'view_region_mapping',
  timestamps: false,
});

module.exports = ViewRegionMapping;
