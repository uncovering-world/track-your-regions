// MainPane.js
import React, { useEffect } from 'react';
import { useNavigation } from './NavigationContext';
import { fetchRegion } from '../api';
import RegionMap from "./RegionMap";

const MainDisplay = () => {
    const { selectedRegion } = useNavigation();

    return (
        <div>
            {selectedRegion.name ? (
                <>
                    <h1>{selectedRegion.name}</h1>
                    <RegionMap/>
                </>
            ) : (
                <p>No region selected.</p>
            )}
        </div>
    );
};

export default MainDisplay;
