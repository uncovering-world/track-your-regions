const express = require('express');
const db = require('../db');

/**
 * Fetches all items from the database.
 * @returns {Promise<Array>} A promise that resolves to an array of items.
 */
/**
 * Fetches all items from the database.
 * @returns {Promise<Array>} A promise that resolves to an array of item objects.
 */
async function getAllItems() {
  const items = await db.query('SELECT * FROM items');
  return items.rows;
}

/**
 * Fetches an item by ID from the database.
 * @param {string} id - The ID of the item.
 * @returns {Promise<Object>} A promise that resolves to the item object, or null if no item is found.
 */
/**
 * Fetches an item by ID from the database.
 * @param {string} id - The unique identifier for the item to retrieve.
 * @returns {Promise<Object|null>} A promise that resolves to the item object if found, or null if not.
 */
async function getItemById(id) {
  const items = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return items.rows[0] || null;
}

/**
 * Creates a new item in the database.
 * @param {Object} item - The item to create.
 * @returns {Promise<Object>} A promise that resolves to the created item.
 */
/**
 * Creates a new item in the database.
 * @param {Object} item - The item to be created, containing at least 'name' and 'description' fields.
 * @returns {Promise<Object>} A promise that resolves to the newly created item object.
 */
async function createItem(item) {
  const result = await db.query('INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *', [item.name, item.description]);
  return result.rows[0];
}

module.exports = {
  getAllItems,
  getItemById,
  createItem,
};
