import axios from 'axios';

const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
    headers: {
        'Content-Type': 'application/json',
    },
});


export const fetchRootRegions = async () => {
    try {
        const response = await api.get('/api/regions/root');
        return response.data;
    } catch (error) {
        console.error('Error fetching root regions:', error);
        return [];
    }
};

export const fetchSubregions = async (regionId) => {
    try {
        const response = await api.get(`/api/regions/${regionId}/subregions`);
        if (response.status === 204) {
            return null;
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching subregions:', error);
        return [];
    }
}

export const fetchRegion = async (regionId) => {
    try {
        const response = await api.get(`/api/regions/${regionId}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching region:', error);
        return [];
    }
}

// Fetch the geometry for a region. Returns null if no geometry is found.
export const fetchRegionGeometry = async (regionId, force) => {
    try {
        const response = await api.get(`/api/regions/${regionId}/geometry`, {params: {resolveEmpty: force}});
        if (response.status === 204 || response.status === 404) {
            return null;
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching region geometry:', error);
        throw new Error(`Error fetching region geometry: ${error.message}`);
    }
}

export const fetchAncestors = async (regionId) => {
    try {
        const response = await api.get(`/api/regions/${regionId}/ancestors`);
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
}