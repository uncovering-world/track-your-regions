/**
 * AI Assistant Tab for Custom Subdivision Dialog
 *
 * This tab provides AI-powered suggestions for grouping regions.
 * Features:
 * - Check AI availability status
 * - Ask AI for individual region suggestions
 * - Batch process all regions
 * - Auto-assign high-confidence suggestions
 * - Visual indicators for split suggestions
 *
 * Extracted modules:
 * - aiAssistTypes.ts — UsageStats, LastOperation, RegionSuggestion interfaces
 * - useAIModelManager.ts — model selection, provider config, status checking
 * - useAIUsageTracking.ts — usage stat helpers (totalStats, getPercentage, resetStats)
 * - AIUsagePopover.tsx — usage statistics popover display
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Alert,
  AlertTitle,
  LinearProgress,
  Collapse,
  Divider,
  Badge,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import PaidIcon from '@mui/icons-material/Paid';
import type { Region, RegionMember } from '@/types';
import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';
import {
  suggestGroupForRegion,
  suggestGroupsForMultipleRegions,
  generateGroupDescriptions,
} from '@/api';
import type { UsageStats, LastOperation, RegionSuggestion } from './aiAssistTypes';
import { useAIModelManager } from './useAIModelManager';
import { useAIUsageTracking } from './useAIUsageTracking';
import { AIUsagePopover } from './AIUsagePopover';

// Re-export types for consumer compatibility
export type { UsageStats, LastOperation, RegionSuggestion } from './aiAssistTypes';

interface AIAssistTabProps {
  selectedRegion: Region | null;
  worldViewDescription?: string;
  worldViewSource?: string;
  unassignedDivisions: RegionMember[];
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  suggestions: Map<number, RegionSuggestion>;
  setSuggestions: React.Dispatch<React.SetStateAction<Map<number, RegionSuggestion>>>;
  // Usage stats (lifted for persistence)
  singleRequestStats: UsageStats;
  setSingleRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  batchRequestStats: UsageStats;
  setBatchRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  lastOperation: LastOperation | null;
  setLastOperation: React.Dispatch<React.SetStateAction<LastOperation | null>>;
}

export function AIAssistTab({
  selectedRegion,
  worldViewDescription,
  worldViewSource,
  unassignedDivisions,
  setUnassignedDivisions,
  subdivisionGroups,
  setSubdivisionGroups,
  suggestions,
  setSuggestions,
  singleRequestStats,
  setSingleRequestStats,
  batchRequestStats,
  setBatchRequestStats,
  lastOperation,
  setLastOperation,
}: AIAssistTabProps) {
  // Extracted hooks
  const {
    aiAvailable,
    aiMessage,
    checkingStatus,
    currentModel,
    availableModels,
    webSearchModelId,
    webSearchModels,
    changingModel,
    handleModelChange,
    handleWebSearchModelChange,
    refreshModels,
  } = useAIModelManager();

  const { totalStats, resetStats } = useAIUsageTracking({
    singleRequestStats,
    setSingleRequestStats,
    batchRequestStats,
    setBatchRequestStats,
    setLastOperation,
  });

  const [batchProcessing, setBatchProcessing] = useState(false);
  const [expandedDivisions, setExpandedDivisions] = useState<Set<number>>(new Set());
  const [autoAssignCount, setAutoAssignCount] = useState(0);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const [usagePopoverAnchor, setUsagePopoverAnchor] = useState<HTMLElement | null>(null);

  // Force reprocess option
  const [forceReprocess, setForceReprocess] = useState(false);

  // Escalation level for AI requests
  type EscalationLevel = 'fast' | 'reasoning' | 'reasoning_search';
  const [escalationLevel, setEscalationLevel] = useState<EscalationLevel>('fast');

  // Web search option (now derived from escalation level or manual override)
  const [useWebSearch, setUseWebSearch] = useState(false);
  const effectiveWebSearch = escalationLevel === 'reasoning_search' || useWebSearch;

  // Group descriptions for AI context
  const [groupDescriptions, setGroupDescriptions] = useState<Record<string, string>>({});
  const [generatingDescriptions, setGeneratingDescriptions] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(false);

  // LocalStorage key for group descriptions
  const descriptionsStorageKey = selectedRegion ? `ai-group-descriptions-${selectedRegion.id}` : null;

  // Load descriptions from localStorage on mount
  useEffect(() => {
    if (descriptionsStorageKey) {
      try {
        const saved = localStorage.getItem(descriptionsStorageKey);
        if (saved) {
          setGroupDescriptions(JSON.parse(saved));
        }
      } catch (e) {
        console.error('Failed to load group descriptions:', e);
      }
    }
  }, [descriptionsStorageKey]);

  // Save descriptions to localStorage when they change
  useEffect(() => {
    if (descriptionsStorageKey && Object.keys(groupDescriptions).length > 0) {
      try {
        localStorage.setItem(descriptionsStorageKey, JSON.stringify(groupDescriptions));
      } catch (e) {
        console.error('Failed to save group descriptions:', e);
      }
    }
  }, [groupDescriptions, descriptionsStorageKey]);

  // Generate descriptions using AI
  const handleGenerateDescriptions = async () => {
    if (!aiAvailable || subdivisionGroups.length === 0) return;

    setGeneratingDescriptions(true);
    try {
      const groupNames = subdivisionGroups.map(g => g.name);
      const result = await generateGroupDescriptions(
        groupNames,
        selectedRegion?.name || 'Unknown',
        worldViewDescription,
        worldViewSource,
        useWebSearch
      );

      setGroupDescriptions(result.descriptions);
      setShowDescriptions(true);

      // Track usage if available
      if (result.usage) {
        setSingleRequestStats(prev => ({
          tokens: prev.tokens + result.usage!.totalTokens,
          inputCost: prev.inputCost + (result.usage!.cost?.inputCost ?? 0),
          outputCost: prev.outputCost + (result.usage!.cost?.outputCost ?? 0),
          webSearchCost: (prev.webSearchCost || 0) + (result.usage!.cost?.webSearchCost ?? 0),
          totalCost: prev.totalCost + (result.usage!.cost?.totalCost ?? 0),
          requests: prev.requests + 1,
          regionsProcessed: prev.regionsProcessed,
        }));
      }
    } catch (error) {
      console.error('Failed to generate descriptions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota')) {
        setQuotaError(errorMessage);
      }
    } finally {
      setGeneratingDescriptions(false);
    }
  };

  // Update a single group description
  const handleDescriptionChange = (groupName: string, description: string) => {
    setGroupDescriptions(prev => ({
      ...prev,
      [groupName]: description,
    }));
  };

  // Get all divisions (unassigned + assigned to groups)
  const allDivisions = [
    ...unassignedDivisions,
    ...subdivisionGroups.flatMap(g => g.members),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const groupNames = subdivisionGroups.map(g => g.name);

  // Find which group a division is currently assigned to
  const getDivisionGroup = useCallback((divisionId: number): string | null => {
    for (const group of subdivisionGroups) {
      if (group.members.some(m => (m.memberRowId || m.id) === divisionId)) {
        return group.name;
      }
    }
    return null;
  }, [subdivisionGroups]);

  // Ask AI for a single region
  const askAI = async (division: RegionMember, overrideEscalation?: EscalationLevel) => {
    if (!aiAvailable || groupNames.length === 0 || quotaError) return;

    const useLevel = overrideEscalation || escalationLevel;
    const divisionKey = division.memberRowId || division.id;
    setSuggestions(prev => new Map(prev).set(divisionKey, {
      division,
      suggestion: null,
      loading: true,
      error: null,
    }));

    try {
      const regionPath = division.path || `${selectedRegion?.name || ''} > ${division.name}`;
      const suggestion = await suggestGroupForRegion(
        regionPath,
        division.name,
        groupNames,
        selectedRegion?.name || 'Unknown',
        Object.keys(groupDescriptions).length > 0 ? groupDescriptions : undefined,
        useLevel === 'reasoning_search' || useWebSearch,
        worldViewSource,
        useLevel
      );

      setSuggestions(prev => new Map(prev).set(divisionKey, {
        division,
        suggestion,
        loading: false,
        error: null,
      }));

      // Track single request usage
      if (suggestion.usage) {
        const tokens = suggestion.usage.totalTokens;
        const inputCost = suggestion.usage.cost?.inputCost ?? 0;
        const outputCost = suggestion.usage.cost?.outputCost ?? 0;
        const webSearchCost = suggestion.usage.cost?.webSearchCost ?? 0;
        const totalCost = suggestion.usage.cost?.totalCost ?? 0;

        setSingleRequestStats(prev => ({
          tokens: prev.tokens + tokens,
          inputCost: prev.inputCost + inputCost,
          outputCost: prev.outputCost + outputCost,
          webSearchCost: (prev.webSearchCost || 0) + webSearchCost,
          totalCost: prev.totalCost + totalCost,
          requests: prev.requests + 1,
          regionsProcessed: (prev.regionsProcessed || 0) + 1,
        }));

        setLastOperation({
          type: 'single',
          tokens,
          inputCost,
          outputCost,
          webSearchCost,
          totalCost,
          regionsCount: 1,
          model: suggestion.usage.model || currentModel,
          timestamp: new Date(),
        });
      }
    } catch (error: unknown) {
      // Check if it's a quota exceeded error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota') || errorMessage.includes('429')) {
        setQuotaError(errorMessage);
      }

      setSuggestions(prev => new Map(prev).set(divisionKey, {
        division,
        suggestion: null,
        loading: false,
        error: errorMessage,
      }));
    }
  };

  // Batch process all unassigned divisions
  const batchProcess = async () => {
    if (!aiAvailable || groupNames.length === 0 || unassignedDivisions.length === 0 || quotaError) return;

    // Filter out divisions that already have suggestions (unless force is enabled)
    const divisionsToProcess = forceReprocess
      ? unassignedDivisions
      : unassignedDivisions.filter(div => {
          const divisionKey = div.memberRowId || div.id;
          const existing = suggestions.get(divisionKey);
          // Skip if already has a suggestion (not loading, no error)
          return !existing?.suggestion;
        });

    if (divisionsToProcess.length === 0) {
      console.log('All divisions already have AI suggestions');
      return;
    }

    setBatchProcessing(true);

    try {
      // Just send names - paths are not needed since we provide parentRegion
      const regions = divisionsToProcess.map(div => ({
        path: '', // Not needed anymore
        name: div.name,
      }));

      const result = await suggestGroupsForMultipleRegions(
        regions,
        groupNames,
        selectedRegion?.name || 'Unknown',
        worldViewDescription,
        worldViewSource,
        effectiveWebSearch,
        Object.keys(groupDescriptions).length > 0 ? groupDescriptions : undefined
      );

      // Track batch usage
      if (result.usage) {
        const tokens = result.usage.totalTokens;
        const inputCost = result.usage.cost?.inputCost ?? 0;
        const outputCost = result.usage.cost?.outputCost ?? 0;
        const webSearchCost = result.usage.cost?.webSearchCost ?? 0;
        const totalCost = result.usage.cost?.totalCost ?? 0;
        const actualRequests = result.apiRequestsCount || 1;

        setBatchRequestStats(prev => ({
          tokens: prev.tokens + tokens,
          inputCost: prev.inputCost + inputCost,
          outputCost: prev.outputCost + outputCost,
          webSearchCost: (prev.webSearchCost || 0) + webSearchCost,
          totalCost: prev.totalCost + totalCost,
          requests: prev.requests + actualRequests,
          regionsProcessed: (prev.regionsProcessed || 0) + regions.length,
        }));

        setLastOperation({
          type: 'batch',
          tokens,
          inputCost,
          outputCost,
          webSearchCost,
          totalCost,
          regionsCount: regions.length,
          model: result.usage.model || currentModel,
          timestamp: new Date(),
        });
      }

      // Update suggestions map
      const newSuggestions = new Map(suggestions);
      for (const div of divisionsToProcess) {
        const suggestion = result.suggestions[div.name];
        if (suggestion) {
          const divisionKey = div.memberRowId || div.id;
          newSuggestions.set(divisionKey, {
            division: div,
            suggestion,
            loading: false,
            error: null,
          });
        }
      }
      setSuggestions(newSuggestions);
    } catch (error: unknown) {
      console.error('Batch processing failed:', error);
      // Check if it's a quota exceeded error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota') || errorMessage.includes('429')) {
        setQuotaError(errorMessage);
      }
    } finally {
      setBatchProcessing(false);
    }
  };

  // Auto-assign all high-confidence suggestions
  const autoAssignHighConfidence = () => {
    let assignedCount = 0;

    const newUnassigned = [...unassignedDivisions];
    const newGroups = subdivisionGroups.map(g => ({ ...g, members: [...g.members] }));

    for (const [divisionKey, data] of suggestions) {
      if (
        data.suggestion?.confidence === 'high' &&
        data.suggestion.suggestedGroup &&
        !data.suggestion.shouldSplit
      ) {
        // Find the division
        const divIndex = newUnassigned.findIndex(
          d => (d.memberRowId || d.id) === divisionKey
        );
        if (divIndex === -1) continue;

        const division = newUnassigned[divIndex];

        // Find the target group
        const groupIndex = newGroups.findIndex(
          g => g.name === data.suggestion!.suggestedGroup
        );
        if (groupIndex === -1) continue;

        // Move division to group
        newUnassigned.splice(divIndex, 1);
        newGroups[groupIndex].members.push(division);
        assignedCount++;
      }
    }

    if (assignedCount > 0) {
      setUnassignedDivisions(newUnassigned);
      setSubdivisionGroups(newGroups);
      setAutoAssignCount(assignedCount);
      setTimeout(() => setAutoAssignCount(0), 3000);
    }
  };

  // Assign a single division to a group
  const assignToGroup = (division: RegionMember, groupName: string) => {
    const divisionKey = division.memberRowId || division.id;

    // Remove from unassigned
    const newUnassigned = unassignedDivisions.filter(
      d => (d.memberRowId || d.id) !== divisionKey
    );

    // Remove from any existing group
    const newGroups = subdivisionGroups.map(g => ({
      ...g,
      members: g.members.filter(m => (m.memberRowId || m.id) !== divisionKey),
    }));

    // Add to target group
    const targetGroupIndex = newGroups.findIndex(g => g.name === groupName);
    if (targetGroupIndex !== -1) {
      newGroups[targetGroupIndex].members.push(division);
    }

    setUnassignedDivisions(newUnassigned);
    setSubdivisionGroups(newGroups);
  };

  // Toggle expanded state for a division
  const toggleExpanded = (divisionId: number) => {
    setExpandedDivisions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(divisionId)) {
        newSet.delete(divisionId);
      } else {
        newSet.add(divisionId);
      }
      return newSet;
    });
  };

  // Get confidence color
  const getConfidenceColor = (confidence: string): 'success' | 'warning' | 'error' | 'default' => {
    switch (confidence) {
      case 'high': return 'success';
      case 'medium': return 'warning';
      case 'low': return 'error';
      default: return 'default';
    }
  };

  // Get group color by name (for suggestion badges)
  const getGroupColorByName = (groupName: string) => {
    const index = groupNames.indexOf(groupName);
    return index >= 0 ? getGroupColor(subdivisionGroups[index], index) : '#666';
  };

  // Count high-confidence suggestions for auto-assign button
  const highConfidenceCount = Array.from(suggestions.values()).filter(
    s => s.suggestion?.confidence === 'high' &&
         s.suggestion.suggestedGroup &&
         !s.suggestion.shouldSplit &&
         unassignedDivisions.some(d => (d.memberRowId || d.id) === (s.division.memberRowId || s.division.id))
  ).length;

  // Count divisions to process (respects forceReprocess flag)
  const divisionsToProcessCount = forceReprocess
    ? unassignedDivisions.length
    : unassignedDivisions.filter(div => {
        const divisionKey = div.memberRowId || div.id;
        return !suggestions.get(divisionKey)?.suggestion;
      }).length;

  // Render loading state
  if (checkingStatus) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} sx={{ mr: 2 }} />
        <Typography>Checking AI availability...</Typography>
      </Box>
    );
  }

  // Render unavailable state
  if (!aiAvailable) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        <AlertTitle>AI Features Unavailable</AlertTitle>
        {aiMessage}
        <Typography variant="body2" sx={{ mt: 1 }}>
          To enable AI-assisted grouping, add your OpenAI API key to the <code>.env</code> file:
          <br />
          <code>OPENAI_API_KEY=sk-your-api-key-here</code>
        </Typography>
      </Alert>
    );
  }

  // Render no groups warning
  if (groupNames.length === 0) {
    return (
      <Alert severity="info" sx={{ m: 2 }}>
        <AlertTitle>Create Groups First</AlertTitle>
        Before using AI assistance, please create at least one group using the "List View" tab.
        <br />
        The AI will suggest which group each region belongs to based on geographic and cultural factors.
      </Alert>
    );
  }

  return (
    <Box>
      {/* Quota exceeded error */}
      {quotaError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          icon={<span style={{ fontSize: '1.5rem' }}>🐹</span>}
        >
          <AlertTitle>AI Credits Exhausted</AlertTitle>
          {quotaError}
        </Alert>
      )}

      {/* Header with actions and model selector */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={batchProcessing ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={batchProcess}
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
                onClick={autoAssignHighConfidence}
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
              onChange={(e) => handleModelChange(e.target.value)}
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
                onChange={(e) => handleWebSearchModelChange(e.target.value)}
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
              onClick={refreshModels}
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
            onResetStats={resetStats}
          />
      </Box>

      {/* Auto-assign success message */}
      <Collapse in={autoAssignCount > 0}>
        <Alert severity="success" sx={{ mb: 2 }}>
          Auto-assigned {autoAssignCount} region(s) with high confidence!
        </Alert>
      </Collapse>

      {/* Batch progress */}
      {batchProcessing && (
        <LinearProgress variant="indeterminate" sx={{ mb: 2 }} />
      )}

      {/* Groups summary */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {subdivisionGroups.map((group, idx) => (
          <Chip
            key={group.name}
            label={`${group.name} (${group.members.length})`}
            size="small"
            sx={{
              bgcolor: getGroupColor(group, idx) + '30',
              borderColor: getGroupColor(group, idx),
              border: '1px solid',
            }}
          />
        ))}

        {/* Generate descriptions button */}
        <Tooltip title="Generate AI descriptions for each group to improve classification accuracy">
          <Button
            size="small"
            variant="outlined"
            startIcon={generatingDescriptions ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
            onClick={handleGenerateDescriptions}
            disabled={generatingDescriptions || !!quotaError}
            sx={{ ml: 'auto' }}
          >
            {Object.keys(groupDescriptions).length > 0 ? 'Regenerate' : 'Prepare'} Descriptions
          </Button>
        </Tooltip>

        {Object.keys(groupDescriptions).length > 0 && (
          <IconButton
            size="small"
            onClick={() => setShowDescriptions(!showDescriptions)}
          >
            {showDescriptions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        )}
      </Box>

      {/* Group descriptions (collapsible) */}
      <Collapse in={showDescriptions && Object.keys(groupDescriptions).length > 0}>
        <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
          <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            📝 Group Descriptions
            <Typography variant="caption" color="text.secondary">
              (used by AI for better classification - edit as needed, auto-saved)
            </Typography>
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {subdivisionGroups.map((group, idx) => (
              <Box key={group.name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Chip
                  label={group.name}
                  size="small"
                  sx={{
                    mt: 0.5,
                    minWidth: 100,
                    bgcolor: getGroupColor(group, idx) + '30',
                    borderColor: getGroupColor(group, idx),
                    border: '1px solid',
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  maxRows={3}
                  placeholder="Description to help AI classify regions..."
                  value={groupDescriptions[group.name] || ''}
                  onChange={(e) => handleDescriptionChange(group.name, e.target.value)}
                  sx={{ flex: 1 }}
                />
              </Box>
            ))}
          </Box>
        </Paper>
      </Collapse>

      <Divider sx={{ my: 2 }} />

      {/* Divisions list with AI suggestions */}
      <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
        <List dense>
          {allDivisions.map((division) => {
            const divisionKey = division.memberRowId || division.id;
            const suggestionData = suggestions.get(divisionKey);
            const currentGroup = getDivisionGroup(divisionKey);
            const isExpanded = expandedDivisions.has(divisionKey);
            const isUnassigned = !currentGroup;

            return (
              <Box key={divisionKey}>
                <ListItem
                  sx={{
                    bgcolor: isUnassigned ? 'background.paper' : 'action.selected',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {suggestionData?.loading ? (
                      <CircularProgress size={20} />
                    ) : suggestionData?.suggestion?.needsEscalation ? (
                      <Tooltip title="AI uncertain - click to escalate with more reasoning or web search">
                        <Box sx={{ color: 'warning.main', fontSize: '1.2rem' }}>⚠️</Box>
                      </Tooltip>
                    ) : suggestionData?.suggestion?.shouldSplit ? (
                      <Tooltip title="AI suggests splitting this region">
                        <CallSplitIcon color="warning" />
                      </Tooltip>
                    ) : suggestionData?.suggestion?.confidence === 'high' ? (
                      <Tooltip title="High confidence suggestion">
                        <CheckCircleIcon color="success" />
                      </Tooltip>
                    ) : suggestionData?.suggestion ? (
                      <Tooltip title={`${suggestionData.suggestion.confidence} confidence`}>
                        <HelpOutlineIcon color={suggestionData.suggestion.confidence === 'medium' ? 'warning' : 'disabled'} />
                      </Tooltip>
                    ) : null}
                  </ListItemIcon>

                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {division.name}
                        </Typography>
                        {currentGroup && (
                          <Chip
                            label={currentGroup}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.7rem',
                              bgcolor: getGroupColorByName(currentGroup) + '30',
                              borderColor: getGroupColorByName(currentGroup),
                              border: '1px solid',
                            }}
                          />
                        )}
                      </Box>
                    }
                    slotProps={{ primary: { component: 'div' }, secondary: { component: 'div' } }}
                    secondary={
                      suggestionData?.suggestion && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                          <Chip
                            label={suggestionData.suggestion.confidence}
                            size="small"
                            color={getConfidenceColor(suggestionData.suggestion.confidence)}
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                          {suggestionData.suggestion.suggestedGroup && !suggestionData.suggestion.shouldSplit && (
                            <Typography variant="caption" color="text.secondary">
                              → {suggestionData.suggestion.suggestedGroup}
                            </Typography>
                          )}
                          {suggestionData.suggestion.shouldSplit && (
                            <Chip
                              label={suggestionData.suggestion.splitGroups
                                ? `⚠️ Split: ${suggestionData.suggestion.splitGroups.join(' / ')}`
                                : `⚠️ Needs split (${suggestionData.suggestion.suggestedGroup || 'multiple groups'})`}
                              size="small"
                              color="warning"
                              sx={{ height: 18, fontSize: '0.65rem' }}
                            />
                          )}
                        </Box>
                      )
                    }
                  />

                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {/* Ask AI button */}
                    {isUnassigned && !suggestionData?.suggestion && (
                      <Tooltip title={quotaError ? "AI credits exhausted" : "Ask AI for suggestion"}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => askAI(division)}
                            disabled={suggestionData?.loading || !!quotaError}
                          >
                            <SmartToyIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}

                    {/* Escalation buttons for uncertain suggestions */}
                    {suggestionData?.suggestion?.needsEscalation && isUnassigned && (
                      <>
                        {suggestionData.suggestion.escalationLevel !== 'reasoning' && (
                          <Tooltip title="Re-ask with reasoning (🧠 think deeper)">
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => askAI(division, 'reasoning')}
                              disabled={suggestionData?.loading || !!quotaError}
                            >
                              <span style={{ fontSize: '1rem' }}>🧠</span>
                            </IconButton>
                          </Tooltip>
                        )}
                        {suggestionData.suggestion.escalationLevel !== 'reasoning_search' && (
                          <Tooltip title="Re-ask with web search (🔍 search for sources)">
                            <IconButton
                              size="small"
                              color="info"
                              onClick={() => askAI(division, 'reasoning_search')}
                              disabled={suggestionData?.loading || !!quotaError || !worldViewSource}
                            >
                              <span style={{ fontSize: '1rem' }}>🔍</span>
                            </IconButton>
                          </Tooltip>
                        )}
                      </>
                    )}

                    {/* Quick assign buttons if suggestion exists */}
                    {suggestionData?.suggestion?.suggestedGroup &&
                     suggestionData.suggestion.confidence !== 'low' &&
                     !suggestionData.suggestion.shouldSplit &&
                     isUnassigned && (
                      <Tooltip title={`Assign to ${suggestionData.suggestion.suggestedGroup}`}>
                        <IconButton
                          size="small"
                          color="success"
                          onClick={() => assignToGroup(division, suggestionData.suggestion!.suggestedGroup!)}
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* Show details toggle */}
                    {suggestionData?.suggestion && (
                      <IconButton size="small" onClick={() => toggleExpanded(divisionKey)}>
                        {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                    )}
                  </Box>
                </ListItem>

                {/* Expanded details */}
                <Collapse in={isExpanded && !!suggestionData?.suggestion}>
                  <Box sx={{ px: 3, py: 1.5, bgcolor: 'grey.50' }}>
                    {/* Escalation level and status */}
                    <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                      <Chip
                        label={
                          suggestionData?.suggestion?.escalationLevel === 'reasoning_search' ? '🔍 Search' :
                          suggestionData?.suggestion?.escalationLevel === 'reasoning' ? '🧠 Reasoning' : '⚡ Fast'
                        }
                        size="small"
                        variant="outlined"
                        color={
                          suggestionData?.suggestion?.escalationLevel === 'reasoning_search' ? 'info' :
                          suggestionData?.suggestion?.escalationLevel === 'reasoning' ? 'warning' : 'default'
                        }
                      />
                      {suggestionData?.suggestion?.needsEscalation && (
                        <Chip
                          label="⚠️ Needs escalation"
                          size="small"
                          color="warning"
                        />
                      )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <InfoOutlinedIcon fontSize="small" color="action" />
                      <Typography variant="body2" color="text.secondary">
                        <strong>Reasoning:</strong> {suggestionData?.suggestion?.reasoning}
                      </Typography>
                    </Box>
                    {suggestionData?.suggestion?.context && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3 }}>
                        <strong>Context:</strong> {suggestionData.suggestion.context}
                      </Typography>
                    )}

                    {/* Sources from web search */}
                    {suggestionData?.suggestion?.sources && suggestionData.suggestion.sources.length > 0 && (
                      <Box sx={{ ml: 3, mt: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <strong>🌐 Sources:</strong>
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.5 }}>
                          {suggestionData.suggestion.sources.map((source, idx) => (
                            <Typography
                              key={idx}
                              variant="caption"
                              component="a"
                              href={source}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{
                                color: 'primary.main',
                                textDecoration: 'none',
                                '&:hover': { textDecoration: 'underline' },
                                wordBreak: 'break-all',
                              }}
                            >
                              {source.length > 60 ? source.substring(0, 60) + '...' : source}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Manual assign buttons for all groups */}
                    {isUnassigned && (
                      <Box sx={{ mt: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mr: 1, alignSelf: 'center' }}>
                          Assign to:
                        </Typography>
                        {groupNames.map((groupName, idx) => {
                          const gc = getGroupColor(subdivisionGroups[idx], idx);
                          return (
                            <Button
                              key={groupName}
                              size="small"
                              variant={
                                suggestionData?.suggestion?.suggestedGroup === groupName
                                  ? 'contained'
                                  : 'outlined'
                              }
                              sx={{
                                fontSize: '0.7rem',
                                py: 0.25,
                                borderColor: gc,
                                color: suggestionData?.suggestion?.suggestedGroup === groupName
                                  ? 'white'
                                  : gc,
                                bgcolor: suggestionData?.suggestion?.suggestedGroup === groupName
                                  ? gc
                                  : 'transparent',
                                '&:hover': {
                                  bgcolor: gc + '30',
                                },
                              }}
                              onClick={() => assignToGroup(division, groupName)}
                            >
                              {groupName}
                            </Button>
                          );
                        })}
                      </Box>
                    )}

                    {/* Split suggestion action */}
                    {suggestionData?.suggestion?.shouldSplit && suggestionData.suggestion.splitGroups && (
                      <Alert severity="warning" sx={{ mt: 1 }} icon={<CallSplitIcon />}>
                        <Typography variant="body2">
                          This region may need to be split between: <strong>{suggestionData.suggestion.splitGroups.join(' and ')}</strong>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Use the Map View tab to split this region's geometry if needed.
                        </Typography>
                      </Alert>
                    )}
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </List>
      </Paper>

      {/* Footer info */}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        💡 Tip: Create groups with descriptive names (e.g., "Ralik Chain", "Ratak Chain" for Marshall Islands).
        The AI uses geographic and cultural knowledge to suggest assignments.
      </Typography>
    </Box>
  );
}
