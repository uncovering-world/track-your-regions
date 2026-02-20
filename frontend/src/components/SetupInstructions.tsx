import { Typography, Box, Paper } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

interface SetupInstructionsProps {
  isAuthenticated: boolean;
}

/**
 * First-run setup instructions shown inline in the main content area
 * when no custom world views exist. Adapts steps based on auth state.
 * Disappears automatically once a custom world view is created.
 */
export function SetupInstructions({ isAuthenticated }: SetupInstructionsProps) {
  let stepNum = 0;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <Paper sx={{ maxWidth: 520, p: 4 }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          Welcome to Track Your Regions
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          This is a fresh installation. Follow these steps to get started:
        </Typography>

        <Step done={isAuthenticated} number={isAuthenticated ? undefined : ++stepNum} title="Register an account">
          Click <strong>Sign In</strong> in the top-right corner to create your account.
        </Step>

        <Step number={++stepNum} title="Promote yourself to admin">
          Run this command in your terminal:
          <Box
            component="code"
            sx={{
              display: 'block',
              mt: 1,
              p: 1.5,
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              whiteSpace: 'nowrap',
              overflow: 'auto',
            }}
          >
            npm run db:make-admin your@email.com
          </Box>
        </Step>

        <Step number={++stepNum} title="Create your first world view">
          Go to <strong>Admin Panel</strong> and either import from Wikivoyage
          or create a custom regional hierarchy.
        </Step>

        <Step number={++stepNum} title="Sync experiences" last>
          In the Admin Panel, run experience syncs (UNESCO sites, museums, landmarks)
          to populate your map with content.
        </Step>
      </Paper>
    </Box>
  );
}

function Step({ number, title, children, last, done }: {
  number?: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
  done?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, mb: last ? 0 : 3, opacity: done ? 0.5 : 1 }}>
      {done ? (
        <CheckCircleOutlineIcon
          color="success"
          sx={{ width: 28, height: 28, flexShrink: 0, mt: 0.25 }}
        />
      ) : (
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '0.85rem',
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          {number}
        </Box>
      )}
      <Box>
        <Typography
          variant="subtitle2"
          sx={{ mb: 0.5, textDecoration: done ? 'line-through' : 'none' }}
        >
          {title}
        </Typography>
        {!done && (
          <Typography variant="body2" color="text.secondary" component="div">
            {children}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
