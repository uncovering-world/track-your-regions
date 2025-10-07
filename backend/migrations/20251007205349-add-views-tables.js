/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create views table
    await queryInterface.createTable('views', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      hierarchy_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'hierarchy_names',
          key: 'hierarchy_id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    });

    // Create view_region_mapping table
    await queryInterface.createTable('view_region_mapping', {
      view_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'views',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      region_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      hierarchy_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
    });

    // Add foreign key constraint for region_id and hierarchy_id composite key
    await queryInterface.addConstraint('view_region_mapping', {
      fields: ['region_id', 'hierarchy_id'],
      type: 'foreign key',
      name: 'fk_view_region_mapping_hierarchy',
      references: {
        table: 'hierarchy',
        fields: ['region_id', 'hierarchy_id'],
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    // Create indexes for better query performance
    await queryInterface.addIndex('views', ['hierarchy_id'], {
      name: 'idx_views_hierarchy_id',
    });

    await queryInterface.addIndex('view_region_mapping', ['view_id'], {
      name: 'idx_view_region_mapping_view_id',
    });

    await queryInterface.addIndex('view_region_mapping', ['region_id', 'hierarchy_id'], {
      name: 'idx_view_region_mapping_region_hierarchy',
    });
  },

  async down(queryInterface) {
    // Drop indexes
    await queryInterface.removeIndex('view_region_mapping', 'idx_view_region_mapping_region_hierarchy');
    await queryInterface.removeIndex('view_region_mapping', 'idx_view_region_mapping_view_id');
    await queryInterface.removeIndex('views', 'idx_views_hierarchy_id');

    // Drop tables in reverse order
    await queryInterface.dropTable('view_region_mapping');
    await queryInterface.dropTable('views');
  },
};
