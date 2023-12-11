import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetches the root regions for a given hierarchy.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Array} An array of root regions.
 */
/**
 * Fetches all users from the database.
 * @returns {Promise<Array>} A promise that resolves to an array of user objects.
 */
export const fetchUsers = async () => {
  try {
    const response = await api.get('/api/regions/root', { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching root regions:', error);
    return [];
  }
};

/**
 * Fetches the subregions of a specific region within a hierarchy.
 * @param {number} regionId - The ID of the region to find subregions for.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Array|null} An array of subregions, or null if no subregions are found.
 */
/**
 * Fetches a user by ID from the database.
 * @param {string} userId - The ID of the user to retrieve.
 * @returns {Promise<Object>} A promise that resolves to the user object.
 */
export const fetchUser = async (userId) => {
  try {
    const response = await api.get(`/api/regions/${regionId}/subregions`, { params: { hierarchyId } });
    if (response.status === 204) {
      return null;
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching subregions:', error);
    return [];
  }
};

/**
 * Fetches detailed information about a specific region.
 * @param {number} regionId - The ID of the region.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Object} An object containing the detailed information of the region.
 */
/**
 * Updates a user's information in the database.
 * @param {string} userId - The ID of the user to update.
 * @param {Object} updates - The updates to apply to the user.
 * @returns {Promise<Object>} A promise that resolves to the updated user object.
 */
export const updateUser = async (userId, updates) => {
  try {
    const response = await api.get(`/api/regions/${regionId}`, { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching region:', error);
    return [];
  }
};

// Fetch the geometry for a region. Returns null if no geometry is found.
export const fetchRegionGeometry = async (regionId, hierarchyId, force) => {
  // Ensure the inputs are integers before making an API call
  regionId = parseInt(regionId, 10);
  hierarchyId = parseInt(hierarchyId, 10);
  try {
    const response = await api.get(`/api/regions/${regionId}/geometry`, { params: { resolveEmpty: force, hierarchyId } });
    if (response.status === 204 || response.status === 404) {
      return null;
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching region geometry:', error);
    throw new Error(`Error fetching region geometry: ${error.message}`);
  }
};

/**
 * Fetches the ancestor regions for a given region within a hierarchy.
 * @param {number} regionId - The ID of the region to find ancestors for.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Array} An array of ancestor regions.
 */
export const fetchAncestors = async (regionId, hierarchyId) => {
  try {
    const response = await api.get(`/api/regions/${regionId}/ancestors`, { params: { hierarchyId } });
    if (response.status === 204) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching ancestors:', error);
    return [];
  }
};

/**
 * Fetches a list of available region hierarchies.
 * @returns {Array} An array of hierarchy objects.
 */
export const fetchHierarchies = async () => {
  try {
    const response = await api.get('/api/regions/hierarchies');
    return response.data;
  } catch (error) {
    console.error('Error fetching hierarchies:', error);
    return [];
  }
};
