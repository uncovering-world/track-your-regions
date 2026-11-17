/**
 * An act that says why it is taken (#863): a button that opens the reasons
 * its surface offers, where one click on a line is the act itself.
 *
 * The why is what a rule is tuned from, so it is a code a query groups by
 * (`CURATION_REASON_CODES`), offered in the curator's words
 * (`CURATION_REASON_WORDS`). A pop-up list rather than a row of chips beside
 * the button: the card keeps one control per answer, and the list opens only
 * when the curator takes that answer. "Other…" sits last, after a divider,
 * and is the one line that asks for words before it acts; the words are
 * optional, since "other" alone already says no listed reason fits.
 *
 * A menu button as MUI's `Menu` draws it: the arrow keys move between the
 * lines, Enter takes one and Escape closes the list.
 */

import { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, ListSubheader, Menu, MenuItem, TextField,
  type ButtonProps,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { CURATION_REASON_WORDS, type CurationReasonCode } from '@tyr/shared/curationLog';

/** What "Other…" asks for, and the most a note holds, as every act's `note` takes it. */
const OTHER_WORDS_LABEL = 'A few words';
const NOTE_MAX = 1000;

export function ReasonMenu<C extends CurationReasonCode>({
  label, reasons, onChoose, disabled = false, color = 'inherit', variant = 'outlined', size, heading,
}: {
  /** The act, as the button names it; the chevron is drawn beside it. */
  label: string;
  /** The reasons this surface offers, in the order the list shows them; `other` is always the last line. */
  reasons: readonly C[];
  /** The act, taken with the reason picked, and with the curator's words where "Other…" was picked. */
  onChoose: (reasonCode: C | 'other', note?: string) => void;
  disabled?: boolean;
  color?: ButtonProps['color'];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** A line above the reasons saying what they are about, where the button's label does not. */
  heading?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [asking, setAsking] = useState(false);
  const [words, setWords] = useState('');
  const listed = reasons.filter((code): code is Exclude<C, 'other'> => code !== 'other');

  const choose = (code: C) => {
    setAnchor(null);
    onChoose(code);
  };
  const askWords = () => {
    setAnchor(null);
    setWords('');
    setAsking(true);
  };
  const confirmOther = () => {
    setAsking(false);
    onChoose('other', words.trim() || undefined);
  };

  return (
    <>
      <Button
        variant={variant}
        color={color}
        size={size}
        disabled={disabled}
        endIcon={<ArrowDropDownIcon />}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {label}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {heading && <ListSubheader sx={{ lineHeight: 2.5 }}>{heading}</ListSubheader>}
        {listed.map(code => (
          <MenuItem key={code} onClick={() => choose(code)}>{CURATION_REASON_WORDS[code]}</MenuItem>
        ))}
        {listed.length > 0 && <Divider />}
        <MenuItem onClick={askWords}>{CURATION_REASON_WORDS.other}…</MenuItem>
      </Menu>
      <Dialog open={asking} onClose={() => setAsking(false)} fullWidth maxWidth="xs">
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label={OTHER_WORDS_LABEL}
            helperText="Optional, kept in the place's history."
            value={words}
            onChange={(event) => setWords(event.target.value)}
            // An IME confirms its conversion with Enter too; only an Enter outside a composition acts.
            // Safari ends the composition before that keydown, which then carries keyCode 229.
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
              if (event.key === 'Enter' && !composing) confirmOther();
            }}
            slotProps={{ htmlInput: { maxLength: NOTE_MAX } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="contained" color={color === 'inherit' ? 'primary' : color} onClick={confirmOther}>
            {label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
