import { ThemeProvider, CssBaseline } from '@mui/material';
import type { ReactNode } from 'react';
import { createAppTheme } from '../frontend/src/theme';

// Default to the light palette for previews; dark is a later variant.
const theme = createAppTheme('light');

export function DsPreviewProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
