import React from 'react';
import { Container, Grid } from '@mui/material';
import Header from './components/Header';
import NavigationPane from './components/NavigationPane';
import MainDisplay from './components/MainDisplay';
import Footer from './components/Footer';
import { NavigationProvider } from './components/NavigationContext';

/**
 * App is the main component that renders the app's layout, composed of
 * the Header, NavigationPane, MainDisplay, and Footer components within a container.
 */
function App() {
  return (
    <NavigationProvider>
      <div className="App">
        <Header />
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid item xs={4}>
              <NavigationPane />
            </Grid>
            <Grid item xs={8}>
              <MainDisplay />
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </div>
    </NavigationProvider>
  );
}

export default App;
