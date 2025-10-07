import React, { useState, useEffect } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useNavigation } from './NavigationContext';
import { fetchViews, fetchViewRegions } from '../api';

/**
 * ViewSelector is a component that allows users to select a view
 * to filter the list of regions based on specific grouping criteria.
 */
function ViewSelector() {
  const { selectedHierarchy, setSelectedRegion } = useNavigation();
  const [views, setViews] = useState([]);
  const [selectedView, setSelectedView] = useState('');

  useEffect(() => {
    const loadViews = async () => {
      try {
        const fetchedViews = await fetchViews(selectedHierarchy.hierarchyId);
        setViews(fetchedViews);
      } catch (error) {
        console.error('Error loading views:', error);
      }
    };

    if (selectedHierarchy.hierarchyId) {
      loadViews();
    }
  }, [selectedHierarchy.hierarchyId]);

  const handleViewChange = async (event) => {
    const viewId = event.target.value;
    setSelectedView(viewId);

    if (!viewId) {
      // Reset to show all regions (clear any view filter)
      setSelectedRegion({
        id: null,
        name: '',
        info: null,
        hasSubregions: false,
      });
      return;
    }

    try {
      const regions = await fetchViewRegions(viewId);
      if (regions.length > 0) {
        // When a view is selected, we could either:
        // 1. Show the first region in the view
        // 2. Keep the current region if it's in the view
        // 3. Reset to show all regions in the view
        // For now, we'll reset to show all regions in the view
        const selectedViewObj = views.find((v) => v.id === viewId);
        setSelectedRegion({
          id: null,
          name: '',
          info: selectedViewObj ? `Viewing: ${selectedViewObj.name}` : '',
          hasSubregions: false,
        });
      }
    } catch (error) {
      console.error('Error loading view regions:', error);
    }
  };

  if (views.length === 0) {
    return null; // Don't show the selector if there are no views
  }

  return (
    <Box sx={{ padding: '10px', marginBottom: '10px' }}>
      <FormControl fullWidth size="small">
        <InputLabel id="view-selector-label">Filter by View</InputLabel>
        <Select
          labelId="view-selector-label"
          id="view-selector"
          value={selectedView}
          label="Filter by View"
          onChange={handleViewChange}
        >
          <MenuItem value="">
            <em>All Regions</em>
          </MenuItem>
          {views.map((view) => (
            <MenuItem key={view.id} value={view.id}>
              {view.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}

export default ViewSelector;
