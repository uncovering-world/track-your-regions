import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
  Typography,
  Divider,
  Chip,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useAuth } from '../../hooks/useAuth';
import { LoginDialog } from './LoginDialog';
import { RegisterDialog } from './RegisterDialog';

export function UserMenu() {
  const { user, isAuthenticated, isAdmin, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
  };

  // Loading state
  if (isLoading) {
    return (
      <Box sx={{ width: 100 }}>
        <Button disabled size="small" color="inherit">
          Loading...
        </Button>
      </Box>
    );
  }

  // Not authenticated - show login button
  if (!isAuthenticated) {
    return (
      <>
        <Button
          color="inherit"
          onClick={() => setLoginOpen(true)}
          startIcon={<PersonIcon />}
        >
          Sign In
        </Button>

        <LoginDialog
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onSwitchToRegister={() => {
            setLoginOpen(false);
            setRegisterOpen(true);
          }}
        />

        <RegisterDialog
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onSwitchToLogin={() => {
            setRegisterOpen(false);
            setLoginOpen(true);
          }}
        />
      </>
    );
  }

  // Authenticated - show user menu
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const avatarUrl = user?.avatarUrl;
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <>
      <IconButton
        onClick={handleMenuOpen}
        size="small"
        sx={{ ml: 1 }}
        aria-controls={anchorEl ? 'user-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={anchorEl ? 'true' : undefined}
      >
        <Avatar
          src={avatarUrl || undefined}
          alt={displayName}
          sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}
        >
          {!avatarUrl && initials}
        </Avatar>
      </IconButton>

      <Menu
        id="user-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: { minWidth: 200 },
        }}
      >
        {/* User info header */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {displayName}
          </Typography>
          {user?.email && (
            <Typography variant="body2" color="text.secondary">
              {user.email}
            </Typography>
          )}
          {isAdmin && (
            <Chip
              icon={<AdminPanelSettingsIcon />}
              label="Admin"
              size="small"
              color="secondary"
              sx={{ mt: 0.5 }}
            />
          )}
        </Box>

        <Divider />

        {/* Menu items */}
        {isAdmin && (
          <MenuItem onClick={() => { handleMenuClose(); navigate('/admin'); }}>
            <ListItemIcon>
              <AdminPanelSettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Admin Panel</ListItemText>
          </MenuItem>
        )}

        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Sign Out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
