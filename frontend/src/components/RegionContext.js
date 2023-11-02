// RegionContext.js
import React, { createContext, useState, useContext } from 'react';

const RegionContext = createContext();

export const useRegion = () => {
    return useContext(RegionContext);
};

export const RegionProvider = ({ children }) => {
    const [selectedRegionId, setSelectedRegionId] = useState(null);
    const [selectedRegionName, setSelectedRegionName] = useState(null);
    const [selectedRegionInfo, setSelectedRegionInfo] = useState({});
    const [selectedRegionHasSubregions, setSelectedRegionHasSubregions] = useState(false);

    return (
        <RegionContext.Provider
            value={{
                selectedRegionId,
                setSelectedRegionId,
                selectedRegionName,
                setSelectedRegionName,
                selectedRegionInfo,
                setSelectedRegionInfo,
                selectedRegionHasSubregions,
                setSelectedRegionHasSubregions,
            }}
        >
            {children}
        </RegionContext.Provider>
    );
};
