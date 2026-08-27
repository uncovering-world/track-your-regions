/**
 * What the catalogue holds, and what we have agreed to carry.
 *
 * Every other panel here is about *doing* something to the data — starting a
 * run, placing objects, importing a world view. This one is about what the data
 * has become: a set of claims that should hold about the rows themselves, asked
 * of the live database and answered in the words of the thing rather than of a
 * rule.
 *
 * The whole design rests on one distinction. A catalogue built from four
 * sources over years holds rows nobody is proud of, and a screen that shows
 * every one of them in red every morning is a screen an admin stops opening. So
 * a number somebody has accepted is *quiet* — stated, dated, attributed, and
 * left alone — while a number that has grown past it, or one nobody has
 * answered for, is what the page leads with.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutline as ClearIcon,
  ErrorOutline as BrokenIcon,
  ExpandLess,
  ExpandMore,
  HelpOutline as UnansweredIcon,
  Refresh as RefreshIcon,
  RemoveCircleOutline as HoldingIcon,
  TrendingDown as ImprovedIcon,
  TrendingUp as RegressedIcon,
  Visibility as WatchIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptDataAssertion,
  getDataAssertions,
  type AssertionStatus,
  type DataAssertion,
  type DataAssertionReport,
} from '../../api/admin/dataAssertions';
import { EmptyState } from '../shared/EmptyState';
import { formatDateTime } from '../../utils/dateFormat';
import { plural } from '../../utils/plural';

/**
 * How each status looks, and what it is called on screen.
 *
 * The words matter more than the colours here. "28, the number accepted" and
 * "28 nobody has answered for" are the same rows and opposite situations, and
 * an admin has to be able to tell them apart at a glance without reading the
 * number twice.
 */
const STATUS_LOOK: Record<AssertionStatus, {
  label: string;
  colour: 'default' | 'success' | 'warning' | 'error' | 'info';
  icon: React.ReactNode;
}> = {
  clear: { label: 'clear', colour: 'success', icon: <ClearIcon fontSize="small" /> },
  holding: { label: 'carried', colour: 'default', icon: <HoldingIcon fontSize="small" /> },
  improved: { label: 'fewer than accepted', colour: 'success', icon: <ImprovedIcon fontSize="small" /> },
  regressed: { label: 'more than accepted', colour: 'error', icon: <RegressedIcon fontSize="small" /> },
  unanswered: { label: 'nobody has answered for this', colour: 'warning', icon: <UnansweredIcon fontSize="small" /> },
  watch: { label: 'a number to watch', colour: 'info', icon: <WatchIcon fontSize="small" /> },
  error: { label: 'did not run', colour: 'error', icon: <BrokenIcon fontSize="small" /> },
};

const AREA_LABELS: Record<DataAssertion['area'], string> = {
  places: 'Places',
  regions: 'Regions',
  boundaries: 'Boundaries',
  objects: 'Objects',
  pictures: 'Pictures',
};

/** The count, and what it is being read against. */
function tally(assertion: DataAssertion): string {
  const { found, accepted, status } = assertion;
  if (status === 'error') return 'nothing, the query failed';
  if (found === 0 && accepted === null) return 'nothing found';
  if (status === 'watch') return plural(found, 'row');
  if (accepted === null) return `${plural(found, 'row')}, none of them accepted`;
  if (found > accepted) return `${found} rows, ${found - accepted} more than the ${accepted} accepted`;
  if (found < accepted) return `${found} rows, ${accepted - found} fewer than the ${accepted} accepted`;
  return `${found} rows, the number accepted`;
}

function AssertionCard({ assertion, onAccept, accepting }: {
  assertion: DataAssertion;
  onAccept: (id: string) => void;
  accepting: boolean;
}) {
  // Open where somebody has to act, closed where the number is merely being
  // carried: the rows behind accepted debt are worth having, not worth reading
  // every morning.
  const [open, setOpen] = useState(assertion.needsAttention);
  // A card keeps its identity across reads, so the initial value alone would
  // leave a check that has just gone from carried to grown sitting collapsed —
  // the one card whose rows somebody needs. Adjusted during render rather than
  // in an effect, so the change lands in the same paint.
  const [wasUrgent, setWasUrgent] = useState(assertion.needsAttention);
  if (wasUrgent !== assertion.needsAttention) {
    setWasUrgent(assertion.needsAttention);
    setOpen(assertion.needsAttention);
  }
  const look = STATUS_LOOK[assertion.status];
  const canAccept = assertion.kind === 'invariant'
    && assertion.status !== 'error'
    && (assertion.status === 'unanswered' || assertion.status === 'regressed' || assertion.status === 'improved');

  return (
    <Card variant="outlined" sx={{ borderColor: assertion.needsAttention ? 'error.light' : undefined }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap">
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Typography variant="subtitle1">{assertion.title}</Typography>
            <Typography variant="body2" color="text.secondary">{tally(assertion)}</Typography>
          </Box>
          <Chip size="small" icon={look.icon as React.ReactElement} label={look.label} color={look.colour} />
        </Stack>

        {assertion.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {assertion.error}
          </Alert>
        )}

        {assertion.needsAttention && !assertion.error && (
          <Typography variant="body2" sx={{ mt: 2 }}>{assertion.meaning}</Typography>
        )}

        {assertion.accepted !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {assertion.accepted} accepted
            {assertion.acceptedBy ? ` by ${assertion.acceptedBy}` : ''}
            {assertion.acceptedAt ? ` on ${formatDateTime(assertion.acceptedAt)}` : ''}
          </Typography>
        )}

        {assertion.sample.length > 0 && (
          <>
            <Button
              size="small"
              onClick={() => setOpen(!open)}
              endIcon={open ? <ExpandLess /> : <ExpandMore />}
              sx={{ mt: 1 }}
            >
              {open ? 'Hide rows' : `Show rows (${Math.min(assertion.sample.length, assertion.found)} of ${assertion.found})`}
            </Button>
            <Collapse in={open}>
              <Box component="ul" sx={{ pl: 3, mt: 1, mb: 0 }}>
                {/*
                  Keyed by position, not by the sentence: two rows can say the
                  same thing. The visits watch drops the location id whenever
                  the place has a name, so two components of one serial site
                  sharing a name and a count render identically.
                */}
                {assertion.sample.map((line, index) => (
                  <Typography component="li" variant="body2" color="text.secondary" key={`${assertion.id}-${index}`}>
                    {line}
                  </Typography>
                ))}
              </Box>
              {assertion.found > assertion.sample.length && (
                <Typography variant="caption" color="text.secondary" sx={{ pl: 3 }}>
                  … and {assertion.found - assertion.sample.length} more
                </Typography>
              )}
            </Collapse>
          </>
        )}

        {canAccept && (
          <Box sx={{ mt: 2 }}>
            <Tooltip title="Record this number as the debt this catalogue carries. A larger number later is what raises attention.">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={accepting}
                  onClick={() => onAccept(assertion.id)}
                >
                  {accepting ? 'Accepting…' : `Accept ${assertion.found} as carried`}
                </Button>
              </span>
            </Tooltip>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function CatalogueChecksPanel() {
  const queryClient = useQueryClient();
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin', 'data-assertions'],
    queryFn: getDataAssertions,
    // A statement per assertion over the whole catalogue: read when somebody opens the
    // section, never polled.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const accept = useMutation({
    mutationFn: acceptDataAssertion,
    onSuccess: accepted => {
      setSnackbar({
        open: true,
        severity: 'success',
        message: `Carrying ${plural(accepted.found, 'row')} for "${accepted.title}".`,
      });
      // The endpoint answers with the check it just recorded, so the one line
      // that changed is written into the cache. Invalidating instead would
      // re-run every statement per press — a couple of seconds of database
      // work, and a second request against the limiter, for an answer the
      // server has already given.
      queryClient.setQueryData(['admin', 'data-assertions'], (previous?: DataAssertionReport) => {
        if (!previous) return previous;
        const assertions = previous.assertions.map(entry => entry.id === accepted.id ? accepted : entry);
        return {
          ...previous,
          assertions,
          needsAttention: assertions.filter(entry => entry.needsAttention).length,
          // A row was written, so the ledger is there and writable — carrying
          // the earlier "could not be read" notice forward would put it above
          // the card that just said "28 accepted", and an admin could not tell
          // from that whether the number stuck. The next read decides afresh.
          acceptancesUnavailable: null,
        };
      });
    },
    onError: (mutationError: Error) => {
      setSnackbar({ open: true, severity: 'error', message: mutationError.message });
    },
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">{(error as Error).message}</Alert>;
  }

  const assertions = data?.assertions ?? [];
  const areas = [...new Set(assertions.map(assertion => assertion.area))];

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Catalogue Checks</Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          disabled={isFetching}
          onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'data-assertions'] })}
        >
          {isFetching ? 'Reading…' : 'Read again'}
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        What must be true of the catalogue&apos;s own rows, asked of the live database. A number
        somebody has accepted is debt this catalogue is knowingly carrying; a number that has grown
        past it means something is writing those rows now.
      </Typography>

      {data?.acceptancesUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>{data.acceptancesUnavailable}</Alert>
      )}

      {data && data.needsAttention > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {`${plural(data.needsAttention, 'check')} ${data.needsAttention === 1 ? 'needs' : 'need'} a person: `}
          a count that grew, a rule nobody has answered for, or a query that could not run.
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          Nothing has grown past what was accepted.
        </Alert>
      )}

      {assertions.length === 0 && <EmptyState message="No checks are defined." />}

      {areas.map(area => (
        <Box key={area} sx={{ mb: 3 }}>
          <Divider textAlign="left" sx={{ mb: 1 }}>
            <Typography variant="overline" color="text.secondary">{AREA_LABELS[area]}</Typography>
          </Divider>
          <Stack spacing={2}>
            {assertions.filter(assertion => assertion.area === area).map(assertion => (
              <AssertionCard
                key={assertion.id}
                assertion={assertion}
                accepting={accept.isPending && accept.variables === assertion.id}
                onAccept={id => accept.mutate(id)}
              />
            ))}
          </Stack>
        </Box>
      ))}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
