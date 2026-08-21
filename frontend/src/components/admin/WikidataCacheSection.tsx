/**
 * One source's Wikidata cache: what is in it, how old each part is, when it
 * expires, how long it lives by rule — and the two things an admin can do about
 * it.
 *
 * A cache nobody can see is a cache somebody will eventually debug at three in
 * the morning: the run says "1166 artwork classes" and nothing says whether that
 * came from Wikidata or from a row cached last week. So every kind shows its
 * age, its expiry, its size and its lifetime, and each can be cleared on its
 * own — an admin refreshing work pools rarely wants to re-fetch the class
 * closure that takes eleven minutes to rebuild.
 *
 * The kinds shown are the ones *this* source's collector can actually produce.
 * A panel that listed every kind for every source would offer to clear the
 * museum run's class trees on the UNESCO card, which is a cache that does not
 * exist explaining a run that never made it.
 *
 * **Per source, and closed until asked for.** The store is shared but every
 * question about it is about one source — "why did the *museum* run answer
 * that" — and the lifetimes differ per source as much as per kind. It is
 * troubleshooting information rather than a control on the way in, so it costs
 * nothing until an admin opens it: the query does not run while it is closed.
 *
 * Its own file rather than more of `SyncPanel.tsx`: that panel is about the runs
 * themselves, this is about what they remember.
 */

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Tooltip, TextField, Divider,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWikidataCache, clearWikidataCache, setWikidataCacheTtl, type WikidataCacheKind,
} from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';

/**
 * What each kind is, and why its lifetime is what it is.
 *
 * The second sentence is the one worth having on screen: an admin deciding
 * whether a day is too long for a pool needs to know what the number was chosen
 * against, and "the facts change at this rate" is that.
 */
const KINDS: Record<string, { title: string; what: string }> = {
  classes: {
    title: 'Class trees',
    what: 'Which classes count as artworks, and which as museums. Wikidata’s ontology moves over months, and rebuilding this takes about eleven minutes.',
  },
  pool: {
    title: 'Work pools',
    what: 'The candidate works of each class, ranked by how widely known they are. Changes as fast as people write articles — days rather than hours.',
  },
  statements: {
    title: 'Venue statements',
    what: 'Where each work says it hangs: owner and location, with their ranks. A painting moving between departments is exactly what a run is looking for.',
  },
  entities: {
    title: 'Entity details',
    what: 'Labels, descriptions, pictures, coordinates. Change constantly and matter least — a stale label is a cosmetic error.',
  },
  edges: {
    title: 'Entity edges',
    what: 'Class and part-of links, used to resolve a room or a department back to the museum that contains it.',
  },
};

/**
 * "in 3 days", "20 minutes ago".
 *
 * Relative rather than absolute because the question is how stale this is, not
 * what o'clock it was written; the exact stamp stays in the tooltip.
 */
function relative(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(Math.abs(ms) / 60000);
  let unit = `${minutes} min`;
  if (minutes >= 60 * 24) unit = `${Math.round(minutes / (60 * 24))} d`;
  else if (minutes >= 60) unit = `${Math.round(minutes / 60)} h`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}

function lifetime(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  if (hours >= 1) return `${Math.round(hours)} h`;
  return `${Math.round(hours * 60)} min`;
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "3 answers, 1166 rows, 220 KB" — what is in this part of the cache. */
function summarise(kind: WikidataCacheKind): string {
  const answers = plural(kind.entries, 'answer');
  return `${answers}, ${kind.rows} rows, ${sizeOf(kind.bytes)}`;
}

/** The repo has no shared pluraliser on this side, and three call sites want one. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function KindRow({ kind, busy, onClear, onSetTtl }: {
  kind: WikidataCacheKind;
  busy: boolean;
  onClear: (kind: string) => void;
  onSetTtl: (kind: string, hours: number) => void;
}) {
  const currentHours = kind.ttlMs / (60 * 60 * 1000);
  const [hours, setHours] = useState<string>(String(Number(currentHours.toFixed(2))));
  const parsed = Number(hours);
  const changed = Number.isFinite(parsed) && parsed > 0 && Math.abs(parsed - currentHours) > 0.001;
  const described = KINDS[kind.kind];

  return (
    <Box sx={{ py: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">{described?.title ?? kind.kind}</Typography>
        <Chip size="small" variant="outlined" label={`lives ${lifetime(kind.ttlMs)}`} />
        {kind.ttlSource !== 'default' && (
          <Chip size="small" variant="outlined" color="info" label="lifetime set by hand" />
        )}
        {/* Named only where it answers a question an admin has: how much of this
            would be fetched again if a run started now. */}
        {kind.expired > 0 && (
          <Chip size="small" color="warning" variant="outlined" label={`${kind.expired} expired`} />
        )}
      </Stack>

      {described && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {described.what}
        </Typography>
      )}

      <Typography variant="body2" color="text.secondary">
        {kind.entries === 0 ? 'Nothing cached yet.' : summarise(kind)}
      </Typography>

      {kind.entries > 0 && (
        <Typography variant="caption" color="text.secondary" component="p">
          <Tooltip title={kind.oldestFetchedAt ? formatDateTime(kind.oldestFetchedAt) : ''}>
            <span>oldest fetched {relative(kind.oldestFetchedAt)}</span>
          </Tooltip>
          {' · '}
          <Tooltip title={kind.nextExpiresAt ? formatDateTime(kind.nextExpiresAt) : ''}>
            <span>
              {kind.nextExpiresAt ? `first expires ${relative(kind.nextExpiresAt)}` : 'all expired'}
            </span>
          </Tooltip>
        </Typography>
      )}

      {kind.labels.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          latest cached: {kind.labels.join(' · ')}
        </Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
        <TextField
          size="small"
          label="Lives for (hours)"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          sx={{ width: 160 }}
          inputProps={{ inputMode: 'decimal' }}
        />
        <Tooltip title="Applies to what is already kept as well: an answer keeps its own age, so shortening the lifetime can expire it immediately.">
          <span>
            <Button
              size="small"
              disabled={busy || !changed}
              onClick={() => onSetTtl(kind.kind, parsed)}
            >
              Save lifetime
            </Button>
          </span>
        </Tooltip>
        <Button
          size="small"
          color="warning"
          disabled={busy || kind.entries === 0}
          onClick={() => onClear(kind.kind)}
        >
          Clear
        </Button>
      </Stack>
    </Box>
  );
}

export function WikidataCacheSection({ categoryId }: { categoryId: number }) {
  const queryClient = useQueryClient();
  // Closed until asked for, and not fetched until then either. This is
  // troubleshooting information — the question "why did the run answer that" —
  // and a panel that summed a cache table on every visit to the sync page would
  // be spending a query to tell nobody anything.
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wikidata-cache', categoryId],
    queryFn: () => getWikidataCache(categoryId),
    enabled: open,
  });
  const [note, setNote] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'wikidata-cache', categoryId] });

  /**
   * A refusal has to say so.
   *
   * Both of these end in `onSettled: refresh`, which re-reads the list — so a
   * rejected change repaints the same numbers and looks exactly like a change
   * that was accepted and did nothing. The note is the only place the
   * difference can appear.
   */
  const failed = (what: string) => (error: unknown) =>
    setNote(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);

  const clear = useMutation({
    mutationFn: (kind?: string) => clearWikidataCache(categoryId, kind),
    onSuccess: (result, kind) => {
      const scope = kind ? ` of ${kind}` : '';
      setNote(`Cleared ${plural(result.removed, 'cached answer')}${scope}. The next run asks Wikidata for them again.`);
    },
    onError: failed('Clearing the cache'),
    onSettled: refresh,
  });

  const setTtl = useMutation({
    mutationFn: ({ kind, hours }: { kind: string; hours: number }) =>
      setWikidataCacheTtl(categoryId, kind, hours),
    onSuccess: (result) => {
      // The re-stamp count is the part nobody can predict, and it is the answer
      // to "what did I just do": shortening a lifetime can expire a whole kind.
      const restamped = plural(result.restamped, 'cached answer');
      setNote(`${result.kind}: the cache now lives ${result.hours} h, and ${restamped} re-dated to match.`);
    },
    onError: failed('Changing the lifetime'),
    onSettled: refresh,
  });

  const busy = clear.isPending || setTtl.isPending;
  const kinds = data?.kinds ?? [];

  if (!open) {
    return (
      <Button
        size="small"
        startIcon={<ExpandMoreIcon />}
        onClick={() => setOpen(true)}
        sx={{ mt: 1 }}
      >
        Wikidata cache
      </Button>
    );
  }

  return (
    <Card variant="outlined" sx={{ mt: 1 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Button size="small" startIcon={<ExpandLessIcon />} onClick={() => setOpen(false)}>
            Wikidata cache
          </Button>
          <Button
            size="small"
            color="warning"
            startIcon={<DeleteSweepIcon />}
            disabled={busy || kinds.every(k => k.entries === 0)}
            onClick={() => clear.mutate(undefined)}
          >
            Clear this source's cache
          </Button>
        </Stack>

        {/* Only where there is a cache to describe. On a source that keeps
            nothing these two paragraphs are the negation of the line below —
            and since "Sync without cache" is now hidden for those sources, the
            second one also pointed at a button that is not on the screen. This
            file's own header argues against exactly that: a cache that does not
            exist explaining a run that never made it. */}
        {kinds.length > 0 && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              This source's runs cache what Wikidata answers, so a collection that
              fails part-way resumes instead of starting over and a question that has
              not changed costs their servers nothing. Nothing cached is ever shown to
              a visitor: it only decides whether a sync asks Wikidata again.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              <strong>Clear</strong> deletes the cache — the next run fetches it
              again. To ignore the cache for one run without deleting it, start that
              sync with <strong>Sync without cache</strong>.
            </Typography>
          </>
        )}

        {note && (
          <Typography variant="body2" color="text.primary" sx={{ mb: 1 }}>{note}</Typography>
        )}

        {isLoading && <Typography variant="body2">Loading…</Typography>}
        {!isLoading && kinds.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            This source caches nothing: its runs read the source's own API and ask
            Wikidata directly, so every run fetches everything again.
          </Typography>
        )}
        {kinds.map((kind, index) => (
          <Box key={kind.kind}>
            {index > 0 && <Divider />}
            <KindRow
              kind={kind}
              busy={busy}
              onClear={(k) => clear.mutate(k)}
              onSetTtl={(k, hours) => setTtl.mutate({ kind: k, hours })}
            />
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
