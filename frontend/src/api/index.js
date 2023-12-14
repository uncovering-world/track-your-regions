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
 * @returns {Promise<Array>} A promise that resolves to an array of root regions.
 */
export const fetchRootRegions = async (hierarchyId) => {
  try {
    const response = await api.get('/api/regions/root', { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching root regions:', error);
    return [];
  }
};

/**
 * Fetches the subregions for a given region within a specified hierarchy.
 * @param {number} regionId - The ID of the parent region.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Promise<Array|null>} A promise that resolves to an array of subregions, or null if there are no subregions.
 */
export const fetchSubregions = async (regionId, hierarchyId) => {
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
 * @returns {Promise<Object>} A promise that resolves to an object containing region details.
 */
export const fetchRegion = async (regionId, hierarchyId) => {
  try {
    const response = await api.get(`/api/regions/${regionId}`, { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching region:', error);
    return [];
  }
};

// Fetch the geometry for a region. Returns null if no geometry is found.
/**
 * Fetches the geographic geometry for a region.
 * @param {number} regionId - The ID of the region.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @param {boolean} force - Whether to force the resolution of empty geometries.
 * @returns {Promise<Object|null>} A promise that resolves to an object containing the geometry details, or null if none found.
 */
export const fetchRegionGeometry = async (regionId, hierarchyId, force) => {
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
 * Fetches the ancestor regions of a given region within a specified hierarchy.
 * @param {number} regionId - The ID of the region.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @returns {Promise<Array>} A promise that resolves to an array of ancestor regions.
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
 * Fetches all available hierarchies.
 * @returns {Promise<Array>} A promise that resolves to an array of hierarchy objects.
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
