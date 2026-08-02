/**
 * Per-object breakdown of a sync run.
 *
 * Reads as sentences rather than JSON, and defaults to significant changes:
 * a run that rewrites 1200 descriptions and moves one site is a run about the
 * site.
 */

import { useState } from 'react';
import {
  Box, Typography, Chip, FormControlLabel, Switch, TablePagination, Stack,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getSyncLogChanges, type SyncChange, type SyncFieldChange } from '../../api/admin';
import { LoadingSpinner } from '../shared/LoadingSpinner';

const PAGE_SIZE = 25;

/** Beyond this, a value is described rather than reproduced. */
const INLINE_VALUE_LIMIT = 80;

const CHANGE_TYPE_COLOR: Record<SyncChange['change_type'], 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  created: 'success',
  updated: 'info',
  conflict: 'warning',
  missing: 'warning',
  returned: 'info',
  failed: 'error',
};

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function FieldRow({ change }: { change: SyncFieldChange }) {
  const oldText = describeValue(change.old);
  const newText = describeValue(change.new);
  const isLong = oldText.length > INLINE_VALUE_LIMIT || newText.length > INLINE_VALUE_LIMIT;

  return (
    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', pl: 2 }}>
      <Box component="span" sx={{ color: 'text.secondary' }}>{change.field}: </Box>
      {isLong
        ? `changed (${oldText.length} → ${newText.length} chars)`
        : `${oldText} → ${newText}`}
      {change.curatedConflict && (
        <Chip label="curated" size="small" color="warning" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} />
      )}
    </Typography>
  );
}

function ChangeRow({ change }: { change: SyncChange }) {
  return (
    <Box sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {change.name_snapshot ?? change.external_id}
        </Typography>
        <Typography variant="caption" color="text.secondary">({change.external_id})</Typography>
        <Chip label={change.change_type} size="small" color={CHANGE_TYPE_COLOR[change.change_type]} />
        {change.significance === 'major' && (
          <Chip label="major" size="small" color="warning" variant="outlined" />
        )}
      </Stack>
      {change.changed_fields?.map((field, i) => <FieldRow key={i} change={field} />)}
      {change.error && (
        <Typography variant="body2" color="error" sx={{ pl: 2, fontFamily: 'monospace', fontSize: '0.8rem' }}>
          {change.error}
        </Typography>
      )}
    </Box>
  );
}

export function SyncChangeList({ logId }: { logId: number }) {
  const [significantOnly, setSignificantOnly] = useState(true);
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'syncChanges', logId, significantOnly, page],
    queryFn: () => getSyncLogChanges(logId, {
      // Not significance='major': created, missing, returned, conflict and
      // failed rows carry no significance, and filtering on it would hide
      // everything a run is actually reporting. The server drops only minor
      // field edits.
      ...(significantOnly ? { significantOnly: true } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  });

  return (
    <Box>
      <FormControlLabel
        control={(
          <Switch
            checked={significantOnly}
            onChange={(e) => { setSignificantOnly(e.target.checked); setPage(0); }}
          />
        )}
        label="Significant only"
      />

      {isLoading && <LoadingSpinner padding={4} />}

      {isError && (
        <Typography color="error" sx={{ py: 3 }}>
          Could not load this run&apos;s changes
          {error instanceof Error ? `: ${error.message}` : '.'}
        </Typography>
      )}

      {/* The panel mounts this only for runs that have changeset rows, so an
          empty result means the filter removed them, not that the run recorded
          nothing. */}
      {!isLoading && !isError && data?.changes.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 3 }}>
          {significantOnly
            ? 'Nothing significant in this run — turn off the filter to see the routine edits.'
            : 'No changes on this page.'}
        </Typography>
      )}

      {!isLoading && !isError && data?.changes.map((change) => <ChangeRow key={change.id} change={change} />)}

      {!isLoading && !isError && (data?.total ?? 0) > PAGE_SIZE && (
        <TablePagination
          component="div"
          rowsPerPageOptions={[PAGE_SIZE]}
          count={data?.total ?? 0}
          rowsPerPage={PAGE_SIZE}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
        />
      )}
    </Box>
  );
}
