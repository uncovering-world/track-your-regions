/**
 * CV Settings Panel
 *
 * Admin page for computer-vision pipeline configuration (currently just the
 * implementation selector: JavaScript OpenCV.js vs Python OpenCV).
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAISettings, updateAISetting } from '../../api/admin/ai';

export function CVSettingsPanel() {
  const queryClient = useQueryClient();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const { data: settingsData, isLoading, isError, error } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: getAISettings,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateAISetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      setSnackbar({ open: true, message: 'CV pipeline updated', severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Update failed: ${err.message}`, severity: 'error' });
    },
  });

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Typography variant="h4" gutterBottom>CV Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure the computer-vision pipeline used for color-matching Wikivoyage map images to GADM divisions.
      </Typography>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            CV Pipeline Implementation
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Switch the entire CV color-match pipeline between JavaScript (OpenCV.js WASM) and Python (OpenCV + scikit-image).
            Python is the preferred path; the JavaScript fallback is used if the Python service is unreachable.
          </Typography>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : isError || !settingsData ? (
            // Don't render the selector when the load failed: a default-rendered
            // selector would misrepresent the persisted state and risk an
            // accidental overwrite if the admin changes it.
            <Alert severity="error">
              Failed to load CV settings{error instanceof Error ? `: ${error.message}` : ''}.
            </Alert>
          ) : (
            <Select
              size="small"
              value={settingsData.settings?.['cv_pipeline_implementation'] ?? 'javascript'}
              onChange={(e) => updateMutation.mutate({
                key: 'cv_pipeline_implementation',
                value: e.target.value,
              })}
              sx={{ minWidth: 320 }}
            >
              <MenuItem value="javascript">JavaScript (OpenCV.js WASM)</MenuItem>
              <MenuItem value="python">Python (OpenCV + scikit-image)</MenuItem>
            </Select>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
