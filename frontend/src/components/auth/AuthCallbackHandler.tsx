import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { exchangeAuthCode } from '../../api/auth';

/**
 * Handles OAuth callback by exchanging the authorization code for tokens.
 * The code exchange sets the refresh token as an httpOnly cookie and returns
 * the access token. Then AuthProvider's handleOAuthResult updates React state.
 *
 * Uses a ref guard to prevent StrictMode's double-effect from consuming the
 * one-time auth code twice (second attempt would 401 and flash an error).
 */
export function AuthCallbackHandler() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-fire — the auth code is one-time-use
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;

    const handleCallback = async () => {
      const code = searchParams.get('code');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setError(decodeURIComponent(errorParam));
        return;
      }

      if (!code) {
        setError('Missing authorization code');
        return;
      }

      try {
        // Exchange the one-time code for tokens (sets refresh cookie)
        const { accessToken } = await exchangeAuthCode(code);

        // After the await, AuthProvider's effects have fired and
        // window.handleOAuthResult is available to update React state
        const handleOAuthResult = (
          window as unknown as { handleOAuthResult?: (token: string) => Promise<boolean> }
        ).handleOAuthResult;

        if (handleOAuthResult) {
          const success = await handleOAuthResult(accessToken);
          if (success) {
            navigate('/', { replace: true });
            return;
          }
        }

        // Fallback: cookie is set, reload to let AuthProvider pick up session
        window.location.replace('/');
      } catch (err) {
        console.error('Auth callback error:', err);
        setError('Authentication failed. Please try again.');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          {error}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          <a href="/">Return to home</a>
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography>Completing sign in...</Typography>
    </Box>
  );
}
