import { Alert, Chip, Container, Divider, Paper, Typography } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useAuth } from '../../hooks/useAuth';
import type { AuthProvider } from '../../types/auth';
import { ChangePasswordForm } from './ChangePasswordForm';

/** How an account signs in, in the words a person would use. */
const PROVIDER_LABEL: Record<AuthProvider, string> = {
  local: 'Email and password',
  google: 'Google',
  apple: 'Apple',
};

/**
 * An account signed in through a provider has no password of its own — the
 * server refuses `change-password` for it with "not available for OAuth
 * accounts". Only a *known* provider counts: an account whose provider the
 * profile does not name may still hold a password (`auth_provider` is nullable),
 * and the two failures are not equal. Offering a form that answers with the
 * server's own refusal is recoverable; withholding it from someone who has a
 * password to change is not.
 */
function signsInWithProvider(provider: AuthProvider | undefined): boolean {
  return provider === 'google' || provider === 'apple';
}

/**
 * The account area: who you are, and the password you sign in with.
 *
 * Deliberately plain. It exists because a password that cannot be rotated is
 * the one a person keeps after a breach — the endpoint has been there since
 * February 2026 with no way for anyone to reach it (#326).
 */
export function AccountPage() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated || !user) {
    return (
      <Alert severity="info" sx={{ m: 3 }}>
        Sign in to see your account.
      </Alert>
    );
  }

  const displayName = user.displayName || user.email?.split('@')[0] || 'User';
  // Left unsaid where the profile names no provider: "Signs in with: Unknown"
  // tells a person nothing they can act on.
  const providerLabel = user.authProvider ? PROVIDER_LABEL[user.authProvider] : null;
  const oauthAccount = signsInWithProvider(user.authProvider);

  return (
    <Container maxWidth="sm" sx={{ py: 4, overflow: 'auto' }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Account
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          {displayName}
        </Typography>
        {user.email && (
          <Typography variant="body2" color="text.secondary">
            {user.email}
          </Typography>
        )}
        {providerLabel && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Signs in with: {providerLabel}
          </Typography>
        )}
        {user.role !== 'user' && (
          <Chip
            icon={user.role === 'admin' ? <AdminPanelSettingsIcon /> : undefined}
            label={user.role === 'admin' ? 'Admin' : 'Curator'}
            size="small"
            color="secondary"
            sx={{ mt: 1.5 }}
          />
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Password
        </Typography>
        <Divider sx={{ mb: 2 }} />

        {oauthAccount ? (
          <Typography variant="body2" color="text.secondary">
            This account signs in with {providerLabel}, so it has no password here. Change it with{' '}
            {providerLabel} instead.
          </Typography>
        ) : (
          <ChangePasswordForm />
        )}
      </Paper>
    </Container>
  );
}
