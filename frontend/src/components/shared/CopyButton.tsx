/**
 * Copies one piece of text in one action, and says so (#1268, #1190).
 *
 * The catalogue's copy control: a point's full name from its row, the id a
 * source knows an object by (`SourceId`), and whatever a card offers to take
 * elsewhere next. What it copies is the caller's (`text`), and it is named for
 * that text (`label`), so a list of thirty is a list a screen reader can use.
 *
 * It answers on the button — a tick for a moment, or a warning when the browser
 * refused — and in a polite live region, since a tooltip that changes under a
 * focused button is not announced. A refusal sends the reader to the text
 * itself, which every caller leaves selectable.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import CopyIcon from '@mui/icons-material/ContentCopy';
import CopiedIcon from '@mui/icons-material/Check';
import FailedIcon from '@mui/icons-material/ErrorOutline';

const COPIED_MS = 1500;
export const COPIED_TEXT = 'Copied';
export const COPY_FAILED_TEXT = 'Could not copy — select the text instead';

/** Present to a screen reader and to nobody else, as MUI's own `visuallyHidden` is. */
const SPOKEN_ONLY = {
  border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden',
  padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px',
} as const;

export function CopyButton({ text, label, tooltip, compact = false, className }: {
  text: string;
  /** The button's accessible name: what is copied, in words ("Copy the name …"). */
  label: string;
  /** What the tooltip says before anything was copied; the label when absent. */
  tooltip?: string;
  /** The 12 px icon a caption-sized row asks for. */
  compact?: boolean;
  className?: string;
}) {
  const [outcome, setOutcome] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = (event: React.MouseEvent) => {
    // The row underneath opens and hovers; copying from it does neither.
    event.stopPropagation();
    const show = (next: 'copied' | 'failed') => {
      setOutcome(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOutcome(null), COPIED_MS);
    };
    // A page served without a secure context, or a browser that refuses, has no
    // clipboard to write to: the button says so rather than looking as if it had.
    if (!navigator.clipboard) {
      show('failed');
      return;
    }
    navigator.clipboard.writeText(text).then(() => show('copied'), () => show('failed'));
  };

  const iconSx = compact ? { fontSize: 12 } : undefined;
  let title = tooltip ?? label;
  let icon = <CopyIcon fontSize="small" sx={iconSx} />;
  if (outcome === 'copied') {
    title = COPIED_TEXT;
    icon = <CopiedIcon fontSize="small" sx={iconSx} />;
  } else if (outcome === 'failed') {
    title = COPY_FAILED_TEXT;
    icon = <FailedIcon fontSize="small" color="error" sx={iconSx} />;
  }

  return (
    <>
      <Tooltip title={title} describeChild>
        <IconButton size="small" className={className} aria-label={label} onClick={copy}
          sx={compact ? { p: 0.25 } : undefined}>
          {icon}
        </IconButton>
      </Tooltip>
      <Box component="span" role="status" sx={SPOKEN_ONLY}>
        {outcome === 'copied' && COPIED_TEXT}
        {outcome === 'failed' && COPY_FAILED_TEXT}
      </Box>
    </>
  );
}

/** A point's full name (`pointFullName`), copied from its row (#1268). */
export function CopyNameButton({ fullName, className }: { fullName: string; className?: string }) {
  return <CopyButton text={fullName} label={`Copy the name ${fullName}`} tooltip={`Copy “${fullName}”`} className={className} />;
}
