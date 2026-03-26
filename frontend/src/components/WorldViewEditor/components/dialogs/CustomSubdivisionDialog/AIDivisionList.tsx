/**
 * Division list with AI suggestion display, escalation buttons, and manual assignment controls.
 */

import { useState, useCallback } from 'react';
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
  Collapse,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { RegionMember } from '@/types';
import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';
import type { RegionSuggestion } from './aiAssistTypes';
import type { EscalationLevel } from './useAISuggestions';

interface AIDivisionListProps {
  allDivisions: RegionMember[];
  subdivisionGroups: SubdivisionGroup[];
  groupNames: string[];
  suggestions: Map<number, RegionSuggestion>;
  getDivisionGroup: (divisionId: number) => string | null;
  quotaError: string | null;
  worldViewSource?: string;
  onAskAI: (division: RegionMember, overrideEscalation?: EscalationLevel) => void;
  onAssignToGroup: (division: RegionMember, groupName: string) => void;
}

/** Map confidence string to MUI color. */
function getConfidenceColor(confidence: string): 'success' | 'warning' | 'error' | 'default' {
  switch (confidence) {
    case 'high': return 'success';
    case 'medium': return 'warning';
    case 'low': return 'error';
    default: return 'default';
  }
}

export function AIDivisionList({
  allDivisions,
  subdivisionGroups,
  groupNames,
  suggestions,
  getDivisionGroup,
  quotaError,
  worldViewSource,
  onAskAI,
  onAssignToGroup,
}: AIDivisionListProps) {
  const [expandedDivisions, setExpandedDivisions] = useState<Set<number>>(new Set());

  const toggleExpanded = useCallback((divisionId: number) => {
    setExpandedDivisions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(divisionId)) {
        newSet.delete(divisionId);
      } else {
        newSet.add(divisionId);
      }
      return newSet;
    });
  }, []);

  const getGroupColorByName = useCallback((groupName: string) => {
    const index = groupNames.indexOf(groupName);
    return index >= 0 ? getGroupColor(subdivisionGroups[index], index) : '#666';
  }, [groupNames, subdivisionGroups]);

  return (
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
                          onClick={() => onAskAI(division)}
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
                            onClick={() => onAskAI(division, 'reasoning')}
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
                            onClick={() => onAskAI(division, 'reasoning_search')}
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
                        onClick={() => onAssignToGroup(division, suggestionData.suggestion!.suggestedGroup!)}
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
                            onClick={() => onAssignToGroup(division, groupName)}
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
  );
}
