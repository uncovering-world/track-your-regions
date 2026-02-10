import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Divider,
  Alert,
  CircularProgress,
  Link,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import AppleIcon from '@mui/icons-material/Apple';
import { useAuth } from '../../hooks/useAuth';
import { AuthError, getGoogleAuthUrl, getAppleAuthUrl, getLastGoogleEmail, setLastUsedEmail, clearLastGoogleEmail, resendVerification } from '../../api/auth';

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
  onSwitchToRegister: () => void;
}

export function LoginDialog({ open, onClose, onSwitchToRegister }: LoginDialogProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastGoogleEmail, setLastGoogleEmail] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Load last used Google email on mount
  useEffect(() => {
    if (open) {
      setLastGoogleEmail(getLastGoogleEmail());
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login({ email, password });
      // Save last used email for display purposes (not for Google login_hint)
      setLastUsedEmail(email);
      onClose();
      // Reset form
      setEmail('');
      setPassword('');
    } catch (err) {
      if (err instanceof AuthError && err.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendMessage(null);
    try {
      const result = await resendVerification(email);
      setResendMessage(result.message);
    } catch {
      setResendMessage('Failed to resend. Please try again later.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleGoogleLogin = (useHint: boolean = true) => {
    const hint = useHint ? lastGoogleEmail : undefined;
    window.location.href = getGoogleAuthUrl(hint ?? undefined);
  };

  const handleGoogleLoginDifferentAccount = () => {
    clearLastGoogleEmail();
    setLastGoogleEmail(null);
    // Redirect without login_hint to allow choosing different account
    window.location.href = getGoogleAuthUrl();
  };

  const handleAppleLogin = () => {
    // TODO: Untested - requires Apple Developer account
    window.location.href = getAppleAuthUrl();
  };

  const handleClose = () => {
    setError(null);
    setEmail('');
    setPassword('');
    setNeedsVerification(false);
    setResendMessage(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign In</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {error && (
            <Alert severity={needsVerification ? 'warning' : 'error'} sx={{ mb: 2 }}>
              {error}
              {needsVerification && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={handleResendVerification}
                    disabled={resendLoading}
                    sx={{ p: 0, minWidth: 'auto', textTransform: 'none' }}
                  >
                    {resendLoading ? 'Sending...' : 'Resend verification email'}
                  </Button>
                </Box>
              )}
            </Alert>
          )}

          {resendMessage && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {resendMessage}
            </Alert>
          )}

          <TextField
            autoFocus
            margin="dense"
            label="Email"
            type="email"
            fullWidth
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />

          <Box sx={{ mt: 3, mb: 2 }}>
            <Divider>
              <Typography variant="body2" color="text.secondary">
                or continue with
              </Typography>
            </Divider>
          </Box>

          {/* Quick login with last used Google account */}
          {lastGoogleEmail && (
            <Box sx={{ mb: 2 }}>
              <Button
                variant="contained"
                fullWidth
                startIcon={<GoogleIcon />}
                onClick={() => handleGoogleLogin(true)}
                disabled={isLoading}
                sx={{ mb: 1 }}
              >
                Continue as {lastGoogleEmail}
              </Button>
              <Box sx={{ textAlign: 'center' }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={handleGoogleLoginDifferentAccount}
                >
                  Use a different account
                </Link>
              </Box>
            </Box>
          )}

          {/* Regular OAuth buttons (shown when no last Google email or as alternative) */}
          {!lastGoogleEmail && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<GoogleIcon />}
                onClick={() => handleGoogleLogin(false)}
                disabled={isLoading}
              >
                Google
              </Button>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<AppleIcon />}
                onClick={handleAppleLogin}
                disabled={isLoading}
                title="TODO: Untested - requires Apple Developer account"
              >
                Apple
              </Button>
            </Box>
          )}

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Don&apos;t have an account?{' '}
              <Link
                component="button"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleClose();
                  onSwitchToRegister();
                }}
              >
                Sign up
              </Link>
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading || !email || !password}
          >
            {isLoading ? <CircularProgress size={24} /> : 'Sign In'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
