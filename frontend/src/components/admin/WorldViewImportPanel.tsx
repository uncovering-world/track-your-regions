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
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  Upload as UploadIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Cancel as CancelIcon,
  ExpandMore as ExpandMoreIcon,
  Language as LanguageIcon,
  Delete as DeleteIcon,
  QuestionAnswer as QuestionIcon,
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
  answerExtractionQuestion,
  deleteCacheFile,
} from '../../api/adminWikivoyageExtract';
import type { CacheEntry } from '../../api/adminWikivoyageExtract';
import { WorldViewImportReview } from './WorldViewImportReview';

export function WorldViewImportPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('Wikivoyage Regions');
  const [treeData, setTreeData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [matchingPolicy, setMatchingPolicy] = useState<'country-based' | 'none'>('country-based');
  const [selectedCache, setSelectedCache] = useState<string | undefined>(undefined); // undefined = default, 'none' = clean
  const [showReview, setShowReview] = useState(false);
  const [reviewWorldViewId, setReviewWorldViewId] = useState<number | null>(null);
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<number, boolean>>({});
  const [answerError, setAnswerError] = useState<{ questionId: number; message: string } | null>(null);

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

  const caches: CacheEntry[] = extractStatus?.caches ?? [];

  const extractMutation = useMutation({
    mutationFn: () => startWikivoyageExtraction(name, selectedCache),
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

  const deleteCacheMutation = useMutation({
    mutationFn: deleteCacheFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
  });

  const answerMutation = useMutation({
    mutationFn: (params: { questionId: number; action: 'accept' | 'skip' | 'answer' | 'delete_rule'; answer?: string; ruleId?: number }) =>
      answerExtractionQuestion(params.questionId, params.action, params.answer, params.ruleId),
    onMutate: () => setAnswerError(null),
    onSuccess: (_data, variables) => {
      setCustomAnswers(prev => { const next = { ...prev }; delete next[variables.questionId]; return next; });
      setShowCustomInput(prev => { const next = { ...prev }; delete next[variables.questionId]; return next; });
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
    },
    onError: (err: Error, variables) => {
      // If question was already resolved (race condition), just refresh silently
      if (err.message.includes('already resolved') || err.message.includes('not found')) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
        return;
      }
      setAnswerError({ questionId: variables.questionId, message: err.message });
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
                  <Typography variant="body2" component="span" sx={{ flex: 1 }}>
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
                  <Tooltip title="Delete this world view">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={async () => {
                        if (window.confirm(`Delete world view "${wv.name}"? This will remove all its regions and assignments.`)) {
                          const { deleteWorldView } = await import('../../api/worldViews');
                          await deleteWorldView(wv.id);
                          queryClient.invalidateQueries({ queryKey: ['admin', 'wvExtract', 'status'] });
                          queryClient.invalidateQueries({ queryKey: ['worldViews'] });
                        }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
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
                      ((extractStatus.regionsFetched ?? 0) / (extractStatus.estimatedTotal ?? 5700)) * 100,
                      99,
                    )}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {extractStatus.status === 'extracting'
                      ? `Extracting regions: ${extractStatus.regionsFetched ?? 0} / ~${extractStatus.estimatedTotal ?? 5700}`
                      : 'Enriching with Wikidata IDs...'
                    }
                    {extractStatus.currentPage && (
                      <> — {extractStatus.currentPage}</>
                    )}
                    {extractStatus.status === 'extracting' && extractStatus.startedAt && (extractStatus.regionsFetched ?? 0) > 50 && (() => {
                      const elapsed = (Date.now() - extractStatus.startedAt!) / 1000;
                      const rate = (extractStatus.regionsFetched ?? 0) / elapsed;
                      const remaining = ((extractStatus.estimatedTotal ?? 5700) - (extractStatus.regionsFetched ?? 0)) / rate;
                      if (remaining <= 0 || !isFinite(remaining)) return null;
                      const mins = Math.floor(remaining / 60);
                      const secs = Math.floor(remaining % 60);
                      return <> — ETA: {mins > 0 ? `${mins}m ` : ''}{secs}s</>;
                    })()}
                  </Typography>
                  <br />
                  <Typography variant="caption" color="text.secondary">
                    API requests: {extractStatus.apiRequests ?? 0} | Cache hits: {extractStatus.cacheHits ?? 0}
                    {extractStatus.startedAt && (() => {
                      const elapsed = (Date.now() - extractStatus.startedAt!) / 1000;
                      const rate = (extractStatus.regionsFetched ?? 0) / elapsed;
                      return rate > 0 ? ` | ${rate.toFixed(1)} regions/s` : '';
                    })()}
                    {(extractStatus.aiApiCalls ?? 0) > 0 && (
                      ` | AI: ${extractStatus.aiApiCalls} calls ($${(extractStatus.aiTotalCost ?? 0).toFixed(2)})`
                    )}
                  </Typography>
                </Box>
              )}

              {/* AI Interview Questions — structured HITL decision making */}
              {(() => {
                // Only show questions that have finished formulation (currentQuestion populated)
                // Auto-resolved questions disappear before reaching this point
                const readyQuestions = extractStatus?.pendingQuestions?.filter(q => q.currentQuestion != null) ?? [];
                return readyQuestions.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    <QuestionIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                    {readyQuestions.length} AI question{readyQuestions.length !== 1 ? 's' : ''} for review
                  </Typography>
                  <Stack spacing={1.5}>
                    {readyQuestions.map(q => {
                      const isAnswering = answerMutation.isPending && answerMutation.variables?.questionId === q.id;
                      return (
                      <Paper key={q.id} variant="outlined" sx={{ p: 1.5, borderColor: 'warning.main' }}>
                        {/* Header: page title + link */}
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">
                            {q.pageTitle}
                          </a>
                        </Typography>

                        {/* Region preview (collapsible context) */}
                        <Box sx={{ mt: 0.5, pl: 1, borderLeft: 2, borderColor: 'divider', mb: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            AI extracted {q.extractedRegions.length} region{q.extractedRegions.length !== 1 ? 's' : ''}:
                          </Typography>
                          {q.extractedRegions.map((r, i: number) => (
                            <Typography key={i} variant="body2" sx={{ ml: 1 }}>
                              {r.isLink ? (
                                <Typography component="span" variant="body2" color={r.pageExists === false ? 'error.main' : 'text.primary'}>
                                  {r.name}
                                  {r.pageExists === false && (
                                    <Typography component="span" variant="caption" color="error.main"> (no page)</Typography>
                                  )}
                                </Typography>
                              ) : (
                                <Typography component="span" variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                  {r.name} <Typography component="span" variant="caption">(grouping)</Typography>
                                </Typography>
                              )}
                              {r.children.length > 0 && (
                                <Typography component="span" variant="caption" color="text.secondary">
                                  {' '}&rarr; {r.children.map((c, ci) => {
                                    const hasPage = r.childPageExists?.[c];
                                    return (
                                      <span key={ci}>
                                        {ci > 0 && ', '}
                                        <span style={hasPage === false ? { color: 'var(--mui-palette-error-main, #d32f2f)' } : undefined}>
                                          {c}{hasPage === false ? ' (no page)' : ''}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </Typography>
                              )}
                            </Typography>
                          ))}
                        </Box>

                        {/* Interview question with options */}
                        {q.currentQuestion ? (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                              {q.currentQuestion.text}
                            </Typography>
                            {/* Option buttons */}
                            <Stack spacing={0.5}>
                              {q.currentQuestion.options.map((opt, i) => {
                                const isRecommended = q.currentQuestion!.recommended === i;
                                const isOther = opt.value === 'other';

                                if (isOther) {
                                  // "Other" option: show text input when expanded
                                  return (
                                    <Box key={i}>
                                      {showCustomInput[q.id] ? (
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                          <TextField
                                            size="small"
                                            sx={{ flex: 1 }}
                                            placeholder="Type your answer..."
                                            value={customAnswers[q.id] ?? ''}
                                            onChange={(e) => setCustomAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                                            disabled={isAnswering}
                                            autoFocus
                                          />
                                          <Button
                                            size="small"
                                            variant="contained"
                                            onClick={() => answerMutation.mutate({
                                              questionId: q.id,
                                              action: 'answer',
                                              answer: customAnswers[q.id]?.trim(),
                                            })}
                                            disabled={isAnswering || !customAnswers[q.id]?.trim()}
                                          >
                                            Send
                                          </Button>
                                          <Button
                                            size="small"
                                            color="inherit"
                                            onClick={() => setShowCustomInput(prev => ({ ...prev, [q.id]: false }))}
                                          >
                                            Cancel
                                          </Button>
                                        </Box>
                                      ) : (
                                        <Button
                                          size="small"
                                          variant="text"
                                          color="inherit"
                                          onClick={() => setShowCustomInput(prev => ({ ...prev, [q.id]: true }))}
                                          disabled={isAnswering}
                                          sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                                        >
                                          {opt.label}...
                                        </Button>
                                      )}
                                    </Box>
                                  );
                                }

                                return (
                                  <Button
                                    key={i}
                                    size="small"
                                    variant={isRecommended ? 'contained' : 'outlined'}
                                    color={isRecommended ? 'primary' : 'inherit'}
                                    onClick={() => answerMutation.mutate({
                                      questionId: q.id,
                                      action: 'answer',
                                      answer: opt.value,
                                    })}
                                    disabled={isAnswering}
                                    sx={{
                                      justifyContent: 'flex-start',
                                      textTransform: 'none',
                                      ...(isRecommended && { fontWeight: 600 }),
                                    }}
                                  >
                                    {opt.label}
                                    {isRecommended && (
                                      <Chip label="recommended" size="small" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />
                                    )}
                                  </Button>
                                );
                              })}
                            </Stack>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            Formulating question...
                          </Typography>
                        )}

                        {/* Related rules — admin can delete problematic ones */}
                        {q.currentQuestion?.relatedRules && q.currentQuestion.relatedRules.length > 0 && (
                          <Alert severity="info" sx={{ mt: 1 }} icon={false}>
                            <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>
                              Related existing rules:
                            </Typography>
                            {q.currentQuestion.relatedRules.map(rule => (
                              <Box key={rule.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                                <Typography variant="caption" sx={{ flex: 1 }}>
                                  #{rule.id}: {rule.text}
                                </Typography>
                                <Button
                                  size="small"
                                  color="error"
                                  sx={{ minWidth: 'auto', px: 1, py: 0, fontSize: '0.7rem' }}
                                  onClick={() => answerMutation.mutate({
                                    questionId: q.id,
                                    action: 'delete_rule',
                                    ruleId: rule.id,
                                  })}
                                  disabled={isAnswering}
                                >
                                  Delete rule
                                </Button>
                              </Box>
                            ))}
                          </Alert>
                        )}

                        {/* Error display */}
                        {answerError?.questionId === q.id && (
                          <Alert severity="error" sx={{ mt: 1 }}>{answerError.message}</Alert>
                        )}

                        {/* Quick actions: accept as-is / skip */}
                        <Box sx={{ display: 'flex', gap: 1, mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                          <Button
                            size="small"
                            color="success"
                            onClick={() => answerMutation.mutate({ questionId: q.id, action: 'accept' })}
                            disabled={isAnswering}
                          >
                            Accept as-is
                          </Button>
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => answerMutation.mutate({ questionId: q.id, action: 'skip' })}
                            disabled={isAnswering}
                          >
                            Skip
                          </Button>
                        </Box>
                      </Paper>
                      );
                    })}
                  </Stack>
                </Box>
                );
              })()}

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
