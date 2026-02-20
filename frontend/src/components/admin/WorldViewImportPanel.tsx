/**
 * WorldView Import Panel
 *
 * Primary: "Fetch from Wikivoyage" button — runs full extraction pipeline
 * Secondary: file upload in collapsed accordion for other sources
 *
 * Multi-phase progress: extraction → enrichment → import → matching
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  LinearProgress,
  Card,
  CardContent,
  Alert,
  Chip,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  FormControlLabel,
  Checkbox,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Upload as UploadIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Cancel as CancelIcon,
  ExpandMore as ExpandMoreIcon,
  Language as LanguageIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startWorldViewImport,
  getImportStatus,
  cancelImport,
} from '../../api/adminWorldViewImport';
import {
  startWikivoyageExtraction,
  getExtractionStatus,
  cancelExtraction,
} from '../../api/adminWikivoyageExtract';
import { WorldViewImportReview } from './WorldViewImportReview';

export function WorldViewImportPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('Wikivoyage Regions');
  const [treeData, setTreeData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [matchingPolicy, setMatchingPolicy] = useState<'country-based' | 'none'>('country-based');
  const [useCache, setUseCache] = useState(true);
  const [showReview, setShowReview] = useState(false);
  const [reviewWorldViewId, setReviewWorldViewId] = useState<number | null>(null);

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

  // Poll import status (for file upload path)
  const { data: importStatus } = useQuery({
    queryKey: ['admin', 'wvImport', 'importStatus'],
    queryFn: async () => {
      const result = await getImportStatus();
      // When import finishes, refresh extraction status to update world views list
      if (!result.running && result.status === 'complete') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
      }
      return result;
    },
    refetchInterval: (query) => {
      const st = query.state.data;
      if (st?.running) return 1000;
      return false;
    },
  });

  // Both endpoints return imported world views; prefer the longer list
  const extractWVs = extractStatus?.importedWorldViews ?? [];
  const importWVs = importStatus?.importedWorldViews ?? [];
  const importedWorldViews = extractWVs.length >= importWVs.length ? extractWVs : importWVs;

  // ─── Extraction mutations ───────────────────────────────────────────

  // Initialize useCache based on whether cache exists
  const cacheInfo = extractStatus?.cache;

  const extractMutation = useMutation({
    mutationFn: () => startWikivoyageExtraction(name, useCache),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
  });

  const cancelExtractMutation = useMutation({
    mutationFn: cancelExtraction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
  });

  // ─── File import mutations ──────────────────────────────────────────

  const importMutation = useMutation({
    mutationFn: () => startWorldViewImport(name, treeData, matchingPolicy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
    },
  });

  const cancelImportMutation = useMutation({
    mutationFn: cancelImport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError('');
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
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

  // ─── Combined status ────────────────────────────────────────────────

  const isExtracting = extractStatus?.running === true;
  const isImporting = importStatus?.running === true;
  const isRunning = isExtracting || isImporting;

  // Use extraction status as primary when active
  const activeStatus = isExtracting ? extractStatus : importStatus;
  const isComplete = !isRunning && activeStatus?.status === 'complete';
  const isFailed = !isRunning && activeStatus?.status === 'failed';
  const isCancelled = !isRunning && activeStatus?.status === 'cancelled';
  const hasResult = isComplete || isFailed || isCancelled;

  // Determine which world view to review
  const activeWorldViewId = activeStatus?.worldViewId ?? reviewWorldViewId;

  // Show match review if requested
  if (showReview && activeWorldViewId) {
    return (
      <Box>
        <Button onClick={() => setShowReview(false)} sx={{ mb: 2 }}>
          Back to Import
        </Button>
        <WorldViewImportReview
          worldViewId={activeWorldViewId}
          onFinalize={() => {
            setShowReview(false);
            queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
          }}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        WorldView Import
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Fetch the full Wikivoyage region hierarchy and import it as a WorldView,
        or upload a pre-generated JSON file.
      </Typography>

      {/* Existing imported world views — persist across sessions */}
      {!isRunning && importedWorldViews.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              Existing Imported WorldViews
            </Typography>
            <Stack spacing={1}>
              {importedWorldViews.map(wv => (
                <Box key={wv.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {wv.name} (ID: {wv.id})
                    {wv.sourceType && (
                      <Chip
                        label={wv.sourceType.replace('_done', '')}
                        size="small"
                        variant="outlined"
                        sx={{ ml: 1, height: 20 }}
                      />
                    )}
                    {wv.reviewComplete && (
                      <Chip label="Review complete" size="small" color="success" variant="outlined" sx={{ ml: 1, height: 20 }} />
                    )}
                  </Typography>
                  {!wv.reviewComplete && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setReviewWorldViewId(wv.id);
                        setShowReview(true);
                      }}
                    >
                      Review Matches
                    </Button>
                  )}
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Primary: Fetch from Wikivoyage */}
      {!isRunning && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label="WorldView Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                size="small"
              />

              {extractMutation.isError && (
                <Alert severity="error">{(extractMutation.error as Error).message}</Alert>
              )}

              <Button
                variant="contained"
                startIcon={<LanguageIcon />}
                onClick={() => extractMutation.mutate()}
                disabled={!name.trim() || extractMutation.isPending}
                size="large"
              >
                Fetch from Wikivoyage
              </Button>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={useCache}
                    onChange={(e) => setUseCache(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Typography variant="caption" color="text.secondary">
                    Use cached data
                    {cacheInfo?.exists && cacheInfo.sizeBytes && (
                      <> ({(cacheInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        {cacheInfo.modifiedAt && <>, {new Date(cacheInfo.modifiedAt).toLocaleDateString()}</>}
                      )</>
                    )}
                  </Typography>
                }
              />

              <Typography variant="caption" color="text.secondary">
                Extracts ~4,500 regions from English Wikivoyage, enriches with Wikidata IDs,
                then imports and matches countries to GADM divisions. Takes 20-40 minutes.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Secondary: File upload in accordion */}
      {!isRunning && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" color="text.secondary">
              Or upload from file
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
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
                disabled={!treeData || !name.trim() || importMutation.isPending}
              >
                Start Import
              </Button>
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Progress / Results */}
      {(isRunning || hasResult) && activeStatus && (
        <Card sx={{ mb: 3, mt: isRunning ? 0 : 2 }}>
          <CardContent>
            <Stack spacing={2}>
              {/* Status header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isRunning && <LinearProgress sx={{ flex: 1 }} />}
                {isComplete && <CheckIcon color="success" />}
                {isFailed && <ErrorIcon color="error" />}
                {isCancelled && <CancelIcon color="warning" />}
                <Typography variant="body2" color="text.secondary">
                  {activeStatus.statusMessage}
                </Typography>
              </Box>

              {/* Extraction progress (phases 1-2) */}
              {isExtracting && extractStatus &&
                (extractStatus.status === 'extracting' || extractStatus.status === 'enriching') && (
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(
                      ((extractStatus.regionsFetched ?? 0) / (extractStatus.estimatedTotal ?? 4500)) * 100,
                      99,
                    )}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {extractStatus.status === 'extracting'
                      ? `Extracting regions: ${extractStatus.regionsFetched ?? 0} / ~${extractStatus.estimatedTotal ?? 4500}`
                      : 'Enriching with Wikidata IDs...'
                    }
                    {extractStatus.currentPage && (
                      <> — {extractStatus.currentPage}</>
                    )}
                  </Typography>
                  <br />
                  <Typography variant="caption" color="text.secondary">
                    API requests: {extractStatus.apiRequests ?? 0} | Cache hits: {extractStatus.cacheHits ?? 0}
                  </Typography>
                </Box>
              )}

              {/* Import progress (phase 3) */}
              {isRunning && activeStatus.status === 'importing' && (activeStatus.totalRegions ?? 0) > 0 && (
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={((activeStatus.createdRegions ?? 0) / (activeStatus.totalRegions ?? 1)) * 100}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Creating regions: {activeStatus.createdRegions}/{activeStatus.totalRegions}
                  </Typography>
                </Box>
              )}

              {/* Matching progress (phase 4) */}
              {isRunning && activeStatus.status === 'matching' && (activeStatus.totalCountries ?? 0) > 0 && (
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={((activeStatus.countriesMatched ?? 0) / (activeStatus.totalCountries ?? 1)) * 100}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Matching countries: {activeStatus.countriesMatched}/{activeStatus.totalCountries}
                  </Typography>
                </Box>
              )}

              {/* Stats chips */}
              {(isComplete || (isRunning && (activeStatus.status === 'matching' || activeStatus.status === 'importing'))) && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {(activeStatus.createdRegions ?? 0) > 0 && (
                    <Chip
                      label={`${activeStatus.createdRegions} regions`}
                      color="primary"
                      size="small"
                    />
                  )}
                  {(activeStatus.countriesMatched ?? 0) > 0 && (
                    <Chip
                      label={`${activeStatus.countriesMatched} countries matched`}
                      color="success"
                      size="small"
                    />
                  )}
                  {(activeStatus.subdivisionsDrilled ?? 0) > 0 && (
                    <Chip
                      label={`${activeStatus.subdivisionsDrilled} subdivision drill-downs`}
                      color="info"
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {(activeStatus.noCandidates ?? 0) > 0 && (
                    <Chip
                      label={`${activeStatus.noCandidates} no candidates`}
                      color="default"
                      size="small"
                    />
                  )}
                </Box>
              )}

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 1 }}>
                {isExtracting && (
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={() => cancelExtractMutation.mutate()}
                    disabled={cancelExtractMutation.isPending}
                  >
                    Cancel
                  </Button>
                )}
                {isImporting && !isExtracting && (
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={() => cancelImportMutation.mutate()}
                    disabled={cancelImportMutation.isPending}
                  >
                    Cancel Import
                  </Button>
                )}
                {isComplete && activeStatus.worldViewId && (
                  <Button
                    variant="contained"
                    onClick={() => setShowReview(true)}
                  >
                    Review Matches
                  </Button>
                )}
              </Box>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
