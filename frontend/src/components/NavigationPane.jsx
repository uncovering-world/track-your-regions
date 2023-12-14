import React from 'react';
import { Box } from '@mui/material';
import BreadcrumbNavigation from './BreadcrumbNavigation';
import ListOfRegions from './ListOfRegions';
import HierarchySwitcher from './HierarchySwitcher';

/**
 * NavigationPane is a layout component that renders the navigation side panel,
 * including hierarchy switcher, breadcrumb navigation, and list of regions.
 */
function NavigationPane() {
  return (
    <Box>
      <HierarchySwitcher />
      <BreadcrumbNavigation />
      <ListOfRegions />
    </Box>
  );
}

export default NavigationPane;
