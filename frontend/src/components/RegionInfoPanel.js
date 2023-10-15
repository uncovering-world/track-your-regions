import React from 'react';
import { Card, CardContent, Typography } from '@mui/material';

const RegionInfoPanel = () => {
    return (
        <Card>
            <CardContent>
                <Typography variant="h5">
                    Region Name
                </Typography>
                <Typography variant="body2">
                    Region Description
                </Typography>
            </CardContent>
        </Card>
    );
};

export default RegionInfoPanel;
