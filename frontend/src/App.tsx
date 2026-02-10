import { useState, useEffect, useMemo } from 'react';
import { Container, Box, CssBaseline, ThemeProvider, IconButton, Tooltip } from '@mui/material';
import { ChevronLeft as CollapseIcon, ChevronRight as ExpandIcon } from '@mui/icons-material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { NavigationPane } from './components/NavigationPane';
import { MainDisplay, setExplorationModeListener } from './components/MainDisplay';
import { DiscoverPage } from './components/discover/DiscoverPage';
import { AuthCallbackHandler, VerifyEmailPage } from './components/auth';
import { AdminDashboard } from './components/admin';
import { NavigationProvider } from './hooks/useNavigation';
import { AuthProvider } from './hooks/useAuth';
import { AppThemeProvider, useAppTheme, createAppTheme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000, // 1 minute
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function MainContent() {
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Listen for exploration mode changes from MainDisplay
  useEffect(() => {
    setExplorationModeListener((exploring) => {
      setNavCollapsed(exploring);
    });
    return () => setExplorationModeListener(() => {});
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Header />
      <Container maxWidth="xl" sx={{ flex: 1, py: 3, minHeight: 0, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {/* Left Navigation - Collapsible */}
          <Box
            sx={{
              width: navCollapsed ? 48 : 320,
              flexShrink: 0,
              transition: 'width 0.3s ease',
              position: 'relative',
            }}
          >
            {/* Collapse/Expand Toggle */}
            <Tooltip title={navCollapsed ? 'Show navigation' : 'Hide navigation'} placement="right">
              <IconButton
                onClick={() => setNavCollapsed(!navCollapsed)}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 4,
                  top: 8,
                  zIndex: 10,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {navCollapsed ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            {/* Navigation Content */}
            <Box
              sx={{
                opacity: navCollapsed ? 0 : 1,
                visibility: navCollapsed ? 'hidden' : 'visible',
                transition: 'opacity 0.2s ease, visibility 0.2s ease',
              }}
            >
              <NavigationPane />
            </Box>
          </Box>

          {/* Main Content Area */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <MainDisplay />
          </Box>
        </Box>
      </Container>
    </Box>
  );
}

function DiscoverContent() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Header />
      <DiscoverPage />
    </Box>
  );
}

/** Reads the global mode and creates a reactive MUI theme */
function ThemedApp() {
  const { mode } = useAppTheme();
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <NavigationProvider>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackHandler />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/admin/*" element={<AdminDashboard />} />
            <Route path="/discover" element={<DiscoverContent />} />
            <Route path="/*" element={<MainContent />} />
          </Routes>
        </NavigationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <AppThemeProvider>
          <ThemedApp />
        </AppThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
