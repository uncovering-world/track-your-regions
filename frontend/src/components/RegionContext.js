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

    return (
        <RegionContext.Provider
            value={{
                selectedRegionId,
                setSelectedRegionId,
                selectedRegionName,
                setSelectedRegionName,
                selectedRegionInfo,
                setSelectedRegionInfo
            }}
        >
            {children}
        </RegionContext.Provider>
    );
};
