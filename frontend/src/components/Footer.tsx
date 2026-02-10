import { Box, Typography, Link } from '@mui/material';

export function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        py: 2,
        px: 3,
        mt: 'auto',
        backgroundColor: 'grey.100',
        borderTop: 1,
        borderColor: 'grey.300',
      }}
    >
      <Typography variant="body2" color="text.secondary" align="center">
        Track Your Regions © {new Date().getFullYear()} |{' '}
        <Link href="https://github.com/OhmSpectator/track-your-regions" target="_blank" rel="noopener">
          GitHub
        </Link>
      </Typography>
    </Box>
  );
}
