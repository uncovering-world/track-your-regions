'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('regions', 'createdAt', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: new Date()
    });
    await queryInterface.addColumn('regions', 'updatedAt', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: new Date()
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('regions', 'createdAt');
    await queryInterface.removeColumn('regions', 'updatedAt');
  }
};
