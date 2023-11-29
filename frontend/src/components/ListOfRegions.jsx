import React, { useState, useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { Box } from '@mui/material';
import { fetchRootRegions, fetchSubregions } from '../api';
import { useNavigation } from './NavigationContext';

function ListOfRegions() {
  const { selectedRegion, setSelectedRegion, selectedHierarchy } = useNavigation();
  const [regions, setRegions] = useState([]);

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

  const handleItemClick = (region) => {
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
    <Box style={{ height: '400px', overflow: 'auto' }}>
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
