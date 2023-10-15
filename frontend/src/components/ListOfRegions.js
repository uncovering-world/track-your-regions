import React, { useState, useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { Box } from '@mui/material';
import { fetchRootRegions, fetchSubregions } from '../api';
import { useRegion } from './RegionContext';

const ListOfRegions = () => {

    const { selectedRegionId, setSelectedRegionId, setSelectedRegionName } = useRegion();
    const [regions, setRegions] = useState([]);

    const fetchRegions = async (regionId) => {

        let newRegions = [];
        if (regionId) {
            newRegions = await fetchSubregions(regionId);
        } else {
            newRegions = await fetchRootRegions();
        }

        setRegions(newRegions);
    };

    useEffect(() => {
        fetchRegions(selectedRegionId).then(r => console.log(r));
    }, [selectedRegionId]);

    const handleItemClick = (regionId, regionName, hasSubregions) => {
        if (hasSubregions) {
            setSelectedRegionId(regionId);
        }
        setSelectedRegionName(regionName);
    };

    return (
        <Box style={{ height: '400px', overflow: 'auto' }}>
            <List>
                {regions.map((region) => (
                    <ListItem key={region.id} button onClick={() => handleItemClick(region.id, region.name, region.hasSubregions)}>
                        {region.name}
                    </ListItem>
                ))}
            </List>
        </Box>
   );
};

export default ListOfRegions;
