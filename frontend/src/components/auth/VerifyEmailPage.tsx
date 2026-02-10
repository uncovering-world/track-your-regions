import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useAuth } from '../../hooks/useAuth';
import { resendVerification } from '../../api/auth';

/**
 * Handles email verification by consuming the token from the URL.
 * On success: auto-logs in and redirects to home.
 * On failure: shows error with option to resend.
 *
 * Uses a ref guard to prevent StrictMode's double-effect from consuming
 * the one-time token twice.
 */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const verifyStarted = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-fire — the token is one-time-use
    if (verifyStarted.current) return;
    verifyStarted.current = true;

    const handleVerification = async () => {
      const token = searchParams.get('token');

      if (!token) {
        setStatus('error');
        setError('Missing verification token');
        return;
      }

      try {
        await verifyEmail(token);
        setStatus('success');
        // Redirect to home after a brief success message
        setTimeout(() => navigate('/', { replace: true }), 2000);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Email verification failed');
      }
    };

    handleVerification();
  }, [searchParams, navigate, verifyEmail]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResendLoading(true);
    setResendMessage(null);
    try {
      const result = await resendVerification(resendEmail);
      setResendMessage(result.message);
    } catch {
      setResendMessage('Failed to resend. Please try again later.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
        px: 2,
      }}
    >
      {status === 'loading' && (
        <>
          <CircularProgress />
          <Typography>Verifying your email...</Typography>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircleOutlineIcon sx={{ fontSize: 64, color: 'success.main' }} />
          <Typography variant="h6">Email verified!</Typography>
          <Typography variant="body2" color="text.secondary">
            You are now logged in. Redirecting...
          </Typography>
        </>
      )}

      {status === 'error' && (
        <Box sx={{ maxWidth: 400, textAlign: 'center' }}>
          <ErrorOutlineIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter your email to receive a new verification link:
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ccc',
                fontSize: 14,
              }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleResend}
              disabled={resendLoading || !resendEmail}
            >
              {resendLoading ? 'Sending...' : 'Resend'}
            </Button>
          </Box>

          {resendMessage && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {resendMessage}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            <a href="/">Return to home</a>
          </Typography>
        </Box>
      )}
    </Box>
  );
}
