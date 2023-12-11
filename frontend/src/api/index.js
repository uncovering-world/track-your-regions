import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetches an array of root regions for a given hierarchy.
 * @param {string} hierarchyId - The unique identifier for the hierarchy to fetch root regions for.
 * @return {Promise<Array>} A promise that resolves to an array of root regions.
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
 * Fetches an array of subregions for a given region within a hierarchy, or null if no subregions exist.
 * @param {string} regionId - The unique identifier for the region to fetch subregions for.
 * @param {string} hierarchyId - The unique identifier for the hierarchy that the region is part of.
 * @return {Promise<Array|null>} A promise that resolves to an array of subregions or null.
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
 * Fetches the data for a specific region within a hierarchy.
 * @param {string} regionId - The unique identifier for the region to fetch data for.
 * @param {string} hierarchyId - The unique identifier for the hierarchy that the region is part of.
 * @return {Promise<Object>} A promise that resolves to the data of the region.
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

/**
 * Fetches the geometry data for a specific region within a hierarchy.
 * @param {string} regionId - The unique identifier for the region to fetch geometry for.
 * @param {string} hierarchyId - The unique identifier for the hierarchy that the region is part of.
 * @param {boolean} [force=false] - A flag that influences whether to resolve with null when no geometry is found.
 * @return {Promise<Object|null>} A promise that resolves to the geometry data of the region or null.
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
 * Fetches an array of ancestor regions for a specific region within a hierarchy.
 * @param {string} regionId - The unique identifier for the region to fetch ancestors for.
 * @param {string} hierarchyId - The unique identifier for the hierarchy that the region is part of.
 * @return {Promise<Array>} A promise that resolves to an array of ancestor regions.
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
 * Fetches an array of hierarchies available in the system.
 * @return {Promise<Array>} A promise that resolves to an array of hierarchies.
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
