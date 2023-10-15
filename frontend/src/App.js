import React from 'react';
import Header from './components/Header';
import NavigationPane from './components/NavigationPane';
import MainDisplay from './components/MainDisplay';
import Footer from './components/Footer';
import { Container, Grid } from '@mui/material';
import { RegionProvider } from './components/RegionContext';

function App() {
    return (
        <RegionProvider>
            <div className="App">
                <Header/>
                <Container b={2}>
                    <Grid container spacing={3}>
                        <Grid item xs={4}>
                            <NavigationPane/>
                        </Grid>
                        <Grid item xs={8}>
                            <MainDisplay/>
                        </Grid>
                    </Grid>
                </Container>
                <Footer/>
            </div>
        </RegionProvider>
    );
}

export default App;