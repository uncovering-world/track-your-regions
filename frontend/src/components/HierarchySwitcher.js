import { useEffect, useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useNavigation } from './NavigationContext';
import { fetchHierarchies } from '../api';  // Make sure this import points to your API fetching logic

const HierarchySwitcher = () => {
  const { selectedHierarchy, setSelectedHierarchy } = useNavigation();
  const [hierarchies, setHierarchies] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    const getHierarchies = async () => {
      try {
        const hierarchies = await fetchHierarchies();
        setHierarchies(hierarchies);
      } catch (error) {
        console.error("Error fetching hierarchies:", error);
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
          {hierarchies.map(hierarchy => (
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
};

export default HierarchySwitcher;
