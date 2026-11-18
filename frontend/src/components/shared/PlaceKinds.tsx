/**
 * Every kind a place belongs to, on its curation dialog, and taking a
 * published place out of one of them (#2022).
 *
 * The review queue answers only what a run asked about. The Temple of Concord
 * is offered by Places of worship and by Archaeology, only its podium is left,
 * and no run raised a question about it: a curator who judged it not worth a
 * visit had nowhere to say so. Here each kind is a row with where it stands;
 * an offered one is taken out by picking why from a refusal's reasons (#863),
 * under a line that says what readers lose; a kept-out one says who kept it
 * out and why, and is put back with the override every pinned refusal has.
 * Each act sends the region the curator has open, which its log entry names
 * as where they were working. An arrival and a rule's refusal
 * are answered on the review page, and say so. A kind no run offers the place
 * in is added at the foot (`PlaceKindAdd`, #2035), and an added one says who
 * added it. A kind that shows a crowded city's best known links to the
 * crowded city's window on the place's membership — "Squares around (22)",
 * #2282 — as the place's review card does: the review page's *Crowded
 * cities* tab, open on the place (`crowdedPlaceUrl`, #2487).
 */

import { Link as RouterLink } from 'react-router';
import { Alert, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPlaceKinds, keepOutOfKind, setExperienceAdmission, type PlaceKindStanding,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { formatDateTime } from '../../utils/dateFormat';
import { displayNameOf } from '../../utils/displayName';
import { typeLabelFor } from '../../utils/experienceTypes';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { PlaceKindAdd } from './PlaceKindAdd';
import { ReasonMenu } from './ReasonMenu';
import { ADDITION_REASON_CODES, REFUSAL_REASON_CODES } from '@tyr/shared/curationLog';
import { aroundLabel } from '../curation/crowding/crowdingWords';
import { crowdedPlaceUrl } from '../../utils/appUrl';

/** The line under a kind's name: its type, then where it stands. */
function standingLine(kind: PlaceKindStanding): string {
  const type = kind.type ? `${typeLabelFor(kind.kindId, kind.type).toLowerCase()} · ` : '';
  switch (kind.state) {
    case 'offered': return `${type}offered`;
    case 'waiting': return `${type}waiting for a curator, on the review page`;
    case 'refused': return [`${type}kept out by its rule`, kind.reason].filter(Boolean).join(': ');
    case 'kept-out': return `${type}kept out`;
  }
}

/** Who kept it out or added it, and when, as the pins list says it. */
function answeredBy(kind: PlaceKindStanding, act: 'kept out' | 'added'): string {
  const who = displayNameOf(kind.curatorName) ?? 'a curator';
  const when = kind.answeredAt ? formatDateTime(kind.answeredAt) : null;
  return [`${act} by ${who}`, when].filter(Boolean).join(' · ');
}

/** The row's ground: greyed once kept out. */
function rowGround(theme: Theme, keptOut: boolean): string | undefined {
  return keptOut ? theme.palette.action.hover : undefined;
}

/** What readers lose when the place is taken out of this kind, said above the reasons. */
function takeOutLoses(kind: PlaceKindStanding, onlyOffered: boolean): string {
  return onlyOffered
    ? 'Its only kind: it leaves every list, the map and the counts. Visits stay.'
    : `It leaves ${kind.kindName} and stays in its other kinds.`;
}

/** What a kind's answer moves: the card, the pins, the queue, the history and the reader's lists. */
function useKindSettled(experienceId: number, regionId: number | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.placeKinds(experienceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.admissionPinsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
    invalidateExperiences(queryClient, { regionId, experienceId });
  };
}

/** Why the crowded city's link is held while the dialog's form has edits: following it closes the dialog. */
const LEAVE_HELD = 'Save or discard your edits first: this opens the Crowded cities tab and closes the dialog.';

function KindRow({ experienceId, kind, onlyOffered, regionId, unsavedEdits }: {
  experienceId: number;
  kind: PlaceKindStanding;
  /** Whether this is the one kind that offers the place: taken out, readers see it nowhere. */
  onlyOffered: boolean;
  regionId: number | null;
  /** The dialog's form has edits a link away would drop without asking. */
  unsavedEdits: boolean;
}) {
  const settled = useKindSettled(experienceId, regionId);
  // Taking a place out goes against the kind's rule, so it says why (#863).
  const takeOut = useMutation({
    mutationFn: ({ reasonCode, note }: { reasonCode: (typeof REFUSAL_REASON_CODES)[number]; note?: string }) =>
      keepOutOfKind(experienceId, { membershipId: kind.membershipId, reasonCode, note, regionId: regionId ?? undefined }),
    onSuccess: settled,
  });
  // A put-back goes against the kind's rule too, as on the review page.
  const putBack = useMutation({
    mutationFn: ({ reasonCode, note }: { reasonCode: (typeof ADDITION_REASON_CODES)[number]; note?: string }) =>
      setExperienceAdmission(experienceId, {
        decision: 'override', membershipId: kind.membershipId, reasonCode, note, regionId: regionId ?? undefined,
      }),
    onSuccess: settled,
  });
  const failed = takeOut.error ?? putBack.error;
  const keptOut = kind.state === 'kept-out';

  return (
    <Box
      sx={{
        p: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 },
        bgcolor: (theme) => rowGround(theme, keptOut),
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: keptOut ? 'text.secondary' : undefined }}>
            {kind.kindName}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">{standingLine(kind)}</Typography>
          {kind.added && !keptOut && (
            <Chip size="small" color="success" variant="outlined" label={answeredBy(kind, 'added')} sx={{ mt: 0.5 }} />
          )}
          {kind.added && !keptOut && kind.note && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic', mt: 0.5 }}>
              “{kind.note}”
            </Typography>
          )}
          {keptOut && (
            <>
              <Chip size="small" color="warning" variant="outlined" label={answeredBy(kind, 'kept out')} sx={{ mt: 0.5 }} />
              {kind.note && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic', mt: 0.5 }}>
                  “{kind.note}”
                </Typography>
              )}
            </>
          )}
        </Box>
        {kind.crowding && unsavedEdits && (
          // A disabled button takes no hover, so the hint hangs on its wrapper.
          <Tooltip title={LEAVE_HELD}>
            <span>
              <Button size="small" variant="outlined" color="inherit" disabled sx={{ flexShrink: 0 }}>
                {aroundLabel({ kind_id: kind.kindId, kind_name: kind.kindName, kind_type: kind.type }, kind.crowding)}
              </Button>
            </span>
          </Tooltip>
        )}
        {kind.crowding && !unsavedEdits && (
          <Button
            size="small" variant="outlined" color="inherit" component={RouterLink} to={crowdedPlaceUrl(kind.membershipId)}
            sx={{ flexShrink: 0 }}
          >
            {aroundLabel({ kind_id: kind.kindId, kind_name: kind.kindName, kind_type: kind.type }, kind.crowding)}
          </Button>
        )}
        {kind.canAnswer && kind.state === 'offered' && (
          <ReasonMenu
            label="Take out"
            reasons={REFUSAL_REASON_CODES}
            size="small"
            color="error"
            heading={takeOutLoses(kind, onlyOffered)}
            disabled={takeOut.isPending}
            onChoose={(reasonCode, note) => takeOut.mutate({ reasonCode, note })}
          />
        )}
        {kind.canAnswer && keptOut && (
          <ReasonMenu
            label="Put back"
            reasons={ADDITION_REASON_CODES}
            size="small"
            color="primary"
            disabled={putBack.isPending}
            onChoose={(reasonCode, note) => putBack.mutate({ reasonCode, note })}
          />
        )}
      </Stack>
      {failed && <Alert severity="error" sx={{ py: 0, mt: 1 }}>{(failed as Error).message}</Alert>}
    </Box>
  );
}

/** The Kinds section of a place's curation dialog; nothing until its kinds are read. */
export function PlaceKinds({ experienceId, regionId, unsavedEdits = false }: {
  experienceId: number;
  regionId: number | null;
  /** The dialog's form has edits: the crowded city's link, which leaves the dialog, waits until they are saved. */
  unsavedEdits?: boolean;
}) {
  const kinds = useQuery({
    queryKey: queryKeys.curation.placeKinds(experienceId),
    queryFn: () => fetchPlaceKinds(experienceId),
    // Read afresh on every opening: the review page answers kinds too, and a row
    // offering an action on a standing that has moved would only earn a 409.
    staleTime: 0,
  });
  const settled = useKindSettled(experienceId, regionId);
  const list = kinds.data?.kinds ?? [];
  const addable = kinds.data?.addable ?? [];
  if (list.length === 0 && addable.length === 0) return null;
  const offered = list.filter(kind => kind.state === 'offered').length;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Kinds</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Where readers find this place. Each kind is answered on its own.
      </Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {list.map(kind => (
          <KindRow
            key={kind.membershipId}
            experienceId={experienceId}
            kind={kind}
            onlyOffered={kind.state === 'offered' && offered === 1}
            regionId={regionId}
            unsavedEdits={unsavedEdits}
          />
        ))}
        {addable.length > 0 && (
          <Box sx={{ borderTop: list.length > 0 ? 1 : 0, borderColor: 'divider' }}>
            <PlaceKindAdd experienceId={experienceId} addable={addable} regionId={regionId} onAdded={settled} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
