import { useEffect, useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useNavigation } from './NavigationContext';
import { fetchHierarchies } from '../api'; // Make sure this import points to your API fetching logic

/**
 * HierarchySwitcher is a component that provides a button and menu to switch between different
 * hierarchy views. It utilizes the NavigationContext to manage state, fetching hierarchies,
 * and handling user interactions.
 *
 * There are no parameters for this function. It creates its own state and context from the component.
 *
 * @return {JSX.Element} A button and menu for selecting hierarchies within the application.
 */
function HierarchySwitcher() {
  const { selectedHierarchy, setSelectedHierarchy, setSelectedRegion } = useNavigation();
  const [hierarchies, setHierarchies] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const [error, setError] = useState(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    const getHierarchies = async () => {
      try {
        const fetchedHierarchies = await fetchHierarchies();
        setHierarchies(fetchedHierarchies);
      } catch (fetchError) {
        console.error('Error fetching hierarchies: ', fetchError);
        setError('An error occurred while fetching hierarchies.');
      }
    };

    getHierarchies();
  }, []);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleHierarchyChange = (hierarchyId) => {
    try {
      setSelectedHierarchy({ hierarchyId });
      // Reset the selected region to the world
      setSelectedRegion({
        id: null,
        name: 'World',
        info: {},
        hasSubregions: false,
      });
      handleClose();
      setError(null);
    } catch (handleError) {
      console.error(`Error updating hierarchy to ${hierarchyId}: `, handleError);
      setError("We're unable to switch the hierarchy right now. Please check your connection and try again.");
    }
  };

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <Button
        aria-controls="hierarchy-menu"
        aria-haspopup="true"
        onClick={handleClick}
      >
        Switch Hierarchy
      </Button>
      <Menu
        id="hierarchy-menu"
        anchorEl={anchorEl}
        keepMounted
        open={open}
        onClose={handleClose}
      >
        {hierarchies.map((hierarchy) => (
          <MenuItem
            key={hierarchy.hierarchyId}
            selected={hierarchy.hierarchyId === selectedHierarchy.hierarchyId}
            onClick={() => handleHierarchyChange(hierarchy.hierarchyId)}
          >
            {hierarchy.hierarchyName}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}

export default HierarchySwitcher;
