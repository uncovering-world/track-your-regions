// NavigationContext.jsx
import React, { createContext, useState, useContext } from 'react';
import PropTypes from 'prop-types';

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

NavigationProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
