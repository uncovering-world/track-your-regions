import React from 'react';

import { useNavigation } from './NavigationContext';
import RegionMap from './RegionMap';

/**
 * MainDisplay is a functional component that renders the main display area of the application.
 * It shows details of the selected region including its name and an associated region map if available,
 * otherwise it shows a message indicating that no region is selected.
 * @returns {ReactElement} React element that represents the main display area.
 */
function MainDisplay() {
  const { selectedRegion } = useNavigation();

  return (
    <div>
      {selectedRegion.name ? (
        <>
          <h1>{selectedRegion.name}</h1>
          <RegionMap />
        </>
      ) : (
        <p>No region selected.</p>
      )}
    </div>
  );
}

export default MainDisplay;
