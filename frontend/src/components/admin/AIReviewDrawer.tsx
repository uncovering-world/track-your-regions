/**
 * AIReviewDrawer — Right-side drawer for AI hierarchy review reports.
 *
 * Extracted from WorldViewImportTree.tsx. Renders markdown reports with linkified
 * region names, action checklists with radio choices, and regeneration controls.
 */

import {
  Box,
  Typography,
  Button,
  IconButton,
  CircularProgress,
  Drawer,
  Checkbox,
  Chip,
  Radio,
  RadioGroup,
  FormControlLabel,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import type { ReviewAction, HierarchyReviewResult } from '../../api/adminAI';
import { linkifyRegionNames } from './importTreeLinkify';

export interface StoredReport {
  scope: string;
  regionId: number | null;
  report: string;
  actions: ReviewAction[];
  stats: HierarchyReviewResult['stats'] | null;
  generatedAt: string;
}

export interface AIReviewDrawerProps {
  activeReviewKey: string | null;
  setActiveReviewKey: React.Dispatch<React.SetStateAction<string | null>>;
  reviewReports: Map<string, StoredReport>;
  setReviewReports: React.Dispatch<React.SetStateAction<Map<string, StoredReport>>>;
  reviewLoading: { key: string; passInfo: string } | null;
  handleReview: (regionId?: number, forceRegenerate?: boolean) => void;
  regionNameRegex: RegExp | null;
  regionNameToId: Map<string, number>;
  navigateToRegion: (regionId: number) => void;
}

export function AIReviewDrawer({
  activeReviewKey,
  setActiveReviewKey,
  reviewReports,
  setReviewReports,
  reviewLoading,
  handleReview,
  regionNameRegex,
  regionNameToId,
  navigateToRegion,
}: AIReviewDrawerProps) {
  const activeReport = activeReviewKey ? reviewReports.get(activeReviewKey) : null;
  const isReviewOpen = activeReviewKey != null;
  const isLoading = reviewLoading?.key === activeReviewKey;
  return (
    <Drawer
      anchor="right"
      open={isReviewOpen}
      onClose={() => setActiveReviewKey(null)}
      variant="persistent"
      sx={{ '& .MuiDrawer-paper': { width: 420, p: 0, boxSizing: 'border-box' } }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>Hierarchy Review</Typography>
          <Typography variant="caption" color="text.secondary">{activeReport?.scope ?? reviewLoading?.passInfo}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Button
            size="small"
            onClick={() => {
              const regionId = activeReviewKey === 'full' ? undefined : Number(activeReviewKey?.replace('region-', ''));
              handleReview(regionId, true);
            }}
            disabled={!!reviewLoading}
          >
            Regenerate
          </Button>
          <IconButton size="small" onClick={() => setActiveReviewKey(null)}>
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: 2 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">{reviewLoading?.passInfo}</Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ '& h2': { mt: 2, mb: 1, fontSize: '1.1rem' }, '& h3': { mt: 1.5, mb: 0.5, fontSize: '0.95rem' }, '& ul': { pl: 2 }, '& p': { my: 0.5 }, fontSize: '0.8rem', lineHeight: 1.5 }}>
              <ReactMarkdown components={regionNameRegex ? {
                // Override text-containing elements to linkify region names
                p: ({ children }) => <p>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</p>,
                li: ({ children }) => <li>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</li>,
                h2: ({ children }) => <h2>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</h2>,
                h3: ({ children }) => <h3>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</h3>,
                strong: ({ children }) => <strong>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</strong>,
              } : undefined}>{activeReport?.report ?? ''}</ReactMarkdown>
            </Box>
            {/* Actions checklist */}
            {activeReport && activeReport.actions.length > 0 && (
              <Box sx={{ mt: 3, borderTop: 1, borderColor: 'divider', pt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Recommended Actions ({activeReport.actions.filter(a => a.completed).length}/{activeReport.actions.length} completed)
                </Typography>
                {activeReport.actions.map((action) => (
                  <Box key={action.id} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1, opacity: action.completed ? 0.5 : 1 }}>
                    <Checkbox
                      size="small"
                      checked={action.completed}
                      onChange={() => {
                        if (!activeReviewKey) return;
                        setReviewReports(prev => {
                          const next = new Map(prev);
                          const report = next.get(activeReviewKey);
                          if (!report) return prev;
                          const updatedActions = report.actions.map(a =>
                            a.id === action.id ? { ...a, completed: !a.completed } : a,
                          );
                          next.set(activeReviewKey, { ...report, actions: updatedActions });
                          return next;
                        });
                      }}
                      sx={{ p: 0.25, mr: 1, mt: 0.25 }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography component="div" variant="body2" sx={{ textDecoration: action.completed ? 'line-through' : 'none', fontSize: '0.8rem' }}>
                        <Chip label={action.type} size="small" sx={{ height: 18, fontSize: '0.65rem', mr: 0.5 }} />
                        {action.regionName && (
                          <Typography component="span" variant="body2" sx={{
                            fontWeight: 600, fontSize: '0.8rem', mr: 0.5,
                            color: regionNameToId.has(action.regionName) ? '#1976d2' : 'text.primary',
                            cursor: regionNameToId.has(action.regionName) ? 'pointer' : 'default',
                            textDecoration: regionNameToId.has(action.regionName) ? 'underline dotted' : 'none',
                            textUnderlineOffset: '2px',
                          }}
                            onClick={() => {
                              const id = regionNameToId.get(action.regionName);
                              if (id != null) navigateToRegion(id);
                            }}
                          >
                            {action.regionName}:
                          </Typography>
                        )}
                        {regionNameRegex
                          ? linkifyRegionNames([action.description], regionNameRegex, regionNameToId, navigateToRegion)
                          : action.description}
                      </Typography>
                      {action.choices && action.choices.length > 0 && !action.completed && (
                        <RadioGroup
                          value={action.selectedChoice ?? ''}
                          onChange={(e) => {
                            if (!activeReviewKey) return;
                            setReviewReports(prev => {
                              const next = new Map(prev);
                              const report = next.get(activeReviewKey);
                              if (!report) return prev;
                              const updatedActions = report.actions.map(a =>
                                a.id === action.id ? { ...a, selectedChoice: e.target.value } : a,
                              );
                              next.set(activeReviewKey, { ...report, actions: updatedActions });
                              return next;
                            });
                          }}
                          sx={{ ml: 1 }}
                        >
                          {action.choices.map((choice) => (
                            <FormControlLabel
                              key={choice.value}
                              value={choice.value}
                              control={<Radio size="small" sx={{ p: 0.25 }} />}
                              label={<Typography variant="caption">{regionNameRegex
                                ? linkifyRegionNames([choice.label], regionNameRegex, regionNameToId, navigateToRegion)
                                : choice.label}</Typography>}
                            />
                          ))}
                        </RadioGroup>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </Box>
      <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {activeReport?.stats
            ? `${activeReport.stats.passes} pass${activeReport.stats.passes > 1 ? 'es' : ''} · ${(activeReport.stats.inputTokens + activeReport.stats.outputTokens).toLocaleString()} tokens · $${activeReport.stats.cost.toFixed(4)}`
            : ''}
          {activeReport && activeReport.actions.length > 0 && (
            ` · ${activeReport.actions.filter(a => a.completed).length}/${activeReport.actions.length} done`
          )}
        </Typography>
        <Button onClick={() => setActiveReviewKey(null)} variant="outlined" size="small">Close</Button>
      </Box>
    </Drawer>
  );
}
