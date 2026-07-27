/**
 * File-upload import source.
 *
 * Uploads a pre-generated JSON region tree for non-Wikivoyage sources, then
 * imports and matches it through the same pipeline as the other sources.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { Upload as UploadIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startWorldViewImport } from '../../../api/admin/worldViewImport';
import type { ImportSourceFormProps } from './types';

export function FileForm({ worldViewName }: ImportSourceFormProps) {
  const queryClient = useQueryClient();
  const [treeData, setTreeData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [matchingPolicy, setMatchingPolicy] = useState<'country-based' | 'none'>('country-based');
  const readerRef = useRef<FileReader | null>(null);

  const importMutation = useMutation({
    mutationFn: () => startWorldViewImport(worldViewName, treeData, matchingPolicy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reads are async, so a second pick while the first is still reading could
    // otherwise land the older tree under the newer filename. Drop the previous
    // reader and ignore anything but the current one's result.
    readerRef.current?.abort();
    setFileError('');
    setFileName(file.name);
    setTreeData(null);

    const reader = new FileReader();
    readerRef.current = reader;
    reader.onerror = () => {
      if (readerRef.current !== reader) return;
      setTreeData(null);
      setFileError('Could not read the file');
    };
    reader.onload = (event) => {
      if (readerRef.current !== reader) return;
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.children || !Array.isArray(parsed.children)) {
          setFileError('Invalid file: expected a tree with "children" array');
          setTreeData(null);
          return;
        }
        setTreeData(parsed);
      } catch {
        setFileError('Invalid JSON file');
        setTreeData(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleStartImport = useCallback(() => {
    if (!treeData) return;
    importMutation.mutate();
  }, [treeData, importMutation]);

  return (
    <Stack spacing={2}>
      <Box>
        <Button
          variant="outlined"
          component="label"
          startIcon={<UploadIcon />}
        >
          {fileName || 'Upload JSON File'}
          <input
            type="file"
            accept=".json"
            hidden
            onChange={handleFileUpload}
          />
        </Button>
        {fileName && !fileError && (
          <Typography variant="caption" sx={{ ml: 1 }} color="text.secondary">
            {fileName}
          </Typography>
        )}
      </Box>

      {fileError && <Alert severity="error">{fileError}</Alert>}
      {importMutation.isError && (
        <Alert severity="error">{(importMutation.error as Error).message}</Alert>
      )}

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Matching Policy</InputLabel>
        <Select
          value={matchingPolicy}
          label="Matching Policy"
          onChange={(e) => setMatchingPolicy(e.target.value as 'country-based' | 'none')}
        >
          <MenuItem value="country-based">Country-based (auto-match)</MenuItem>
          <MenuItem value="none">None (manual only)</MenuItem>
        </Select>
      </FormControl>

      <Button
        variant="contained"
        onClick={handleStartImport}
        disabled={!treeData || !worldViewName.trim() || importMutation.isPending}
      >
        Start Import
      </Button>
    </Stack>
  );
}
