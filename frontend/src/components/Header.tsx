import { AppBar, Toolbar, Typography, Box, IconButton, Tooltip, Button } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import MapIcon from '@mui/icons-material/Map';
import ExploreIcon from '@mui/icons-material/Explore';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { useAuth } from '../hooks/useAuth';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useNavigate, useLocation } from 'react-router';
import { UserMenu } from './auth/UserMenu';
import { useAppTheme } from '../theme';
import { useAppAddress } from '../hooks/useAppAddress';
import { useNavigation } from '../hooks/useNavigation';
import type { AppMode } from '../utils/appUrl';

export function Header() {
  const { mode, toggleMode } = useAppTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { address, go } = useAppAddress();
  const { selectedWorldView } = useNavigation();
  const isDiscover = address?.mode === 'discover';
  const isReview = location.pathname === '/review';
  const { isCurator } = useAuth();

  // The place carries over between the two views: the world view and the region
  // stay, and so does an open card — Discover finds its category from the
  // object. Asked of `go` rather than built from this render's `address`, which
  // can be one write behind it (see `GoTarget`) — the failure that costs is a
  // click landing just after the root named its world view, which would carry
  // over no place at all. Off the map (the review queue, the account page) there
  // is no address to carry, so the world view comes from the selection instead:
  // a bare `/` would read as the default world view, which is not the one on
  // screen.
  const goToMode = (nextMode: AppMode) => {
    if (address === null) {
      go({
        mode: nextMode,
        worldViewId: selectedWorldView && !selectedWorldView.isDefault ? selectedWorldView.id : null,
        regionId: null,
        experienceId: null,
        categoryId: null,
      });
      return;
    }
    go(at => ({ ...at, mode: nextMode, categoryId: null }));
  };

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
            onClick={() => goToMode('map')}
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
            onClick={() => goToMode('discover')}
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
          {/* Only curators can act on the queue, so only they are offered it —
              the API refuses everyone else regardless. */}
          {isCurator && (
            <Button
              color="inherit"
              size="small"
              startIcon={<FactCheckIcon />}
              onClick={() => navigate('/review')}
              sx={{
                opacity: isReview ? 1 : 0.7,
                borderBottom: isReview ? '2px solid currentColor' : 'none',
                borderRadius: 0,
                px: 1.5,
                pb: 0.5,
              }}
            >
              Review
            </Button>
          )}
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
