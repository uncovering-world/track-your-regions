import React from 'react';

import { useNavigation } from './NavigationContext';
import RegionMap from './RegionMap';

/**
 * MainDisplay renders the main content area of the application,
 * displaying either the details of the selected region or a prompt
 * when no region is selected.
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
