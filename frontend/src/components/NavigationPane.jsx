import React, { useState } from 'react';
import { Box } from '@mui/material';
import BreadcrumbNavigation from './BreadcrumbNavigation';
import ListOfRegions from './ListOfRegions';
import HierarchySwitcher from './HierarchySwitcher';

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
