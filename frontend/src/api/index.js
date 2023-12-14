import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetches the root regions for a given hierarchy.
 * @param {Number} hierarchyId - The ID of the hierarchy to fetch root regions for.
 * @returns {Array} - An array of root regions for the given hierarchy.
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
 * Fetches the subregions for a given region and hierarchy.
 * @param {Number} regionId - The ID of the region to fetch subregions for.
 * @param {Number} hierarchyId - The ID of the hierarchy to which the region belongs.
 * @returns {Array|null} - An array of subregions for the given region and hierarchy,
 * or null if no subregions are found.
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
 * Fetches a region for a given region ID and hierarchy ID.
 * @param {Number} regionId - The ID of the region to fetch.
 * @param {Number} hierarchyId - The ID of the hierarchy to which the region belongs.
 * @returns {Object} - The region object for the given region ID and hierarchy ID.
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
 * Fetches the geometry for a given region, hierarchy, and force flag.
 * @param {Number} regionId - The ID of the region to fetch the geometry for.
 * @param {Number} hierarchyId - The ID of the hierarchy to which the region belongs.
 * @param {Boolean} force - If true, resolve empty geometry.
 * @returns {Object|null} - The geometry object for the given region and hierarchy, or null if no geometry is found.
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

export const fetchHierarchies = async () => {
  try {
    const response = await api.get('/api/regions/hierarchies');
    return response.data;
  } catch (error) {
    console.error('Error fetching hierarchies:', error);
    return [];
  }
};
