import { useEffect, useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useNavigation } from './NavigationContext';
import { fetchHierarchies } from '../api'; // Make sure this import points to your API fetching logic

function HierarchySwitcher() {
  const { selectedHierarchy, setSelectedHierarchy, setSelectedRegion } = useNavigation();
  const [hierarchies, setHierarchies] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    const getHierarchies = async () => {
      try {
        const fetchedHierarchies = await fetchHierarchies();
        setHierarchies(fetchedHierarchies);
      } catch (error) {
        console.error('Error fetching hierarchies:', error);
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
    setSelectedHierarchy({ hierarchyId });
    // Reset the selected region to the world
    setSelectedRegion({
      id: null,
      name: 'World',
      info: {},
      hasSubregions: false,
    });
    handleClose();
  };

  return (
    <div>
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
