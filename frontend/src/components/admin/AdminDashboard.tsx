/**
 * Admin Dashboard
 *
 * Main admin panel layout with sidebar navigation.
 */

import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Box,
  Container,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  useTheme,
  useMediaQuery,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  Sync as SyncIcon,
  History as HistoryIcon,
  Map as MapIcon,
  Dashboard as DashboardIcon,
  Menu as MenuIcon,
  ArrowBack as ArrowBackIcon,
  SupervisorAccount as CuratorIcon,
} from '@mui/icons-material';
import { useAuth } from '../../hooks/useAuth';
import { SyncPanel } from './SyncPanel';
import { SyncHistoryPanel } from './SyncHistoryPanel';
import { AssignmentPanel } from './AssignmentPanel';
import { CuratorPanel } from './CuratorPanel';

const DRAWER_WIDTH = 240;

type AdminSection = 'overview' | 'sync' | 'assignment' | 'history' | 'curators';

export function AdminDashboard() {
  const { isAdmin, isLoading } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('sync');

  // Listen for navigation events from child components
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<AdminSection>;
      if (customEvent.detail) {
        setActiveSection(customEvent.detail);
      }
    };
    window.addEventListener('navigate-admin', handleNavigate);
    return () => window.removeEventListener('navigate-admin', handleNavigate);
  }, []);

  // Redirect non-admins
  if (!isLoading && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <DashboardIcon /> },
    { id: 'sync', label: 'Sync Experiences', icon: <SyncIcon /> },
    { id: 'assignment', label: 'Region Assignment', icon: <MapIcon /> },
    { id: 'history', label: 'Sync History', icon: <HistoryIcon /> },
    { id: 'curators', label: 'Curators', icon: <CuratorIcon /> },
  ];

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton component="a" href="/" size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" noWrap>
          Admin Panel
        </Typography>
      </Box>
      <Divider />
      <List sx={{ flex: 1 }}>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.id}
            selected={activeSection === item.id}
            onClick={() => {
              setActiveSection(item.id);
              if (isMobile) setMobileOpen(false);
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Track Your Regions Admin
        </Typography>
      </Box>
    </Box>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewPanel />;
      case 'sync':
        return <SyncPanel />;
      case 'assignment':
        return <AssignmentPanel />;
      case 'history':
        return <SyncHistoryPanel />;
      case 'curators':
        return <CuratorPanel />;
      default:
        return null;
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'grey.100' }}>
      {/* Mobile App Bar */}
      {isMobile && (
        <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
          <Toolbar>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap>
              Admin Panel
            </Typography>
          </Toolbar>
        </AppBar>
      )}

      {/* Sidebar Drawer */}
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
            }}
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            sx={{
              '& .MuiDrawer-paper': {
                width: DRAWER_WIDTH,
                boxSizing: 'border-box',
              },
            }}
            open
          >
            {drawerContent}
          </Drawer>
        )}
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: { xs: 8, md: 0 },
        }}
      >
        <Container maxWidth="lg">{renderContent()}</Container>
      </Box>
    </Box>
  );
}

/**
 * Overview Panel - Dashboard summary
 */
function OverviewPanel() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard Overview
      </Typography>
      <Typography color="text.secondary">
        Welcome to the Track Your Regions admin panel. Use the sidebar to navigate between sections.
      </Typography>

      <Box sx={{ mt: 4, display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Box sx={{ p: 3, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1 }}>
          <Typography variant="h6" gutterBottom>
            Sync Experiences
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sync UNESCO World Heritage Sites and other experience sources.
          </Typography>
        </Box>
        <Box sx={{ p: 3, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1 }}>
          <Typography variant="h6" gutterBottom>
            Region Assignment
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Assign experiences to regions based on spatial containment.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
