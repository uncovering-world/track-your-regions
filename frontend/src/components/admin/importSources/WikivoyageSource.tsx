/**
 * Wikivoyage import source.
 *
 * Fetches the full Wikivoyage region hierarchy, enriches it with Wikidata IDs,
 * then imports and matches countries to administrative divisions. Extraction
 * progress (and the shared "existing world views" list) is polled by the
 * parent panel under the same query key this form reads its cache list from —
 * the two subscribe to the same cache rather than duplicating a fetch.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Language as LanguageIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startWikivoyageExtraction,
  getExtractionStatus,
  deleteCacheFile,
} from '../../../api/admin/wikivoyageExtract';
import type { CacheEntry } from '../../../api/admin/wikivoyageExtract';
import type { ImportSourceFormProps } from './types';

export function WikivoyageForm({ worldViewName }: ImportSourceFormProps) {
  const queryClient = useQueryClient();
  const [selectedCache, setSelectedCache] = useState<string | undefined>(undefined); // undefined = default, 'none' = clean

  // Poll extraction status (primary)
  const { data: extractStatus } = useQuery({
    queryKey: ['admin', 'wvExtract', 'status'],
    queryFn: getExtractionStatus,
    refetchInterval: (query) => {
      const st = query.state.data;
      if (st?.running) return 2000;
      return false;
    },
  });

  const caches: CacheEntry[] = extractStatus?.caches ?? [];

  const extractMutation = useMutation({
    mutationFn: () => startWikivoyageExtraction(worldViewName, selectedCache),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
  });

  const deleteCacheMutation = useMutation({
    mutationFn: deleteCacheFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
  });

  return (
    <Stack spacing={2}>
      {extractMutation.isError && (
        <Alert severity="error">{(extractMutation.error as Error).message}</Alert>
      )}

      <Button
        variant="contained"
        startIcon={<LanguageIcon />}
        onClick={() => extractMutation.mutate()}
        disabled={!worldViewName.trim() || extractMutation.isPending}
        size="large"
      >
        Fetch from Wikivoyage
      </Button>

      <FormControl size="small" fullWidth>
        <InputLabel>API Cache</InputLabel>
        <Select
          value={selectedCache ?? (caches.length > 0 ? '' : 'none')}
          label="API Cache"
          onChange={(e) => setSelectedCache(e.target.value === 'none' ? 'none' : e.target.value || undefined)}
          renderValue={(val) => {
            if (!val) return `Use latest cache (${caches.length} available)`;
            if (val === 'none') return 'Clean fetch (no cache)';
            const c = caches.find(c => c.name === val);
            if (!c) return val;
            return `${new Date(c.modifiedAt).toLocaleDateString()} — ${(c.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
          }}
        >
          {caches.length > 0 && (
            <MenuItem value="">
              <em>Use latest cache</em>
            </MenuItem>
          )}
          <MenuItem value="none">
            <em>Clean fetch (no cache)</em>
          </MenuItem>
          {caches.map(c => (
            <MenuItem key={c.name} value={c.name}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {c.name === 'wikivoyage-cache.json' ? '(active) ' : ''}
                  {new Date(c.modifiedAt).toLocaleDateString()} {new Date(c.modifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' — '}
                  {(c.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </Typography>
                {c.name !== 'wikivoyage-cache.json' && (
                  <Tooltip title="Delete this cache">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCacheMutation.mutate(c.name);
                        if (selectedCache === c.name) setSelectedCache(undefined);
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Typography variant="caption" color="text.secondary">
        Extracts ~5,700 regions from English Wikivoyage, enriches with Wikidata IDs,
        then imports and matches countries to GADM divisions.
      </Typography>
    </Stack>
  );
}
