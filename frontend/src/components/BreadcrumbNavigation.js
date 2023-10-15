import React, { useEffect, useState } from 'react';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import { Typography } from "@mui/material";
import { useRegion } from './RegionContext';
import { fetchAncestors } from '../api';

const BreadcrumbNavigation = () => {
    const { setSelectedRegionId, setSelectedRegionName, selectedRegionId, selectedRegionName } = useRegion();
    const [breadcrumbItems, setBreadcrumbItems] = useState([{ id: null, name: 'World' }]);

    useEffect(() => {
        const fetchAndSetAncestors = async () => {
            if (selectedRegionId !== null) {
                const ancestors = await fetchAncestors(selectedRegionId);
                if (Array.isArray(ancestors)) {
                    const reversedAncestors = ancestors.reverse();
                    setBreadcrumbItems([...reversedAncestors]);
                } else {
                    console.error('Ancestors is not an array:', ancestors);
                }
            } else {
                setBreadcrumbItems([{ id: null, name: 'World' }]);
            }
        };
        fetchAndSetAncestors();
    }, [selectedRegionId]);


    const handleBreadcrumbClick = (regionId, index) => {
        setSelectedRegionId(regionId);
        // Truncate the breadcrumbItems array up to the clicked index + 1
        setBreadcrumbItems(prevItems => prevItems.slice(0, index + 1));
    };

    return (
        <Breadcrumbs aria-label="breadcrumb">
            {breadcrumbItems.map((item, index) => (
                <Typography
                    color="inherit"
                    key={index}
                    onClick={() => handleBreadcrumbClick(item.id, index)}
                    style={{ cursor: 'pointer' }}
                >
                    {item.name}
                </Typography>
            ))}
        </Breadcrumbs>
    );
};

export default BreadcrumbNavigation;
