/**
 * Copies a point's full name, in one action, from its row (#1268).
 *
 * A component's own name means nothing once it leaves the card — "See" pasted
 * into a search box finds nothing — so what is copied is the full name,
 * object and reference included (`pointFullName`). The button says it copied
 * for a moment rather than opening anything, and it is named for the place, so
 * a list of thirty is a list a screen reader can use.
 */

import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { ContentCopy as CopyIcon, Check as CopiedIcon, ErrorOutline as FailedIcon } from '@mui/icons-material';

const COPIED_MS = 1500;

export function CopyNameButton({ fullName, className }: { fullName: string; className?: string }) {
  const [outcome, setOutcome] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = (event: React.MouseEvent) => {
    // The row underneath opens and hovers; copying its name does neither.
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
    navigator.clipboard.writeText(fullName).then(() => show('copied'), () => show('failed'));
  };

  let title = `Copy “${fullName}”`;
  let icon = <CopyIcon fontSize="small" />;
  if (outcome === 'copied') {
    title = 'Copied';
    icon = <CopiedIcon fontSize="small" />;
  } else if (outcome === 'failed') {
    title = 'Could not copy — the browser refused';
    icon = <FailedIcon fontSize="small" color="error" />;
  }

  return (
    <Tooltip title={title}>
      <IconButton size="small" className={className} aria-label={`Copy the name ${fullName}`} onClick={copy}>
        {icon}
      </IconButton>
    </Tooltip>
  );
}
