import React, { useEffect, useState } from 'react';
import { fetchRootRegions } from '../api';

const RegionList = () => {
    const [regions, setRegions] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            const data = await fetchRootRegions();
            setRegions(data);
        };

        fetchData();
    }, []);

    return (
        <div>
            <h1>Root Regions</h1>
            <ul>
                {regions.map(region => (
                    <li key={region.id}>{region.name}</li>
                ))}
            </ul>
        </div>
    );
};

export default RegionList;
