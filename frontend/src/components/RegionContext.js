// RegionContext.js
import React, { createContext, useState, useContext } from 'react';

const RegionContext = createContext();

export const useRegion = () => {
    return useContext(RegionContext);
};

export const RegionProvider = ({ children }) => {
    const [selectedRegion, setSelectedRegion] = useState({
        id: null,
        name: 'World',
        info: {},
        hasSubregions: false,
    });

    return (
        <RegionContext.Provider value={{ selectedRegion, setSelectedRegion }}>
            {children}
        </RegionContext.Provider>
    );
};
