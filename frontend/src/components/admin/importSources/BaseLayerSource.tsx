/**
 * Base layer import source.
 *
 * Imports the administrative divisions currently loaded as a world view, one
 * region per division. The import runs through the normal pipeline and lands in
 * the normal match review — it is not pre-matched.
 *
 * Deliberately provider-neutral: the provider label is typed in and stored as
 * data, so switching the base layer means reloading it and re-importing.
 */

import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startBaseLayerImport } from '../../../api/admin/worldViewImport';
import type { ImportSourceFormProps } from './types';

const DEPTH_OPTIONS = [
  { value: 1, label: 'Roots + countries (~245 regions)' },
  { value: 2, label: 'Roots + countries + subdivisions (~3 800 regions)' },
  { value: 3, label: 'One level deeper (~46 000 regions — slow)' },
];

export function BaseLayerForm({ worldViewName }: ImportSourceFormProps) {
  const queryClient = useQueryClient();
  // No provider name is prefilled: which dataset is loaded is the admin's to
  // state, and baking today's into the UI is exactly the hardcoding this
  // feature avoids everywhere else.
  const [providerLabel, setProviderLabel] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);

  const mutation = useMutation({
    mutationFn: () => startBaseLayerImport({ name: worldViewName, providerLabel, maxDepth }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
    },
  });

  return (
    <Stack spacing={2}>
      <TextField
        label="Provider label"
        placeholder="Dataset and version"
        helperText="Stored as the world view's source — name the dataset currently loaded"
        value={providerLabel}
        onChange={(e) => setProviderLabel(e.target.value)}
        size="small"
        fullWidth
      />
      <TextField
        select
        label="Depth"
        value={maxDepth}
        onChange={(e) => setMaxDepth(Number(e.target.value))}
        size="small"
        fullWidth
      >
        {DEPTH_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>

      <Box>
        <Button
          variant="contained"
          disabled={mutation.isPending || !worldViewName.trim() || !providerLabel.trim()}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Starting…' : 'Import base layer'}
        </Button>
      </Box>

      <Typography variant="caption" color="text.secondary">
        Creates a world view from the administrative divisions currently loaded,
        one region per division, then matches it like any other import. Review
        the matches when it finishes. The world view starts hidden.
      </Typography>

      {mutation.isSuccess && (
        <Alert severity="info">
          Import started. Follow it in the import progress below, then review the
          matches and compute geometries.
        </Alert>
      )}
      {mutation.isError && (
        <Alert severity="error">
          {mutation.error instanceof Error ? mutation.error.message : 'Import failed to start'}
        </Alert>
      )}
    </Stack>
  );
}
