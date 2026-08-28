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
  // Not `info`: that is `updated`, and the whole point of the word is that this
  // row was *not* updated. Warning, like `conflict`, because both mean the run
  // refused a write — which of the two it was, the row's own chip says.
  held: 'warning',
  // `info`, beside `updated`: something really did change about the object, and
  // unlike the two above nothing was refused and nobody is waiting.
  contents: 'info',
  filtered: 'default',
  missing: 'warning',
  returned: 'info',
  failed: 'error',
};

/** What a source's own reference calls a thing, when it has no name of its own. */
function itemLabel(item: { name: string | null; ref: string | null }): string {
  return item.name ?? item.ref ?? 'an unnamed one';
}

/**
 * What a rewrite was, in the fewest words that still answer it.
 *
 * Grouped by cause and counted, never listed. A site whose points a curator has
 * corrected raises one of these per run while the source keeps offering its own
 * coordinates, and six lines saying "a point moved" are six questions nobody can
 * answer separately, while "6 moved" is one fact about the site that a person can
 * act on. The listing that does belong per row is on the curator's card, where
 * the decision is.
 *
 * A claim is counted apart because it is a different event: the source proposed
 * something and did not get it, so the number is how often it is still arguing
 * with a curator rather than how often anything changed.
 */
function rewriteSummary(
  changed: Array<{ fields: SyncFieldChange[] }>,
): string | null {
  if (changed.length === 0) return null;
  const verbs: Record<string, string> = {
    location: 'moved',
    name: 'renamed',
    artist: 're-attributed',
    year: 'redated',
    image_url: 'repictured',
  };
  const counts = new Map<string, number>();
  let claimed = 0;
  for (const row of changed) {
    for (const field of row.fields) {
      const verb = verbs[field.field] ?? `changed ${field.field}`;
      counts.set(verb, (counts.get(verb) ?? 0) + 1);
      if (field.curatedConflict) claimed += 1;
    }
  }
  const said = [...counts].map(([verb, count]) => `${count} ${verb}`).join(', ');
  return claimed > 0 ? `${said} (${claimed} kept over the source, claimed)` : said;
}

/**
 * One line per kind of contents the run moved, in words rather than as JSON.
 *
 * Exported for its test: the shape is a nested record and the line it produces is
 * the whole of what a report reader sees about a `contents` row.
 */
export function contentsLines(
  contents: SyncChange['contents'],
): string[] {
  if (!contents) return [];
  const kindName: Record<string, string> = { locations: 'places', treasures: 'works' };
  return Object.entries(contents).flatMap(([kind, delta]) => {
    if (!delta) return [];
    const parts: string[] = [];
    if (delta.added.length > 0) parts.push(`gained ${delta.added.map(itemLabel).join(', ')}`);
    if (delta.withdrawn.length > 0) parts.push(`lost ${delta.withdrawn.map(itemLabel).join(', ')}`);
    // Its own word, because the row and everything hanging off it are the same ones
    // as before — a visit on that point was never touched (ADR-0022).
    if (delta.returned.length > 0) parts.push(`offered again: ${delta.returned.map(itemLabel).join(', ')}`);
    const rewritten = rewriteSummary(delta.changed ?? []);
    if (rewritten) parts.push(rewritten);
    return parts.length > 0 ? [`${kindName[kind] ?? kind}: ${parts.join('; ')}`] : [];
  });
}

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
      {/* Why the run did not write this, when it did not. Without a chip the line
          reads `old → new` and the value on the right reads as the one now live —
          which for a refused write is the opposite of the truth (#519). The two
          words mean opposite things about who is waiting, so they are two chips
          rather than one shared "not applied": `curated` says a person's value
          won on purpose and nothing is waiting; `held` says nobody has looked and
          a verdict is.
          Two colours rather than two shapes, checked against the rendered row: a
          row can carry one of each (a claimed field beside a gate-held one), and
          the same orange in an outlined variant made the held one the fainter of
          the two — backwards, since it is the one still waiting on someone. Blue
          cannot be misread as "applied" here, because an applied field carries no
          chip at all: on these lines a chip always means refused. */}
      {change.curatedConflict && (
        <Chip label="curated" size="small" color="warning" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} />
      )}
      {change.held && (
        <Chip label="held" size="small" color="info" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} />
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
      {contentsLines(change.contents).map(line => (
        // Named, not counted: "gained 1 place" is what the run's own counters already
        // say badly, and *which* component arrived is the thing this column exists to
        // keep (ADR-0026). A `contents` row has no field rows at all, so without this
        // it would be a name and a chip.
        <Typography key={line} variant="body2" sx={{ pl: 2 }}>{line}</Typography>
      ))}
      {change.error && (
        <Typography
          variant="body2"
          // A filtered row carries its reason in the same field, but nothing
          // went wrong with it — painting "a collection rather than a museum"
          // in red would report the filter working as a failure.
          color={change.change_type === 'filtered' ? 'text.secondary' : 'error'}
          sx={{ pl: 2, fontFamily: 'monospace', fontSize: '0.8rem' }}
        >
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
      // Not significance='major': created, missing, returned, conflict, contents and
      // failed rows carry no significance — it is null wherever no *field* was weighed
      // — and filtering on it would hide everything a run is actually reporting. What the server drops is a minor
      // field edit that moved nothing else — a row whose contents moved stays,
      // because `significance` weighs fields only and that row is the only record
      // anywhere that a component arrived (ADR-0026), and so does an updated row
      // where the source ran into a curator's claim, however minor the field (#516).
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
