import React, { useState } from 'react';
import BreadcrumbNavigation from './BreadcrumbNavigation';
import ListOfRegions from './ListOfRegions';
import { Box } from '@mui/material';
import HierarchySwitcher from "./HierarchySwitcher";


const NavigationPane = () => {
    return (
        <Box>
            <HierarchySwitcher/>
            <BreadcrumbNavigation/>
            <ListOfRegions/>
        </Box>
    );
};

export default NavigationPane;
