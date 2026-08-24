import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../hooks/useAuth';
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT,
  PASSWORD_TOO_LONG,
} from '../../constants/passwordRules';

/**
 * The change-password form of a local account.
 *
 * Two things the server owns and this form does not restate: whether the
 * current password is right, and whether the new one has been breached. Both
 * come back as sentences, and both are rendered as they arrive — a form that
 * paraphrases "this password has appeared in 41,203 data breaches" loses the
 * number that makes it convincing.
 *
 * What the form *does* own is the checks a round trip should not be spent on:
 * the two new fields disagreeing, and a password outside the schema's bounds
 * (`changePasswordSchema`, backend `types/auth.ts`) — both of them, because
 * past the ceiling the body is rejected by Zod and every ZodError renders as
 * the bare string "Validation error".
 */
export function ChangePasswordForm() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (mismatch) {
      setError('The new passwords do not match');
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(PASSWORD_TOO_SHORT);
      return;
    }

    // Both bounds, not only the floor: past the ceiling the schema rejects the
    // body and the error handler renders every ZodError as "Validation error",
    // which tells the user nothing about what to change.
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      setError(PASSWORD_TOO_LONG);
      return;
    }

    setIsSubmitting(true);
    try {
      const message = await changePassword({ currentPassword, newPassword });
      // The server's message names the consequence (other devices signed out),
      // so it is shown as it arrives rather than summarised here.
      setSuccess(message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    !isSubmitting && currentPassword !== '' && newPassword !== '' && confirmPassword !== '';

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <TextField
        margin="dense"
        label="Current password"
        type="password"
        name="current-password"
        autoComplete="current-password"
        fullWidth
        required
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        disabled={isSubmitting}
      />
      <TextField
        margin="dense"
        label="New password"
        type="password"
        name="new-password"
        autoComplete="new-password"
        fullWidth
        required
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        disabled={isSubmitting}
        helperText={`Between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`}
      />
      <TextField
        margin="dense"
        label="Confirm new password"
        type="password"
        name="confirm-new-password"
        autoComplete="new-password"
        fullWidth
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        disabled={isSubmitting}
        error={mismatch}
        helperText={mismatch ? 'The new passwords do not match' : ''}
      />

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button type="submit" variant="contained" disabled={!canSubmit}>
          {isSubmitting ? <CircularProgress size={24} /> : 'Change password'}
        </Button>
        <Typography variant="body2" color="text.secondary">
          Changing your password signs you out everywhere else. This session stays open.
        </Typography>
      </Box>
    </form>
  );
}
