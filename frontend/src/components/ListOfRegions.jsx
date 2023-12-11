import React, { useState, useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { Box } from '@mui/material';
import { fetchRootRegions, fetchSubregions } from '../api';
import { useNavigation } from './NavigationContext';

function ListOfRegions() {
  const { selectedRegion, setSelectedRegion, selectedHierarchy } = useNavigation();
  const [regions, setRegions] = useState([]);

  /**
 * Fetches the regions based on the selected region and hierarchy context.
 * If regionId is provided and hasSubregions is true, it fetches subregions,
 * otherwise, it fetches root regions.
 * @param {number|null} regionId - The ID of the selected region, or null.
 * @param {boolean} hasSubregions - Indicates if selected region has subregions.
 * @returns {Promise<void>} No return value, updates the regions state directly.
 */
const fetchRegions = async (regionId, hasSubregions) => {
    let newRegions = [];
    if (regionId) {
      if (hasSubregions) {
        newRegions = await fetchSubregions(regionId, selectedHierarchy.hierarchyId);
      }
    } else {
      newRegions = await fetchRootRegions(selectedHierarchy.hierarchyId);
    }

    if (newRegions.length > 0) {
      setRegions(newRegions);
    }
  };

  useEffect(() => {
    fetchRegions(selectedRegion.id, selectedRegion.hasSubregions);
  }, [selectedRegion, selectedHierarchy]);

  /**
 * Handles click events on region list items.
 * Updates the selectedRegion context when a new region is selected.
 * @param {Object} region - The region object corresponding to the clicked list item.
 * @returns {void} No return value.
 */
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
