/**
 * Extraction Rules Panel
 *
 * Standalone admin page for managing AI extraction rules (built-in + learned).
 * Supports AI-powered review for finding duplicates and contradictions.
 */

import { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  Chip,
  Snackbar,
  Alert,
  CircularProgress,
  Tooltip,
  Button,
  TextField,
  IconButton,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  AutoFixHigh as ReviewIcon,
  Check as ApplyIcon,
  MergeType as MergeIcon,
  Warning as ConflictIcon,
  DeleteSweep as ObsoleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getLearnedRules,
  addLearnedRule,
  deleteLearnedRule,
  reviewLearnedRules,
  applyRuleReviewSuggestion,
  type RuleReviewResult,
} from '../../api/adminAI';

/** Maps raw feature names (from DB) to display labels */
const FEATURE_LABELS: Record<string, string> = {
  extraction: 'Extraction',
  extraction_interview: 'Extraction Interview',
  matching: 'AI Matching',
  hierarchy_review: 'Hierarchy Review',
  subdivision_assist: 'Subdivision Assist',
  rule_review: 'Rule Review',
};

export function ExtractionRulesPanel() {
  const queryClient = useQueryClient();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });
  const [newRule, setNewRule] = useState({ feature: 'extraction', ruleText: '', context: '' });
  const [reviewResult, setReviewResult] = useState<RuleReviewResult | null>(null);
  // Frozen DB ID → row number mapping, captured when review starts.
  // Keeps numbers stable while applying suggestions so references stay correct.
  const [reviewSnapshot, setReviewSnapshot] = useState<Map<number, number> | null>(null);

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['ai-rules'],
    queryFn: getLearnedRules,
  });

  const predefined = useMemo(() => rulesData?.predefined ?? [], [rulesData?.predefined]);
  const learned = useMemo(() => rulesData?.learned ?? [], [rulesData?.learned]);

  // Map learned rule DB IDs → sequential row numbers (after predefined)
  const dbIdToRowNum = useMemo(() => {
    const map = new Map<number, number>();
    learned.forEach((rule, i) => {
      map.set(rule.id, predefined.length + i + 1);
    });
    return map;
  }, [predefined.length, learned]);

  const addRuleMutation = useMutation({
    mutationFn: () => addLearnedRule(newRule.feature, newRule.ruleText, newRule.context || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-rules'] });
      setNewRule(r => ({ ...r, ruleText: '', context: '' }));
      setSnackbar({ open: true, message: 'Rule added', severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Failed: ${err.message}`, severity: 'error' });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: deleteLearnedRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-rules'] });
      setSnackbar({ open: true, message: 'Rule deleted', severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Failed: ${err.message}`, severity: 'error' });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: reviewLearnedRules,
    onSuccess: (data) => {
      setReviewResult(data);
      // Freeze current numbering so suggestions stay valid as rules are deleted
      setReviewSnapshot(new Map(dbIdToRowNum));
      setSnackbar({ open: true, message: data.summary, severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Review failed: ${err.message}`, severity: 'error' });
    },
  });

  const clearReview = () => {
    setReviewResult(null);
    setReviewSnapshot(null);
  };

  const applyMutation = useMutation({
    mutationFn: applyRuleReviewSuggestion,
    onSuccess: (_data, appliedSuggestion) => {
      queryClient.invalidateQueries({ queryKey: ['ai-rules'] });
      setReviewResult(prev => {
        if (!prev) return null;
        const remaining = prev.suggestions.filter(s => s.keepId !== appliedSuggestion.keepId);
        if (remaining.length === 0) {
          // Last suggestion applied — clear frozen state
          setReviewSnapshot(null);
          return null;
        }
        return { ...prev, suggestions: remaining };
      });
      setSnackbar({ open: true, message: `Applied: ${_data.deletedCount} rule(s) removed`, severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Failed to apply: ${err.message}`, severity: 'error' });
    },
  });

  /** Format a DB rule ID as its display row number (uses frozen snapshot during review) */
  const activeRowMap = reviewSnapshot ?? dbIdToRowNum;
  const formatRuleRef = (dbId: number) => activeRowMap.get(dbId) ?? `?${dbId}`;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Extraction Rules
      </Typography>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h6">
              Rules
            </Typography>
            {learned.length >= 2 && (
              <Button
                size="small"
                variant="outlined"
                startIcon={reviewMutation.isPending ? <CircularProgress size={14} /> : <ReviewIcon />}
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending}
              >
                Review with AI
              </Button>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Built-in and learned rules that guide AI extraction. Learned rules come from admin feedback during interviews.
          </Typography>

          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              {/* Unified rules table: predefined + learned */}
              <Table size="small" sx={{ mb: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell width={50}>#</TableCell>
                    <TableCell>Rule</TableCell>
                    <TableCell width={120}>Origin</TableCell>
                    <TableCell width={40} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/* Predefined rules — numbered 1..N */}
                  {predefined.map((rule, i) => (
                    <TableRow key={rule.code} sx={{ bgcolor: 'action.hover' }}>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">{i + 1}</Typography>
                      </TableCell>
                      <TableCell>{rule.ruleText}</TableCell>
                      <TableCell>
                        <Chip label="built-in" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                  {/* Learned rules — numbered (N+1).., frozen during review */}
                  {learned.map((rule, i) => {
                    const rowNum = activeRowMap.get(rule.id) ?? (predefined.length + i + 1);
                    const originMatch = rule.context?.match(/Interview about "([^"]+)"/);
                    const origin = originMatch ? originMatch[1] : (rule.context ?? '-');
                    return (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">{rowNum}</Typography>
                        </TableCell>
                        <TableCell>{rule.ruleText}</TableCell>
                        <TableCell>
                          <Tooltip title={rule.context ?? ''} placement="left">
                            <Typography variant="body2" color="text.secondary" sx={{ cursor: rule.context ? 'help' : undefined }}>
                              {origin}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => deleteRuleMutation.mutate(rule.id)}
                            disabled={deleteRuleMutation.isPending || reviewResult != null}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* AI Review Results */}
              {reviewResult && reviewResult.suggestions.length > 0 && (
                <Box sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    AI Review: {reviewResult.summary}
                  </Typography>
                  {reviewResult.suggestions.map((s, i) => {
                    const icon = s.type === 'merge' ? <MergeIcon fontSize="small" />
                      : s.type === 'contradiction' ? <ConflictIcon fontSize="small" color="warning" />
                      : <ObsoleteIcon fontSize="small" color="error" />;
                    return (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1, p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                        {icon}
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2">{s.description}</Typography>
                          {s.replacementText && (
                            <Typography variant="body2" color="primary" sx={{ mt: 0.5 }}>
                              Keep #{formatRuleRef(s.keepId)} as: &ldquo;{s.replacementText}&rdquo;
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            Delete: {s.deleteIds.map(id => `#${formatRuleRef(id)}`).join(', ')}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={applyMutation.isPending ? <CircularProgress size={14} /> : <ApplyIcon />}
                          onClick={() => applyMutation.mutate(s)}
                          disabled={applyMutation.isPending}
                        >
                          Apply
                        </Button>
                      </Box>
                    );
                  })}
                  <Button size="small" onClick={clearReview} sx={{ mt: 1 }}>
                    Dismiss
                  </Button>
                </Box>
              )}

              {/* Add new rule */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Select
                  size="small"
                  value={newRule.feature}
                  onChange={e => setNewRule(r => ({ ...r, feature: e.target.value }))}
                  sx={{ minWidth: 140 }}
                >
                  {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                    <MenuItem key={key} value={key}>{label}</MenuItem>
                  ))}
                </Select>
                <TextField
                  size="small"
                  placeholder="Rule (e.g., 'Never split city pages into districts')"
                  value={newRule.ruleText}
                  onChange={e => setNewRule(r => ({ ...r, ruleText: e.target.value }))}
                  sx={{ flex: 2 }}
                />
                <TextField
                  size="small"
                  placeholder="Context (optional)"
                  value={newRule.context}
                  onChange={e => setNewRule(r => ({ ...r, context: e.target.value }))}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addRuleMutation.mutate()}
                  disabled={!newRule.ruleText.trim() || addRuleMutation.isPending}
                >
                  Add
                </Button>
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
