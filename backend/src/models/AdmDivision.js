const { Model, DataTypes, QueryTypes} = require('sequelize');
const sequelize = require("../config/db");

class AdmDivision extends Model {
    static async getAncestors(regionId) {
        return await sequelize.query(`
            WITH RECURSIVE Ancestors AS (
                SELECT id, parent_id as parentId, name
                FROM adm_divisions
                WHERE id = :id
                UNION ALL
                SELECT ad.id, ad.parent_id as parentId, ad.name
                FROM adm_divisions ad
                INNER JOIN Ancestors a ON ad.id = a.parentId
            )
            SELECT * FROM Ancestors;
        `, {
            replacements: { id },
            type: QueryTypes.SELECT
        });
    }
    
    // Transform the returned object to API format
    toApiFormat() {
        return {
            id: this.id,
            name: this.name,
            parentId: this.parentId,
            hasChildren: this.hasChildren,
        };
    }
}

AdmDivision.init({
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
    parentId: {
        type: DataTypes.INTEGER,
        field: 'parent_id',
        references: {
            model: 'adm_divisions',
            key: 'id'
        },
        allowNull: true
    },
    hasChildren: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'has_children'
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
    tableName: 'adm_divisions',
    timestamps: false, // Don't add the timestamp attributes (updatedAt, createdAt)
});

module.exports = AdmDivision;
