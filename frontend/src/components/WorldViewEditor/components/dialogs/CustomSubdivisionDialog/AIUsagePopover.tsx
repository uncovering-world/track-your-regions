/**
 * Component: AI usage statistics popover display.
 */

import {
  Paper,
  Box,
  Typography,
  Button,
  Chip,
  Divider,
  Popover,
} from '@mui/material';
import type { UsageStats, LastOperation } from './aiAssistTypes';
import { getPercentage } from './useAIUsageTracking';

interface AIUsagePopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  lastOperation: LastOperation | null;
  singleRequestStats: UsageStats;
  batchRequestStats: UsageStats;
  totalStats: UsageStats;
  onResetStats: () => void;
}

export function AIUsagePopover({
  anchorEl,
  onClose,
  lastOperation,
  singleRequestStats,
  batchRequestStats,
  totalStats,
  onResetStats,
}: AIUsagePopoverProps) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Paper sx={{ p: 2, minWidth: 320, maxWidth: 400 }}>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          💰 AI Usage Statistics
        </Typography>

        {/* Last Operation */}
        {lastOperation && (
          <>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Last Operation
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Chip
                    label={lastOperation.type === 'batch' ? 'Batch' : 'Single'}
                    size="small"
                    color={lastOperation.type === 'batch' ? 'primary' : 'default'}
                    sx={{ mr: 1 }}
                  />
                  <Typography variant="body2" component="span">
                    {lastOperation.regionsCount} region{lastOperation.regionsCount > 1 ? 's' : ''}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body2" fontWeight="bold" color="primary">
                    ${lastOperation.totalCost.toFixed(4)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {lastOperation.tokens.toLocaleString()} tokens
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {lastOperation.model} • In: {getPercentage(lastOperation.inputCost, lastOperation.totalCost)}% / Out: {getPercentage(lastOperation.outputCost, lastOperation.totalCost)}%{lastOperation.webSearchCost > 0 ? ` / 🌐: ${getPercentage(lastOperation.webSearchCost, lastOperation.totalCost)}%` : ''}
              </Typography>
            </Paper>
          </>
        )}

        <Divider sx={{ my: 1.5 }} />

        {/* Stats by Type */}
        <Typography variant="subtitle2" gutterBottom>
          Session Totals
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          {/* Single Requests */}
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Single Requests
            </Typography>
            <Typography variant="h6" color="text.primary">
              {singleRequestStats.requests}
            </Typography>
            <Typography variant="body2">
              {singleRequestStats.regionsProcessed || 0} region{(singleRequestStats.regionsProcessed || 0) !== 1 ? 's' : ''}
            </Typography>
            <Typography variant="body2" color="primary" fontWeight="medium">
              ${singleRequestStats.totalCost.toFixed(4)}
            </Typography>
            {(singleRequestStats.regionsProcessed || 0) > 0 && (
              <Typography variant="caption" color="success.main" fontWeight="medium">
                Avg: ${(singleRequestStats.totalCost / (singleRequestStats.regionsProcessed || 1)).toFixed(6)}/region
              </Typography>
            )}
            {singleRequestStats.totalCost > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                In: {getPercentage(singleRequestStats.inputCost, singleRequestStats.totalCost)}% / Out: {getPercentage(singleRequestStats.outputCost, singleRequestStats.totalCost)}%
              </Typography>
            )}
          </Paper>

          {/* Batch Requests */}
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Batch Requests
            </Typography>
            <Typography variant="h6" color="text.primary">
              {batchRequestStats.requests}
            </Typography>
            <Typography variant="body2">
              {batchRequestStats.regionsProcessed || 0} region{(batchRequestStats.regionsProcessed || 0) !== 1 ? 's' : ''}
            </Typography>
            <Typography variant="body2" color="primary" fontWeight="medium">
              ${batchRequestStats.totalCost.toFixed(4)}
            </Typography>
            {(batchRequestStats.regionsProcessed || 0) > 0 && (
              <Typography variant="caption" color="success.main" fontWeight="medium">
                Avg: ${(batchRequestStats.totalCost / (batchRequestStats.regionsProcessed || 1)).toFixed(6)}/region
              </Typography>
            )}
            {batchRequestStats.totalCost > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                In: {getPercentage(batchRequestStats.inputCost, batchRequestStats.totalCost)}% / Out: {getPercentage(batchRequestStats.outputCost, batchRequestStats.totalCost)}%
              </Typography>
            )}
          </Paper>
        </Box>

        {/* Grand Total */}
        <Paper
          variant="outlined"
          sx={{ p: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText' }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="body2">
                Total: {totalStats.requests} request{totalStats.requests !== 1 ? 's' : ''}, {totalStats.regionsProcessed || 0} region{(totalStats.regionsProcessed || 0) !== 1 ? 's' : ''}
              </Typography>
              <Typography variant="caption">
                {totalStats.tokens.toLocaleString()} tokens
              </Typography>
              {(totalStats.regionsProcessed || 0) > 0 && (
                <Typography variant="caption" sx={{ display: 'block' }}>
                  Avg: ${(totalStats.totalCost / (totalStats.regionsProcessed || 1)).toFixed(6)}/region
                </Typography>
              )}
              {totalStats.totalCost > 0 && (
                <Typography variant="caption" sx={{ display: 'block' }}>
                  In: {getPercentage(totalStats.inputCost, totalStats.totalCost)}% / Out: {getPercentage(totalStats.outputCost, totalStats.totalCost)}%
                </Typography>
              )}
            </Box>
            <Typography variant="h5" fontWeight="bold">
              ${totalStats.totalCost.toFixed(4)}
            </Typography>
          </Box>
        </Paper>

        {totalStats.requests > 0 && (
          <Button
            size="small"
            variant="outlined"
            onClick={onResetStats}
            sx={{ mt: 1.5, width: '100%' }}
          >
            Reset Statistics
          </Button>
        )}
      </Paper>
    </Popover>
  );
}
