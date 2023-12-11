import axios from 'axios';

/**
 * Fetches a list of all users from the database.
 * @returns {Promise<Array>} A promise that resolves to an array of user objects.
 */
export const fetchUsers = async () => {
  const response = await axios.get('/api/users');
  return response.data;
};

/**
 * Fetches a user by ID from the database.
 * @param {string} userId - The ID of the user to retrieve.
 * @returns {Promise<Object>} A promise that resolves to the user object.
 */
export const fetchUser = async (userId) => {
  const response = await axios.get(`/api/users/${userId}`);
  return response.data;
};

/**
 * Updates a user's information in the database.
 * @param {string} userId - The ID of the user to update.
 * @param {Object} updates - The updates to apply to the user.
 * @returns {Promise<Object>} A promise that resolves to the updated user object.
 */
export const updateUser = async (userId, updates) => {
  const response = await axios.put(`/api/users/${userId}`, updates);
  return response.data;
};
