// NavigationContext.js
import React, { createContext, useState, useContext } from 'react';

const NavigationContext = createContext();

export const useNavigation = () => useContext(NavigationContext);

export function NavigationProvider({ children }) {
  const [selectedRegion, setSelectedRegion] = useState({
    id: null,
    name: 'World',
    info: {},
    hasSubregions: false,
  });

  const [selectedHierarchy, setSelectedHierarchy] = useState({
    hierarchyId: 1,
  });

  return (
    <NavigationContext.Provider value={{
      selectedRegion,
      setSelectedRegion,
      selectedHierarchy,
      setSelectedHierarchy,
    }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
