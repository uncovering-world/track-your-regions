// NavigationContext.jsx
import {
  createContext, useState, useContext, useMemo,
} from 'react';
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

  const value = useMemo(() => ({
    selectedRegion,
    setSelectedRegion,
    selectedHierarchy,
    setSelectedHierarchy,
  }), [selectedRegion, selectedHierarchy]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

NavigationProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
