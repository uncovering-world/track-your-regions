/**
 * AI Settings Panel
 *
 * Admin page for AI model configuration and usage dashboard.
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
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
} from '@mui/material';
import {
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAISettings,
  updateAISetting,
  getAIUsage,
  updatePricing,
  type AIModelOption,
} from '../../api/adminAI';

const FEATURE_LABELS: Record<string, { label: string; description: string }> = {
  'model.matching': { label: 'AI Matching', description: 'Matches imported regions to GADM administrative divisions. Used when clicking the AI match button on individual regions or running batch AI matching.' },
  'model.hierarchy_review': { label: 'Hierarchy Review', description: 'Reviews the import tree for structural issues (missing regions, odd nesting, depth imbalance). Triggered by the "AI Review" button in the import tree toolbar.' },
  'model.review_children': { label: 'Suggest Children', description: 'Fetches a region\'s Wikivoyage page, extracts listed sub-regions, and uses AI to identify missing children. Triggered by the sparkle button on nodes with a source URL.' },
  'model.extraction': { label: 'Extraction (Wikivoyage)', description: 'Classifies ambiguous Wikivoyage pages during region extraction (is this a region, a city, or a redirect?). Runs during the initial Wikivoyage import.' },
  'model.extraction_interview': { label: 'Extraction Interview', description: 'Formulates and processes questions about ambiguous region classifications during extraction. Works alongside the extraction model.' },
  'model.subdivision_assist': { label: 'Subdivision Assist', description: 'Helps assign GADM subdivisions to matched regions, suggesting which sub-divisions belong to which parent.' },
  'model.rule_review': { label: 'Rule Review', description: 'Reviews learned AI rules for duplicates and contradictions. Triggered from the Extraction Rules panel.' },
  'model.vision_match': { label: 'Vision Match', description: 'Uses GPT-4o vision to identify which GADM divisions fall within a region by analyzing the region\'s map image. Triggered by the "Suggest with AI" button in the union/split preview dialog.' },
  'model.cv_cluster_match': { label: 'CV Cluster Match', description: 'Matches K-means color clusters to Wikivoyage region names using geographic knowledge of GADM division names. Triggered by "AI Suggest" in the CV match assignment review.' },
};

/** Maps raw feature names (from DB) to display labels */
const RAW_FEATURE_LABELS: Record<string, string> = {
  matching: 'AI Matching',
  hierarchy_review: 'Hierarchy Review',
  review_children: 'Suggest Children',
  extraction: 'Extraction',
  extraction_interview: 'Extraction Interview',
  subdivision_assist: 'Subdivision Assist',
  rule_review: 'Rule Review',
  vision_match: 'Vision Match',
  cv_cluster_match: 'CV Cluster Match',
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

/**
 * Estimated total token usage for a standard full session of each feature.
 * Extraction: ~400 ambiguous pages (7% of ~5700) × ~1K in / ~200 out per call
 * Matching: ~230 countries × ~2K in / ~500 out per country
 * Hierarchy review: ~50 flagged nodes × ~1.5K in / ~400 out per node
 * Subdivision assist: ~20 assists × ~2K in / ~500 out per call
 */
const SESSION_ESTIMATES: Record<string, { inputTokens: number; outputTokens: number; session: string; description: string }> = {
  'model.extraction': { inputTokens: 400_000, outputTokens: 80_000, session: 'Full Wikivoyage extraction (~5,700 regions)', description: '~400 AI calls for ambiguous region pages (7% of total)' },
  'model.extraction_interview': { inputTokens: 50_000, outputTokens: 15_000, session: 'Interview for ambiguous extractions', description: '~30 questions × 2 calls each (formulate + process answer)' },
  'model.matching': { inputTokens: 460_000, outputTokens: 115_000, session: 'Match all countries to GADM', description: '~230 countries × AI-assisted GADM matching' },
  'model.hierarchy_review': { inputTokens: 75_000, outputTokens: 20_000, session: 'Review all flagged hierarchy nodes', description: '~50 flagged nodes × AI review for missing children' },
  'model.review_children': { inputTokens: 3_000, outputTokens: 1_000, session: 'Single suggest-children call', description: '~1 call per region: Wikivoyage page + AI analysis for missing sub-regions' },
  'model.subdivision_assist': { inputTokens: 40_000, outputTokens: 10_000, session: 'Assist with subdivision assignments', description: '~20 AI-assisted subdivision groupings' },
  'model.rule_review': { inputTokens: 2_000, outputTokens: 1_000, session: 'Review learned rules', description: '1 call to analyze all rules for duplicates/contradictions' },
  'model.vision_match': { inputTokens: 5_000, outputTokens: 500, session: 'Single vision match call', description: '1 GPT-4o vision call per region: image analysis + division list matching' },
  'model.cv_cluster_match': { inputTokens: 4_000, outputTokens: 500, session: 'Single cluster-to-region match', description: '1 call per CV match: division names per cluster → region name mapping' },
};

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sessionCostInfo(model: AIModelOption, featureKey: string): { cost: string; session: string; tooltip: string } | null {
  const est = SESSION_ESTIMATES[featureKey];
  if (!est) return null;
  const cost = (est.inputTokens / 1_000_000) * model.inputPer1M + (est.outputTokens / 1_000_000) * model.outputPer1M;
  return {
    cost: `~${formatCost(cost)}`,
    session: est.session,
    tooltip: `${est.description}\n~${formatTokens(est.inputTokens)} in / ~${formatTokens(est.outputTokens)} out`,
  };
}

export function AISettingsPanel() {
  const queryClient = useQueryClient();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });
  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: getAISettings,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['ai-usage'],
    queryFn: getAIUsage,
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateAISetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      setSnackbar({ open: true, message: 'Model updated', severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Failed: ${err.message}`, severity: 'error' });
    },
  });

  const pricingMutation = useMutation({
    mutationFn: updatePricing,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      setSnackbar({ open: true, message: `Pricing updated: ${data.totalModels} models (+${data.modelsAdded} new)`, severity: 'success' });
    },
    onError: (err: Error) => {
      setSnackbar({ open: true, message: `Failed to update pricing: ${err.message}`, severity: 'error' });
    },
  });

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        AI Settings
      </Typography>

      {/* Card 1: Model Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h6">
              Model Configuration
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={pricingMutation.isPending ? <CircularProgress size={14} /> : <RefreshIcon />}
              onClick={() => pricingMutation.mutate()}
              disabled={pricingMutation.isPending}
            >
              Update Pricing
            </Button>
          </Box>
          {settingsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Feature</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Price per 1M tokens</TableCell>
                  <TableCell>Est. Full Session</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {FEATURE_KEYS.map(key => {
                  const currentValue = settingsData?.settings[key] ?? 'gpt-4.1-mini';
                  const models = settingsData?.models ?? [];
                  const currentModel = models.find(m => m.id === currentValue);
                  const info = currentModel ? sessionCostInfo(currentModel, key) : null;
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <Tooltip title={FEATURE_LABELS[key]?.description ?? ''} placement="right">
                          <span>{FEATURE_LABELS[key]?.label ?? key}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Select
                          size="small"
                          value={currentValue}
                          onChange={e => updateMutation.mutate({ key, value: e.target.value })}
                          sx={{ minWidth: 200 }}
                        >
                          {models.map(m => (
                            <MenuItem key={m.id} value={m.id}>{m.id}</MenuItem>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {currentModel ? `$${currentModel.inputPer1M} in / $${currentModel.outputPer1M} out` : '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {info ? (
                          <Tooltip title={info.tooltip}>
                            <Box>
                              <Typography variant="body2" color="text.secondary">
                                {info.cost}
                              </Typography>
                              <Typography variant="caption" color="text.disabled">
                                {info.session}
                              </Typography>
                            </Box>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Usage Dashboard — aggregated by model+feature */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Usage Dashboard
          </Typography>

          {usageLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              {/* Summary chips */}
              <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                <Chip label={`Today: ${formatCost(usageData?.today ?? 0)}`} color="primary" variant="outlined" />
                <Chip label={`This Month: ${formatCost(usageData?.thisMonth ?? 0)}`} color="primary" variant="outlined" />
                <Chip label={`All Time: ${formatCost(usageData?.allTime ?? 0)}`} color="primary" />
              </Box>

              {/* Usage table — grouped by model+feature */}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Feature</TableCell>
                      <TableCell>Model</TableCell>
                      <TableCell align="right">Total Calls</TableCell>
                      <TableCell align="right">Tokens (in/out)</TableCell>
                      <TableCell align="right">Total Cost</TableCell>
                      <TableCell align="right">Avg / Call</TableCell>
                      <TableCell>Last Used</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(usageData?.byModelFeature ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center">
                          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                            No AI usage recorded yet
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      usageData!.byModelFeature.map(row => (
                        <TableRow key={`${row.feature}-${row.model}`}>
                          <TableCell>{RAW_FEATURE_LABELS[row.feature] ?? row.feature}</TableCell>
                          <TableCell>{row.model}</TableCell>
                          <TableCell align="right">{row.totalCalls.toLocaleString()}</TableCell>
                          <TableCell align="right">
                            <Tooltip title={`${row.totalPromptTokens.toLocaleString()} in / ${row.totalCompletionTokens.toLocaleString()} out`}>
                              <span>{formatTokens(row.totalPromptTokens)} / {formatTokens(row.totalCompletionTokens)}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell align="right">{formatCost(row.totalCost)}</TableCell>
                          <TableCell align="right">{formatCost(row.avgCostPerCall)}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(row.lastUsed)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
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
