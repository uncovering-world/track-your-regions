import axios from 'axios';

/**
 * Fetches a list of all users.
 * @returns {Array} An array of user objects.
 */
export const fetchUsers = async () => {
  const response = await axios.get('/api/users');
  return response.data;
};

/**
 * Fetches a user by ID.
 * @param {string} userId - The ID of the user.
 * @returns {Object} The user object.
 */
export const fetchUser = async (userId) => {
  const response = await axios.get(`/api/users/${userId}`);
  return response.data;
};

/**
 * Updates a user's information.
 * @param {string} userId - The ID of the user.
 * @param {Object} updates - The updates to apply to the user.
 * @returns {Object} The updated user object.
 */
export const updateUser = async (userId, updates) => {
  const response = await axios.put(`/api/users/${userId}`, updates);
  return response.data;
};
