/**
 * A year as a person writes one: a number, and which side of zero it falls on.
 *
 * `treasures.year` is a signed integer, and asking a curator to type "-38000"
 * for the Lion man of the Hohlenstein Stadel is asking them to type the storage
 * shape. Nine works in the catalogue are older than 4000 BC and 76 are BC at
 * all, so the era is not a decoration on this field — it is how a fifth of the
 * antiquities in it can be entered correctly at all.
 *
 * A toggle rather than a select: there are two answers, and a two-option select
 * is a click to see what a pair of buttons already shows. The value is emitted
 * signed, so nothing downstream has to know this control exists — the row the
 * curator is correcting is read back through `yearLabel`, the same rule that
 * prints it everywhere else.
 *
 * Empty means no date, which is a value a curator can mean: a date withdrawn is
 * an answer, and the endpoint takes `null` for it.
 *
 * Its own component because the work's year is, today, the only date anyone
 * enters anywhere in the product — so there is nothing yet to be consistent
 * with, and the next date field should have this to reuse rather than invent a
 * second spelling of the same question.
 */

import { useState } from 'react';
import { InputAdornment, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';

export function YearField({ value, onChange, label = 'Year', helperText, error }: {
  /** The stored year, signed. `null` for a work with no date. */
  value: number | null;
  onChange: (year: number | null) => void;
  label?: string;
  helperText?: string;
  /** Whether the caller's own rule refuses this value — the bound is theirs, not this field's. */
  error?: boolean;
}) {
  // **The era is state, not the sign of the value.** Derived from the sign it
  // vanished the moment the box was emptied — `onChange(null)` has no sign to
  // read — so the ordinary way of correcting a date, backspace and retype, put
  // the new digits on the other side of zero: 100 BC cleared and refilled as
  // 150 became AD 150, three hundred years out, and the save claimed the column
  // against the source. Overtyping a selection keeps the era, which is what
  // makes it easy to miss. That is the very confusion this control exists to
  // prevent (`yearLabel`: "statue · 200 beside statue · 200 BC").
  const [bc, setBc] = useState(value !== null && value < 0);
  // Except when the value itself disagrees, which means it came from outside —
  // a caller reconciling a different work into this instance. The toggle can
  // never trip this: it sets the era and emits a value re-signed to match, so
  // the two agree by the next render.
  if (value !== null && (value < 0) !== bc) setBc(value < 0);

  // The digits only. A curator switching era must not see the minus sign they
  // never typed, and `Math.abs` is what keeps the two controls describing one
  // number between them.
  const digits = value === null ? '' : String(Math.abs(value));

  const setDigits = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (cleaned === '') { onChange(null); return; }
    const magnitude = Number(cleaned);
    onChange(bc ? -magnitude : magnitude);
  };

  const setEra = (era: 'AD' | 'BC' | null) => {
    // Null arrives when the pressed button is pressed again; an era is not
    // something a work can have none of, so the current one stands.
    if (era === null) return;
    setBc(era === 'BC');
    // Nothing to re-sign on an empty box — the era is remembered for whatever
    // is typed next, which is the point of holding it.
    if (value !== null) onChange(era === 'BC' ? -Math.abs(value) : Math.abs(value));
  };

  return (
    <TextField
      label={label}
      value={digits}
      onChange={(e) => setDigits(e.target.value)}
      size="small"
      fullWidth
      error={error}
      helperText={helperText}
      slotProps={{
        htmlInput: { inputMode: 'numeric', maxLength: 6, 'aria-label': label },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <ToggleButtonGroup
                size="small"
                exclusive
                value={bc ? 'BC' : 'AD'}
                onChange={(_, era) => setEra(era as 'AD' | 'BC' | null)}
                aria-label="Era"
                // Live with an empty box too, now that the era is remembered:
                // a curator can say BC first and then type, and one who emptied
                // the field to retype it still sees which side they are on.
                sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.25, fontSize: 12 } }}
              >
                <ToggleButton value="AD" aria-label="AD">AD</ToggleButton>
                <ToggleButton value="BC" aria-label="BC">BC</ToggleButton>
              </ToggleButtonGroup>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
