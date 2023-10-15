import React, { useState } from 'react';
import BreadcrumbNavigation from './BreadcrumbNavigation';
import ListOfRegions from './ListOfRegions';
import { Box } from '@mui/material';


const NavigationPane = () => {
    return (
        <Box>
            <BreadcrumbNavigation/>
            <ListOfRegions/>
        </Box>
    );
};

export default NavigationPane;
