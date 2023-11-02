// MainPane.js
import React, { useEffect } from 'react';
import { useRegion } from './RegionContext';
import { fetchRegion } from '../api';
import RegionMap from "./RegionMap";

const MainDisplay = () => {
    const { selectedRegionId, selectedRegionName, setSelectedRegionInfo } = useRegion();

    useEffect(() => {
        const fetchSelectedRegionInfo = async () => {
            if (selectedRegionId !== null && selectedRegionId !== 0) {
                const info = await fetchRegion(selectedRegionId);
                setSelectedRegionInfo(info.regionName);
            }
        };

        fetchSelectedRegionInfo();
    }, [selectedRegionId]);

    return (
        <div>
            {selectedRegionName && <h1>{selectedRegionName}</h1>}
            {selectedRegionName && <RegionMap/>}
        </div>
    );
};

export default MainDisplay;
