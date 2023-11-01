const { Model, DataTypes, QueryTypes} = require('sequelize');
const sequelize = require("../config/db");

class Region extends Model {
    static async getAncestors(regionId) {
        return await sequelize.query(`
            WITH RECURSIVE Ancestors AS (
                SELECT id, parent_region_id as parentRegionId, name
                FROM regions
                WHERE id = :regionId
                UNION ALL
                SELECT r.id, r.parent_region_id as parentRegionId, r.name
                FROM regions r
                INNER JOIN Ancestors a ON r.id = a.parentRegionId
            )
            SELECT * FROM Ancestors;
        `, {
            replacements: { regionId },
            type: QueryTypes.SELECT
        });
    }
    
    // Transform the returned object to API format
    toApiFormat() {
        return {
            id: this.id,
            name: this.name,
            parentRegionId: this.parentRegionId,
            hasSubregions: this.hasSubregions,
        };
    }
}

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
    },
    geom: {
        type: DataTypes.GEOMETRY('MULTIPOLYGON', 4326),
        allowNull: true,
        field: 'geom'
    }
}, {
    sequelize,
    tableName: 'regions',
    timestamps: false, // Don't add the timestamp attributes (updatedAt, createdAt)
});

module.exports = Region;
