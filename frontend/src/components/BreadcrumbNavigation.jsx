import React, { useEffect, useState } from 'react';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import { ButtonBase, Typography } from '@mui/material';
import { useNavigation } from './NavigationContext';
import { fetchAncestors, fetchRegion } from '../api';

/**
 * BreadcrumbNavigation creates a breadcrumb trail for the user to follow back to previous regions.
 * It dynamically fetches and displays parent regions of the currently selected region.
 *
 * There are no parameters for this function. It utilizes state and context from the component.
 *
 * @return {JSX.Element} The breadcrumb trail as a React component.
 */
function BreadcrumbNavigation() {
  const { selectedRegion, setSelectedRegion, selectedHierarchy } = useNavigation();
  const [breadcrumbItems, setBreadcrumbItems] = useState([{ id: null, name: 'World', hasSubregions: true }]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAndSetAncestors = async () => {
      try {
        if (selectedRegion.id !== null && selectedRegion.id !== 0) {
          const ancestors = await fetchAncestors(selectedRegion.id, selectedHierarchy.hierarchyId);
          const reversedAncestors = ancestors.reverse();
          setBreadcrumbItems([{ id: 0, name: 'World', hasSubregions: true }, ...reversedAncestors]);
        } else {
          setBreadcrumbItems([{ id: null, name: 'World', hasSubregions: true }]);
        }
        setError(null);
      } catch (fetchError) {
        console.error('Error fetching ancestors: ', fetchError);
        setError('We encountered an issue while retrieving the region\'s hierarchy. Please try again later.');
      }
    };
    fetchAndSetAncestors();
  }, [selectedRegion, selectedHierarchy]);

  const handleBreadcrumbClick = async (regionId, regionName, index) => {
    try {
      let hasSubregions;
      if (regionId === null || regionId === 0) {
        hasSubregions = true;
      } else {
        const region = await fetchRegion(regionId, selectedHierarchy.hierarchyId);
        hasSubregions = region.hasSubregions;
      }
      setSelectedRegion({
        id: regionId,
        name: regionName,
        hasSubregions,
      });
      // Truncate the breadcrumbItems array up to the clicked index + 1
      setBreadcrumbItems((prevItems) => prevItems.slice(0, index + 1));
      setError(null);
    } catch (fetchError) {
      console.error(`Error fetching region ${regionId}: `, fetchError);
      setError('Unable to load the selected region. Please try selecting a different region or try again later.');
    }
  };

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <Breadcrumbs aria-label="breadcrumb">
        {breadcrumbItems.map((item, index) => (
          <Typography
            color="inherit"
            key={item.id}
            style={{ cursor: 'pointer' }}
          >
            <ButtonBase component="button" onClick={() => handleBreadcrumbClick(item.id, item.name, index)}>
              {item.name}
            </ButtonBase>
          </Typography>
        ))}
      </Breadcrumbs>
    </div>
  );
}

export default BreadcrumbNavigation;
