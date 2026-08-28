/**
 * WorldView Import Panel
 *
 * Import sources (Wikivoyage, file upload, base layer) are registered in
 * importSources/ and started through the shared ImportSourcePanel — this
 * component owns the rest: the existing-world-views list, match review, and
 * the multi-phase progress UI (extraction → enrichment → import → matching).
 */

import { useState } from 'react';
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
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  QuestionAnswer as QuestionIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getImportStatus,
  cancelImport,
} from '../../api/admin/worldViewImport';
import {
  getExtractionStatus,
  cancelExtraction,
  answerExtractionQuestion,
} from '../../api/admin/wikivoyageExtract';
import type { PendingQuestion, RegionPreview } from '../../api/admin/wikivoyageExtract';
import { WorldViewImportReview } from './WorldViewImportReview';
import { ImportSourcePanel } from './ImportSourcePanel';
import { safeHref } from '../../utils/safeHref';

type AnswerAction = { questionId: number; action: 'accept' | 'skip' | 'answer' | 'delete_rule'; answer?: string; ruleId?: number };

/** Extracted regions preview list (one entry per region with optional children) */
function ExtractedRegionsPreview({ regions }: { regions: RegionPreview[] }) {
  return (
    <Box sx={{ mt: 0.5, pl: 1, borderLeft: 2, borderColor: 'divider', mb: 1 }}>
      <Typography variant="caption" color="text.secondary">
        AI extracted {regions.length} region{regions.length !== 1 ? 's' : ''}:
      </Typography>
      {regions.map((r, i) => (
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
              {' '}&rarr; <RegionChildrenList childNames={r.children} childPageExists={r.childPageExists} />
            </Typography>
          )}
        </Typography>
      ))}
    </Box>
  );
}

/** Inline children list — separated helper to avoid deeply-nested map callbacks */
function RegionChildrenList({ childNames, childPageExists }: { childNames: string[]; childPageExists?: Record<string, boolean> }) {
  return (
    <>
      {childNames.map((c, ci) => {

        const hasPage = childPageExists?.[c];
        return (
          <span key={ci}>
            {ci > 0 && ', '}
            <span style={hasPage === false ? { color: 'var(--mui-palette-error-main, #d32f2f)' } : undefined}>
              {c}{hasPage === false ? ' (no page)' : ''}
            </span>
          </span>
        );
      })}
    </>
  );
}

/** "Other" option that toggles between a button and an inline text-answer field */
function OtherOptionBlock({ q, label, isAnswering, showCustomInputOpen, customAnswer, onShowInput, onHideInput, onChangeAnswer, onSubmit }: {
  q: PendingQuestion;
  label: string;
  isAnswering: boolean;
  showCustomInputOpen: boolean;
  customAnswer: string;
  onShowInput: (questionId: number) => void;
  onHideInput: (questionId: number) => void;
  onChangeAnswer: (questionId: number, value: string) => void;
  onSubmit: (action: AnswerAction) => void;
}) {
  if (showCustomInputOpen) {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          placeholder="Type your answer..."
          value={customAnswer}
          onChange={(e) => onChangeAnswer(q.id, e.target.value)}
          disabled={isAnswering}
          autoFocus
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => onSubmit({ questionId: q.id, action: 'answer', answer: customAnswer.trim() })}
          disabled={isAnswering || !customAnswer.trim()}
        >
          Send
        </Button>
        <Button
          size="small"
          color="inherit"
          onClick={() => onHideInput(q.id)}
        >
          Cancel
        </Button>
      </Box>
    );
  }
  return (
    <Button
      size="small"
      variant="text"
      color="inherit"
      onClick={() => onShowInput(q.id)}
      disabled={isAnswering}
      sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
    >
      {label}...
    </Button>
  );
}

/** List wrapper around QuestionCard — only shows when at least one question is ready for review */
function InterviewQuestionsList({ pendingQuestions, answerMutation, answerError, customAnswers, setCustomAnswers, showCustomInput, setShowCustomInput }: {
  pendingQuestions: PendingQuestion[] | undefined;
  answerMutation: { mutate: (action: AnswerAction) => void; isPending: boolean; variables?: AnswerAction };
  answerError: { questionId: number; message: string } | null;
  customAnswers: Record<number, string>;
  setCustomAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  showCustomInput: Record<number, boolean>;
  setShowCustomInput: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
}) {
  const readyQuestions = pendingQuestions?.filter(q => q.currentQuestion != null) ?? [];
  if (readyQuestions.length === 0) return null;

  const handleShowInput = (questionId: number) => setShowCustomInput(prev => ({ ...prev, [questionId]: true }));
  const handleHideInput = (questionId: number) => setShowCustomInput(prev => ({ ...prev, [questionId]: false }));
  const handleChangeAnswer = (questionId: number, value: string) => setCustomAnswers(prev => ({ ...prev, [questionId]: value }));
  const handleAnswer = (action: AnswerAction) => answerMutation.mutate(action);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        <QuestionIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
        {readyQuestions.length} AI question{readyQuestions.length !== 1 ? 's' : ''} for review
      </Typography>
      <Stack spacing={1.5}>
        {readyQuestions.map(q => {
          const isAnswering = answerMutation.isPending && answerMutation.variables?.questionId === q.id;
          return (
            <QuestionCard
              key={q.id}
              q={q}
              isAnswering={isAnswering}
              showCustomInputOpen={!!showCustomInput[q.id]}
              customAnswer={customAnswers[q.id] ?? ''}
              onShowInput={handleShowInput}
              onHideInput={handleHideInput}
              onChangeAnswer={handleChangeAnswer}
              onAnswer={handleAnswer}
              answerError={answerError}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

/** A single interview question card — extracted to keep WorldViewImportPanel's body shallow */
function QuestionCard({ q, isAnswering, showCustomInputOpen, customAnswer, onShowInput, onHideInput, onChangeAnswer, onAnswer, answerError }: {
  q: PendingQuestion;
  isAnswering: boolean;
  showCustomInputOpen: boolean;
  customAnswer: string;
  onShowInput: (questionId: number) => void;
  onHideInput: (questionId: number) => void;
  onChangeAnswer: (questionId: number, value: string) => void;
  onAnswer: (action: AnswerAction) => void;
  answerError: { questionId: number; message: string } | null;
}) {
  // Built on the server from the page's title today, and held to what a link
  // may be all the same (#703): a page the rule refuses is named, not linked.
  const sourceHref = safeHref(q.sourceUrl);
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'warning.main' }}>
      {/* Header: page title + link */}
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {sourceHref ? (
          <a href={sourceHref} target="_blank" rel="noopener noreferrer">
            {q.pageTitle}
          </a>
        ) : q.pageTitle}
      </Typography>

      <ExtractedRegionsPreview regions={q.extractedRegions} />

      {/* Interview question with options */}
      {q.currentQuestion ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
            {q.currentQuestion.text}
          </Typography>
          <Stack spacing={0.5}>
            {q.currentQuestion.options.map((opt, i) => {
              const isRecommended = q.currentQuestion!.recommended === i;
              if (opt.value === 'other') {
                return (
                  <Box key={i}>
                    <OtherOptionBlock
                      q={q}
                      label={opt.label}
                      isAnswering={isAnswering}
                      showCustomInputOpen={showCustomInputOpen}
                      customAnswer={customAnswer}
                      onShowInput={onShowInput}
                      onHideInput={onHideInput}
                      onChangeAnswer={onChangeAnswer}
                      onSubmit={onAnswer}
                    />
                  </Box>
                );
              }
              return (
                <Button
                  key={i}
                  size="small"
                  variant={isRecommended ? 'contained' : 'outlined'}
                  color={isRecommended ? 'primary' : 'inherit'}
                  onClick={() => onAnswer({ questionId: q.id, action: 'answer', answer: opt.value })}
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
                onClick={() => onAnswer({ questionId: q.id, action: 'delete_rule', ruleId: rule.id })}
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
          onClick={() => onAnswer({ questionId: q.id, action: 'accept' })}
          disabled={isAnswering}
        >
          Accept as-is
        </Button>
        <Button
          size="small"
          color="inherit"
          onClick={() => onAnswer({ questionId: q.id, action: 'skip' })}
          disabled={isAnswering}
        >
          Skip
        </Button>
      </Box>
    </Paper>
  );
}

export function WorldViewImportPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('Wikivoyage Regions');
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

  const cancelExtractMutation = useMutation({
    mutationFn: cancelExtraction,
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

  const cancelImportMutation = useMutation({
    mutationFn: cancelImport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
    },
  });

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
        Pick a source below — Wikivoyage, a JSON file, or the administrative
        base layer — and the shared pipeline handles matching and review from
        there.
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
                          queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'importStatus'] });
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

      {/* Start an import: source selection + world view name */}
      {!isRunning && (
        <ImportSourcePanel worldViewName={name} onWorldViewNameChange={setName} />
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
              <InterviewQuestionsList
                pendingQuestions={extractStatus?.pendingQuestions}
                answerMutation={answerMutation}
                answerError={answerError}
                customAnswers={customAnswers}
                setCustomAnswers={setCustomAnswers}
                showCustomInput={showCustomInput}
                setShowCustomInput={setShowCustomInput}
              />


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
