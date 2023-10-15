// MainPane.js
import React, { useEffect } from 'react';
import { useRegion } from './RegionContext';
import { fetchRegion } from '../api';

const MainDisplay = () => {
    const { selectedRegionId, selectedRegionName, setSelectedRegionInfo } = useRegion();

    useEffect(() => {
        const fetchSelectedRegionInfo = async () => {
            if (selectedRegionId !== null) {
                const info = await fetchRegion(selectedRegionId);
                setSelectedRegionInfo(info.regionName);
            }
        };

        fetchSelectedRegionInfo();
    }, [selectedRegionId]);

    return (
        <div>
            {selectedRegionName && <h1>{selectedRegionName}</h1>}
            {/* Render detailed information about the selected region */}
        </div>
    );
};

export default MainDisplay;
