/**
 * The id the source knows this object by, made into something a curator can use.
 *
 * It was `(Q637248)` in grey — not a link, not selectable as a unit, never explained. A
 * curator's honest reaction is "what am I supposed to do with that", and the honest answer
 * used to be *nothing*: the page it belongs to is already linked two lines below, so the
 * number carried no information the card did not already have.
 *
 * It earns its place as the thing you *quote*. Reporting a bad rule, filing an issue about
 * one row, asking someone else to look — all of them need the identifier, and typing
 * `Q637248` off a screen is how it gets typed wrong. One click copies it.
 */

import { useState } from 'react';
import { Tooltip, Typography } from '@mui/material';

export function SourceId({ id, category }: { id: string; category: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused — an insecure origin, a denied permission. The id
      // stays selectable by hand, so the failure costs the shortcut and not the number.
      setCopied(false);
    }
  };

  return (
    <Tooltip
      title={copied
        ? 'Copied'
        : `How ${category} knows this object. Click to copy — quote it when reporting a row.`}
    >
      <Typography
        component="button"
        type="button"
        variant="caption"
        color="text.secondary"
        onClick={copy}
        sx={{
          border: 0,
          background: 'none',
          p: 0,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: '0.75rem',
          textDecoration: 'underline dotted',
        }}
      >
        {id}
      </Typography>
    </Tooltip>
  );
}
