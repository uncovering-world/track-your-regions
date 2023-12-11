import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch the root regions for a given hierarchy.
 * @param {number} hierarchyId - The ID of the hierarchy to fetch root regions for.
 * @returns {Object[]|[]} An array of root region objects or an empty array if none are found.
 */
export const fetchRootRegions = async (hierarchyId) => {
  try {
    const response = await api.get('/api/regions/root', { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching root regions:', error);;
    return [];
  }
};

/**
 * Fetch the subregions for a region.
 * @param {number} regionId - The ID of the region to fetch subregions for.
 * @param {number} hierarchyId - The ID of the hierarchy the region belongs to.
 * @returns {Object|null} A list of subregion objects or null if there are no subregions.
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
 * Fetch details for a specific region.
 * @param {number} regionId - The ID of the region to fetch details for.
 * @param {number} hierarchyId - The ID of the hierarchy the region belongs to.
 * @returns {Object|[]} The region object or an empty array if no data is found.
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
 * Fetch the geometry for a region. Returns null if no geometry is found.
 * @param {number} regionId - The ID of the region.
 * @param {number} hierarchyId - The ID of the hierarchy.
 * @param {boolean} force - Whether to force the fetch operation.
 * @returns {Object|null} The region's geometry data or null if no geometry is found.
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
    throw new Error('Error fetching region geometry: ' + error.message);
  }
};

/**
 * Fetch the ancestor regions for a given region in the hierarchy.
 * @param {number} regionId - The ID of the region to fetch ancestors for.
 * @param {number} hierarchyId - The ID of the hierarchy the region belongs to.
 * @returns {Object[]|[]} An array of ancestor region objects or an empty array if none are found.
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
 * Fetch the list of hierarchies.
 * @returns {Object[]|[]} An array of hierarchy objects or an empty array if none are found.
 */
export const fetchHierarchies = async () => {
  try {
    const response = await api.get('/api/regions/hierarchies');
    return response.data;
  } catch (error) {
    console.error('Error fetching hierarchies:', error);;
    return [];
  }
};
