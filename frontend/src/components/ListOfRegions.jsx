import React, { useState, useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { Box } from '@mui/material';
import { fetchAncestors, fetchRootRegions, fetchSubregions } from '../api';
import { useNavigation } from './NavigationContext';

/**
 * `ListOfRegions` is a component that displays a list of clickable regions.
 *
 * It makes use of the `NavigationContext` for managing the state and handles the selection
 * of regions based on user interaction. It fetches the root or subregions depending on
 * the selected region and hierarchy context. This component does not take parameters.
 *
 * @return {JSX.Element} A box containing the list of regions, with potential error messaging.
 */
function ListOfRegions() {
  const { selectedRegion, setSelectedRegion, selectedHierarchy } = useNavigation();
  const [regions, setRegions] = useState([]);
  const [error, setError] = useState(null);

  const fetchRegions = async (regionId, hasSubregions) => {
    let newRegions = [];
    try {
      if (regionId) {
        if (hasSubregions) {
          newRegions = await fetchSubregions(regionId, selectedHierarchy.hierarchyId);
        } else {
          // Fecth the siblings of the selected region
          // TODO: do not fetch the siblings if they are already fetched
          // First - fetch the parent of the selected region
          // TODO: add a dedicated API endpoint for fetching siblings
          const ancestors = await fetchAncestors(regionId, selectedHierarchy.hierarchyId);
          // The parent is the second item in the ancestors array as the
          // first item is the region itself.
          if (!ancestors || ancestors.length < 2) {
            setError('Unable to find the parent region, and hence the siblings.');
            return;
          }
          const parent = ancestors[1];
          // Then fetch the subregions of the parent
          newRegions = await fetchSubregions(parent.id, selectedHierarchy.hierarchyId);
        }
      } else {
        newRegions = await fetchRootRegions(selectedHierarchy.hierarchyId);
      }

      if (newRegions.length > 0) {
        setRegions(newRegions);
      }
      setError(null);
    } catch (fetchError) {
      console.error('Error fetching regions: ', fetchError);
      setError('An error occurred while fetching regions.');
    }
  };

  useEffect(() => {
    fetchRegions(selectedRegion.id, selectedRegion.hasSubregions);
  }, [selectedRegion, selectedHierarchy]);

  const handleItemClick = (region) => {
    if (region.id === selectedRegion.id) {
      return;
    }
    setSelectedRegion(
      {
        id: region.id,
        name: region.name,
        info: selectedRegion.info,
        hasSubregions: region.hasSubregions,
      },
    );
  };

  return (
    <Box sx={{ height: '400px', overflow: 'auto' }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <List>
        {regions.map((region) => (
          <ListItem key={region.id} button onClick={() => handleItemClick(region)}>
            {region.name}
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

export default ListOfRegions;
