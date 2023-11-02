import React, { useState, useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { Box } from '@mui/material';
import { fetchRootRegions, fetchSubregions } from '../api';
import { useRegion } from './RegionContext';

const ListOfRegions = () => {

    const { selectedRegionId, setSelectedRegionId, setSelectedRegionName, selectedRegionHasSubregions, setSelectedRegionHasSubregions } = useRegion();
    const [regions, setRegions] = useState([]);

    const fetchRegions = async (regionId, hasSubregions) => {

        let newRegions = [];
        if (regionId) {
            if (hasSubregions) {
                newRegions = await fetchSubregions(regionId);
            }
        } else {
            newRegions = await fetchRootRegions();
        }

        if (newRegions.length > 0) {
            setRegions(newRegions);
        }
    };

    useEffect(() => {
        fetchRegions(selectedRegionId, selectedRegionHasSubregions);
    }, [selectedRegionId, setSelectedRegionHasSubregions]);

    const handleItemClick = (region) => {
        setSelectedRegionId(region.id);
        setSelectedRegionName(region.name);
        setSelectedRegionHasSubregions(region.hasSubregions);
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
};

export default ListOfRegions;
