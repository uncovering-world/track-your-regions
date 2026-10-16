/**
 * A curator's admission pins and the way to hand one back (#1369).
 *
 * A pin is a curator's answer to a kind's rule — a place put back over a
 * refusal, or kept out — that every run leaves as it is. Nothing showed one:
 * the answer was on no screen, and a curator who learned the rule was right
 * had no way to give the place back to it. Each pin here says what was
 * answered, by whom, when, against which reason and with which note, and
 * offers the hand-back, after which the next run of the kind's source decides,
 * as it decides about any place nobody pinned.
 *
 * Two surfaces read one list: the place's curation dialog (`PlacePins`, one
 * place's pins) and the review page (`PinnedAnswers`, every pin in scope,
 * collapsed at the foot beside the other answered work) — until curators have
 * a home screen of their own (#614).
 */

import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAdmissionPins, handBackAdmissionPin, type AdmissionPin } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { AnsweredSection } from '../curation/AnsweredSection';
import { RefusalLine } from '../curation/RefusalLine';
import { formatDateTime } from '../../utils/dateFormat';
import { displayNameOf } from '../../utils/displayName';
import { invalidateExperiences } from '../../utils/queryInvalidation';

/** What the answer did, and who gave it. */
function answeredLine(pin: AdmissionPin): string {
  const who = displayNameOf(pin.curatorName) ?? 'A curator';
  const what = pin.answer === 'admitted' ? `put it back in ${pin.kindName}` : `kept it out of ${pin.kindName}`;
  const when = pin.answeredAt ? ` on ${formatDateTime(pin.answeredAt)}` : '';
  const note = pin.note ? ` — “${pin.note}”` : '';
  return `${who} ${what}${when}${note}`;
}

/** What handing back leaves to the next run, said on the button's caption. */
function nextRunWords(pin: AdmissionPin): string {
  return pin.answer === 'admitted'
    ? `It stays in ${pin.kindName} until the next run; a run that still turns it down asks you again.`
    : `It stays out of ${pin.kindName} until a run's rule would take it in.`;
}

function PinRow({ pin, regionId, showName }: { pin: AdmissionPin; regionId: number | null; showName: boolean }) {
  const queryClient = useQueryClient();
  const handBack = useMutation({
    mutationFn: () => handBackAdmissionPin(pin.experienceId, { membershipId: pin.membershipId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.admissionPinsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
      invalidateExperiences(queryClient, { regionId, experienceId: pin.experienceId });
    },
  });

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      {showName && <Typography variant="subtitle2">{pin.name}</Typography>}
      <Typography variant="body2">{answeredLine(pin)}</Typography>
      {pin.answeredReason && (
        <Stack sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {pin.answer === 'admitted' ? 'against the rule’s objection:' : 'as the rule had decided:'}
          </Typography>
          <RefusalLine reason={pin.answeredReason} name={pin.name} />
        </Stack>
      )}
      {pin.questioned && (
        <Typography variant="caption" color="warning.main" display="block">
          A run asks again about this answer — on the review page.
        </Typography>
      )}
      {handBack.isError && (
        <Alert severity="error" sx={{ py: 0, my: 1 }}>{(handBack.error as Error).message}</Alert>
      )}
      {pin.canHandBack ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Button size="small" variant="outlined" disabled={handBack.isPending} onClick={() => handBack.mutate()}>
            Hand the pin back
          </Button>
          <Typography variant="caption" color="text.secondary">{nextRunWords(pin)}</Typography>
        </Stack>
      ) : (
        // A curator's own refusal answered no rule, and a source that publishes a
        // list never takes a refused place back by itself: the put-back is its way back.
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          A curator’s own refusal, not an answer to a rule: to show it again, put it back from the kept-out list.
        </Typography>
      )}
    </Box>
  );
}

/** One place's pins, in its curation dialog; nothing where the place holds none. */
export function PlacePins({ experienceId, regionId }: { experienceId: number; regionId: number | null }) {
  const pins = useQuery({
    queryKey: queryKeys.curation.admissionPins(experienceId),
    queryFn: () => fetchAdmissionPins(experienceId),
    staleTime: 30_000,
  });
  const list = pins.data?.pins ?? [];
  if (list.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Pinned against a kind’s rule</Typography>
      <Stack spacing={1}>
        {list.map(pin => <PinRow key={pin.membershipId} pin={pin} regionId={regionId} showName={false} />)}
      </Stack>
    </Box>
  );
}

/** The pins under their kinds, in the order the server sent them: by kind, then by place. */
function byKind(pins: AdmissionPin[]): [string, AdmissionPin[]][] {
  const groups = new Map<string, AdmissionPin[]>();
  for (const pin of pins) groups.set(pin.kindName, [...(groups.get(pin.kindName) ?? []), pin]);
  return [...groups];
}

/** Every pin in scope, at the foot of the review page with the rest of the answered work. */
export function PinnedAnswers() {
  const pins = useQuery({
    queryKey: queryKeys.curation.admissionPins(null),
    queryFn: () => fetchAdmissionPins(),
    staleTime: 30_000,
  });
  const list = pins.data?.pins ?? [];
  if (list.length === 0) return null;
  return (
    <AnsweredSection
      label="the answers pinned against a rule"
      count={list.length}
      explanation={'Places a curator put back into a kind, or kept out of it, against the kind’s rule. Every run '
        + 'leaves them as they were left. Hand one back when the rule was right after all: the next run decides.'
        + (pins.data?.more ? ' The list shows the first 500.' : '')}
    >
      {byKind(list).map(([kind, pins]) => (
        <Stack key={kind} spacing={1}>
          <Typography variant="subtitle2">{kind}</Typography>
          {pins.map(pin => <PinRow key={pin.membershipId} pin={pin} regionId={null} showName />)}
        </Stack>
      ))}
    </AnsweredSection>
  );
}
