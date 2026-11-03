/**
 * The crowded-city window as a dialog (#2282), over what it was opened from: a
 * review card, on that card's membership. The window itself is
 * `CrowdingWindow`; this frame lays it out in a wide dialog, full screen on a
 * narrow one, keeps its staged answers while it is open, and hands what the
 * answers did to its opener on close.
 *
 * Its own chunk: the review page loads it when a curator opens it.
 */

import { useState } from 'react';
import {
  Dialog, DialogActions, DialogContent, DialogTitle, IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CrowdingWindow } from './CrowdingWindow';
import type { Staging } from './crowdingStaging';

export function CrowdingWindowDialog({ memberships, groupName, onClose }: {
  /** The places the window stands on in turn: one from a card, a group's arrivals best known first. */
  memberships: readonly number[];
  /** The group's name, where the window steps through one: "Berlin · squares". */
  groupName?: string;
  /** Closed; with what the answers applied did, where any were applied. */
  onClose: (message?: string) => void;
}) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const [staging, setStaging] = useState<Staging>(new Map());
  const [appliedLines, setAppliedLines] = useState<string[]>([]);
  const close = () => onClose(appliedLines.length > 0 ? appliedLines.join(' ') : undefined);

  return (
    <CrowdingWindow
      memberships={memberships}
      groupName={groupName}
      titleId="crowding-window-title"
      staging={staging}
      onStaging={setStaging}
      onApplied={lines => setAppliedLines(before => [...before, ...lines])}
      layout="dialog"
      frame={({ heading, body, outcome, actions, applying }) => (
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
            {heading}
            {/* Not while an Apply runs: the opener refreshes the queue from what the window reports on close. */}
            <IconButton aria-label="Close the window" onClick={close} disabled={applying} sx={{ position: 'absolute', right: 8, top: 8 }}>
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers sx={{ p: 0 }}>{body}</DialogContent>
          {outcome}
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, py: 1.5 }}>{actions}</DialogActions>
        </Dialog>
      )}
    />
  );
}
