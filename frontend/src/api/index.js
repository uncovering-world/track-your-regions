import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const fetchRootRegions = async (hierarchyId) => {
  try {
    const response = await api.get('/api/regions/root', { params: { hierarchyId } });
    return response.data;
  } catch (error) {
    console.error('Error fetching root regions:', error);
    return [];
  }
};

export const fetchSiblings = async (regionId, hierarchyId) => {
  try {
    const response = await api.get(`/api/regions/${regionId}/siblings`, { params: { hierarchyId } });
    if (response.status === 404) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching siblings:', error);
    return [];
  }
};

export const fetchSubregions = async (regionId, hierarchyId) => {
  try {
    const response = await api.get(`/api/regions/${regionId}/subregions`, { params: { hierarchyId } });
    if (response.status === 204) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching subregions:', error);
    return [];
  }
};

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

export const fetchSearchResults = async (query, hierarchyId) => {
  try {
    const response = await api.get('/api/regions/search', { params: { query, hierarchyId } });
    if (response.status === 204) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching search results:', error);
    return [];
  }
};

// Views API functions

export const fetchViews = async (hierarchyId, includeInactive = false) => {
  try {
    const response = await api.get('/api/views', { params: { hierarchyId, includeInactive } });
    if (response.status === 204) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching views:', error);
    return [];
  }
};

export const fetchView = async (viewId) => {
  try {
    const response = await api.get(`/api/views/${viewId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching view:', error);
    return null;
  }
};

export const fetchViewRegions = async (viewId) => {
  try {
    const response = await api.get(`/api/views/${viewId}/regions`);
    if (response.status === 204) {
      return [];
    }
    return response.data;
  } catch (error) {
    console.error('Error fetching view regions:', error);
    return [];
  }
};

export const createView = async (name, description, hierarchyId, isActive = true) => {
  try {
    const response = await api.post('/api/views', {
      name,
      description,
      hierarchyId,
      isActive,
    });
    return response.data;
  } catch (error) {
    console.error('Error creating view:', error);
    throw new Error(`Error creating view: ${error.message}`);
  }
};

export const updateView = async (viewId, updates) => {
  try {
    const response = await api.put(`/api/views/${viewId}`, updates);
    return response.data;
  } catch (error) {
    console.error('Error updating view:', error);
    throw new Error(`Error updating view: ${error.message}`);
  }
};

export const deleteView = async (viewId) => {
  try {
    const response = await api.delete(`/api/views/${viewId}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting view:', error);
    throw new Error(`Error deleting view: ${error.message}`);
  }
};

export const addRegionsToView = async (viewId, regions) => {
  try {
    const response = await api.post(`/api/views/${viewId}/regions`, { regions });
    return response.data;
  } catch (error) {
    console.error('Error adding regions to view:', error);
    throw new Error(`Error adding regions to view: ${error.message}`);
  }
};

export const removeRegionsFromView = async (viewId, regions) => {
  try {
    const response = await api.delete(`/api/views/${viewId}/regions`, { data: { regions } });
    return response.data;
  } catch (error) {
    console.error('Error removing regions from view:', error);
    throw new Error(`Error removing regions from view: ${error.message}`);
  }
};
