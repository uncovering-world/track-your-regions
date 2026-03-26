/**
 * AI Assist header controls: batch button, escalation selector, model selector, usage tracking.
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Badge,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import RefreshIcon from '@mui/icons-material/Refresh';
import PaidIcon from '@mui/icons-material/Paid';
import type { AIModel } from '@/api';
import type { UsageStats, LastOperation } from './aiAssistTypes';
import { AIUsagePopover } from './AIUsagePopover';
import type { EscalationLevel } from './useAISuggestions';

interface AIAssistControlsProps {
  // Batch
  batchProcessing: boolean;
  divisionsToProcessCount: number;
  forceReprocess: boolean;
  setForceReprocess: (value: boolean) => void;
  onBatchProcess: () => void;
  // Auto-assign
  highConfidenceCount: number;
  onAutoAssign: () => void;
  // Escalation
  escalationLevel: EscalationLevel;
  setEscalationLevel: (level: EscalationLevel) => void;
  useWebSearch: boolean;
  setUseWebSearch: (value: boolean) => void;
  effectiveWebSearch: boolean;
  worldViewSource?: string;
  // Model
  currentModel: string;
  availableModels: AIModel[];
  webSearchModelId: string;
  webSearchModels: AIModel[];
  changingModel: boolean;
  onModelChange: (modelId: string) => void;
  onWebSearchModelChange: (modelId: string) => void;
  onRefreshModels: () => void;
  // Usage
  totalStats: UsageStats;
  singleRequestStats: UsageStats;
  batchRequestStats: UsageStats;
  lastOperation: LastOperation | null;
  onResetStats: () => void;
  // Quota
  quotaError: string | null;
}

export function AIAssistControls({
  batchProcessing,
  divisionsToProcessCount,
  forceReprocess,
  setForceReprocess,
  onBatchProcess,
  highConfidenceCount,
  onAutoAssign,
  escalationLevel,
  setEscalationLevel,
  useWebSearch,
  setUseWebSearch,
  effectiveWebSearch,
  worldViewSource,
  currentModel,
  availableModels,
  webSearchModelId,
  webSearchModels,
  changingModel,
  onModelChange,
  onWebSearchModelChange,
  onRefreshModels,
  totalStats,
  singleRequestStats,
  batchRequestStats,
  lastOperation,
  onResetStats,
  quotaError,
}: AIAssistControlsProps) {
  const [usagePopoverAnchor, setUsagePopoverAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      {/* Header with actions */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={batchProcessing ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={onBatchProcess}
            disabled={batchProcessing || divisionsToProcessCount === 0 || !!quotaError}
          >
            {batchProcessing
              ? 'Processing...'
              : divisionsToProcessCount === 0
                ? 'All have suggestions'
                : `Ask AI (${divisionsToProcessCount}${forceReprocess ? ' all' : ' remaining'})`}
          </Button>

          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={forceReprocess}
                onChange={(e) => setForceReprocess(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Force re-process all</Typography>}
          />

          {highConfidenceCount > 0 && (
            <Badge badgeContent={highConfidenceCount} color="success">
              <Button
                variant="outlined"
                color="success"
                startIcon={<AutoFixHighIcon />}
                onClick={onAutoAssign}
              >
                Auto-Assign High Confidence
              </Button>
            </Badge>
          )}
        </Box>
      </Box>

      {/* Escalation Level Selector */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          AI Mode:
        </Typography>
        <ToggleButtonGroup
          value={escalationLevel}
          exclusive
          onChange={(_, value) => value && setEscalationLevel(value)}
          size="small"
        >
          <ToggleButton value="fast">
            <Tooltip title="Cheap & fast. Only answers if 100% certain, otherwise marks for escalation.">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                ⚡ Fast
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="reasoning">
            <Tooltip title="Uses reasoning to think step-by-step. More accurate but costs more.">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                🧠 Reasoning
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="reasoning_search">
            <Tooltip title="Reasoning + web search. Most accurate, highest cost. Searches for your source.">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                🔍 + Search
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Manual web search override (only if not already in search mode) */}
        {escalationLevel !== 'reasoning_search' && (
          <Tooltip title="Enable web search even in Fast/Reasoning mode. Costs extra.">
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={useWebSearch}
                  onChange={(e) => setUseWebSearch(e.target.checked)}
                  disabled={!worldViewSource}
                />
              }
              label={
                <Typography variant="body2">🌐 +Search</Typography>
              }
            />
          </Tooltip>
        )}

        {effectiveWebSearch && (
          <Chip
            label="Web search active"
            size="small"
            color="info"
            icon={<span>🌐</span>}
          />
        )}
      </Box>

      {/* Model selector row */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="ai-model-select-label">AI Model</InputLabel>
            <Select
              labelId="ai-model-select-label"
              value={currentModel}
              label="AI Model"
              onChange={(e) => onModelChange(e.target.value)}
              disabled={changingModel || batchProcessing}
            >
              {availableModels.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  <Box>
                    <Typography variant="body2">{model.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {model.description}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Web Search Model selector - only show when web search is enabled */}
          {useWebSearch && webSearchModels.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="web-search-model-select-label">🌐 Search Model</InputLabel>
              <Select
                labelId="web-search-model-select-label"
                value={webSearchModelId}
                label="🌐 Search Model"
                onChange={(e) => onWebSearchModelChange(e.target.value)}
                disabled={changingModel || batchProcessing}
              >
                {webSearchModels.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    <Box>
                      <Typography variant="body2">{model.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {model.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Tooltip title="Refresh available models from OpenAI">
            <IconButton
              size="small"
              onClick={onRefreshModels}
              disabled={changingModel || batchProcessing}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>

          {/* Usage/cost tracking button */}
          <Tooltip title="View token usage and costs">
            <IconButton
              size="small"
              onClick={(e) => setUsagePopoverAnchor(e.currentTarget)}
              color={totalStats.tokens > 0 ? 'primary' : 'default'}
            >
              <Badge
                badgeContent={totalStats.requests > 0 ? totalStats.requests : undefined}
                color="info"
                max={99}
              >
                <PaidIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* Usage popover */}
          <AIUsagePopover
            anchorEl={usagePopoverAnchor}
            onClose={() => setUsagePopoverAnchor(null)}
            lastOperation={lastOperation}
            singleRequestStats={singleRequestStats}
            batchRequestStats={batchRequestStats}
            totalStats={totalStats}
            onResetStats={onResetStats}
          />
      </Box>
    </>
  );
}
