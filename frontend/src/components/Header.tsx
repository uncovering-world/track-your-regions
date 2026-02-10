import { AppBar, Toolbar, Typography, Box, IconButton, Tooltip, Button } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import MapIcon from '@mui/icons-material/Map';
import ExploreIcon from '@mui/icons-material/Explore';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useNavigate, useLocation } from 'react-router-dom';
import { UserMenu } from './auth/UserMenu';
import { useAppTheme } from '../theme';

export function Header() {
  const { mode, toggleMode } = useAppTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isDiscover = location.pathname === '/discover';

  return (
    <AppBar position="static" color="primary" elevation={1}>
      <Toolbar>
        <PublicIcon sx={{ mr: 2 }} />
        <Typography variant="h6" component="h1" sx={{ mr: 3 }}>
          Track Your Regions
        </Typography>
        {/* View toggle */}
        <Box sx={{ display: 'flex', gap: 0.5, mr: 'auto' }}>
          <Button
            color="inherit"
            size="small"
            startIcon={<MapIcon />}
            onClick={() => navigate('/')}
            sx={{
              opacity: isDiscover ? 0.7 : 1,
              borderBottom: isDiscover ? 'none' : '2px solid currentColor',
              borderRadius: 0,
              px: 1.5,
              pb: 0.5,
            }}
          >
            Map
          </Button>
          <Button
            color="inherit"
            size="small"
            startIcon={<ExploreIcon />}
            onClick={() => navigate('/discover')}
            sx={{
              opacity: isDiscover ? 1 : 0.7,
              borderBottom: isDiscover ? '2px solid currentColor' : 'none',
              borderRadius: 0,
              px: 1.5,
              pb: 0.5,
            }}
          >
            Discover
          </Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton onClick={toggleMode} color="inherit" size="small">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <UserMenu />
        </Box>
      </Toolbar>
    </AppBar>
  );
}
