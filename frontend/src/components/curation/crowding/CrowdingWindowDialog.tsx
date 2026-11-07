/**
 * The crowded-city window as a dialog (#2282, #2358), over what it was opened
 * from: a review card or a place's curation dialog, on that card's place. It
 * opens the region's list of the place's group — the leaf region the place is
 * listed under, its kind and its type — with the place open in its own
 * circle, so the curator sees it among what the region's page shows. The
 * window itself is `CrowdingWindow`; this frame learns the group from the
 * place's read, lays the window out in a wide dialog, full screen on a narrow
 * one, keeps its staged answers and the place open while it is open, and
 * hands what the answers did to its opener on close.
 *
 * Its own chunk: the review page loads it when a curator opens it.
 */

import { useState, type ReactNode } from 'react';
import {
  Alert, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useQuery } from '@tanstack/react-query';
import { fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { queryKeys } from '../../../api/queryKeys';
import { LoadingSpinner } from '../../shared/LoadingSpinner';
import { CrowdingWindow } from './CrowdingWindow';
import type { Staging } from './crowdingStaging';

export function CrowdingWindowDialog({ membershipId, onClose }: {
  /** The card's place, by its membership: the window opens on its group, with it open. */
  membershipId: number;
  /** Closed; with what the answers applied did, where any were applied. */
  onClose: (message?: string) => void;
}) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const [staging, setStaging] = useState<Staging>(new Map());
  const [selected, setSelected] = useState<number | null>(membershipId);
  const [appliedLines, setAppliedLines] = useState<string[]>([]);
  const close = () => onClose(appliedLines.length > 0 ? appliedLines.join(' ') : undefined);
  // The card's place names its group; the window reads the same place under the same key.
  const first = useQuery({
    queryKey: queryKeys.curation.crowdingPlace(membershipId),
    queryFn: () => fetchCrowdingPlace(membershipId),
    retry: false,
  });
  // Read off the card's place alone, so a compared place opened later, in another region,
  // keeps the window on the card's group; a read again after an Apply keeps the data it had.
  const groupRef = first.data?.group;

  const shell = (title: ReactNode, content: ReactNode, actions: ReactNode = null, applying = false) => (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      fullScreen={narrow}
      // A click beside the window or a stray Escape must not throw away answers
      // not yet applied: with any staged, only the close button closes it.
      onClose={() => { if (staging.size === 0 && !applying) close(); }}
      aria-labelledby="crowding-window-title"
    >
      <DialogTitle component="div" sx={{ pr: 7 }}>
        {title}
        {/* Not while an Apply runs: the opener refreshes the queue from what the window reports on close. */}
        <IconButton aria-label="Close the window" onClick={close} disabled={applying} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {content}
      {actions}
    </Dialog>
  );

  if (!groupRef) {
    return shell(
      <span id="crowding-window-title">A crowded city</span>,
      <DialogContent dividers>
        {first.isError
          ? <Alert severity="error">Could not read the place{first.error instanceof Error ? `: ${first.error.message}` : '.'}</Alert>
          : <LoadingSpinner padding={4} />}
      </DialogContent>,
    );
  }

  return (
    <CrowdingWindow
      group={groupRef}
      selected={selected}
      onSelect={setSelected}
      titleId="crowding-window-title"
      staging={staging}
      onStaging={setStaging}
      onApplied={lines => setAppliedLines(before => [...before, ...lines])}
      layout="dialog"
      frame={({ heading, body, outcome, actions, applying }) => shell(
        heading,
        <DialogContent dividers sx={{ p: 0 }}>{body}</DialogContent>,
        <>
          {outcome}
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, py: 1.5 }}>{actions}</DialogActions>
        </>,
        applying,
      )}
    />
  );
}
