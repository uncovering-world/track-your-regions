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
 * - useGroupDescriptions.ts — group description management (localStorage, AI generation)
 * - useAISuggestions.ts — AI suggestion operations (single, batch, auto-assign)
 * - AIUsagePopover.tsx — usage statistics popover display
 * - AIAssistControls.tsx — header controls (batch, escalation, model selector)
 * - AIDivisionList.tsx — division list with suggestion rows
 */

import { useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  AlertTitle,
  LinearProgress,
  Collapse,
  Divider,
  TextField,
  IconButton,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { Region, RegionMember } from '@/types';
import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';
import type { UsageStats, LastOperation, RegionSuggestion } from './aiAssistTypes';
import { useAIModelManager } from './useAIModelManager';
import { useAIUsageTracking } from './useAIUsageTracking';
import { useGroupDescriptions } from './useGroupDescriptions';
import { useAISuggestions } from './useAISuggestions';
import { AIAssistControls } from './AIAssistControls';
import { AIDivisionList } from './AIDivisionList';

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

  const groupNames = useMemo(() => subdivisionGroups.map(g => g.name), [subdivisionGroups]);

  const {
    groupDescriptions,
    generatingDescriptions,
    showDescriptions,
    toggleShowDescriptions,
    handleGenerateDescriptions,
    handleDescriptionChange,
  } = useGroupDescriptions({
    regionId: selectedRegion?.id,
    regionName: selectedRegion?.name || 'Unknown',
    groupNames,
    worldViewDescription,
    worldViewSource,
    aiAvailable,
    setSingleRequestStats,
    setQuotaError: (err) => setQuotaErrorFromDescriptions(err),
  });

  const {
    batchProcessing,
    autoAssignCount,
    quotaError,
    setQuotaError,
    forceReprocess,
    setForceReprocess,
    escalationLevel,
    setEscalationLevel,
    useWebSearch,
    setUseWebSearch,
    effectiveWebSearch,
    askAI,
    batchProcess,
    autoAssignHighConfidence,
    assignToGroup,
    highConfidenceCount,
    divisionsToProcessCount,
  } = useAISuggestions({
    selectedRegionName: selectedRegion?.name || 'Unknown',
    worldViewDescription,
    worldViewSource,
    groupNames,
    groupDescriptions,
    unassignedDivisions,
    setUnassignedDivisions,
    subdivisionGroups,
    setSubdivisionGroups,
    suggestions,
    setSuggestions,
    aiAvailable,
    currentModel,
    setSingleRequestStats,
    setBatchRequestStats,
    setLastOperation,
  });

  // Bridge: useGroupDescriptions needs to set quota error from useAISuggestions
  const setQuotaErrorFromDescriptions = useCallback((err: string | null) => {
    setQuotaError(err);
  }, [setQuotaError]);

  // Get all divisions (unassigned + assigned to groups)
  const allDivisions = useMemo(() => [
    ...unassignedDivisions,
    ...subdivisionGroups.flatMap(g => g.members),
  ].sort((a, b) => a.name.localeCompare(b.name)), [unassignedDivisions, subdivisionGroups]);

  // Find which group a division is currently assigned to
  const getDivisionGroup = useCallback((divisionId: number): string | null => {
    for (const group of subdivisionGroups) {
      if (group.members.some(m => (m.memberRowId || m.id) === divisionId)) {
        return group.name;
      }
    }
    return null;
  }, [subdivisionGroups]);

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

      <AIAssistControls
        batchProcessing={batchProcessing}
        divisionsToProcessCount={divisionsToProcessCount}
        forceReprocess={forceReprocess}
        setForceReprocess={setForceReprocess}
        onBatchProcess={batchProcess}
        highConfidenceCount={highConfidenceCount}
        onAutoAssign={autoAssignHighConfidence}
        escalationLevel={escalationLevel}
        setEscalationLevel={setEscalationLevel}
        useWebSearch={useWebSearch}
        setUseWebSearch={setUseWebSearch}
        effectiveWebSearch={effectiveWebSearch}
        worldViewSource={worldViewSource}
        currentModel={currentModel}
        availableModels={availableModels}
        webSearchModelId={webSearchModelId}
        webSearchModels={webSearchModels}
        changingModel={changingModel}
        onModelChange={handleModelChange}
        onWebSearchModelChange={handleWebSearchModelChange}
        onRefreshModels={refreshModels}
        totalStats={totalStats}
        singleRequestStats={singleRequestStats}
        batchRequestStats={batchRequestStats}
        lastOperation={lastOperation}
        onResetStats={resetStats}
        quotaError={quotaError}
      />

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
        <Button
          size="small"
          variant="outlined"
          startIcon={generatingDescriptions ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
          onClick={() => handleGenerateDescriptions(effectiveWebSearch)}
          disabled={generatingDescriptions || !!quotaError}
          sx={{ ml: 'auto' }}
        >
          {Object.keys(groupDescriptions).length > 0 ? 'Regenerate' : 'Prepare'} Descriptions
        </Button>

        {Object.keys(groupDescriptions).length > 0 && (
          <IconButton
            size="small"
            onClick={toggleShowDescriptions}
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
      <AIDivisionList
        allDivisions={allDivisions}
        subdivisionGroups={subdivisionGroups}
        groupNames={groupNames}
        suggestions={suggestions}
        getDivisionGroup={getDivisionGroup}
        quotaError={quotaError}
        worldViewSource={worldViewSource}
        onAskAI={askAI}
        onAssignToGroup={assignToGroup}
      />

      {/* Footer info */}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        💡 Tip: Create groups with descriptive names (e.g., "Ralik Chain", "Ratak Chain" for Marshall Islands).
        The AI uses geographic and cultural knowledge to suggest assignments.
      </Typography>
    </Box>
  );
}
