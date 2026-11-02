/**
 * "Read Wikipedia in": the languages a place's, a part's and a work's
 * Wikipedia link opens in, first choice first (#2209).
 *
 * A link opens the same item's article in the first of these the item has,
 * then the English one the catalogue links. With no list of one's own the
 * browser's languages are read, and they are shown as such, so a reader sees
 * what their links do before changing anything; a change starts from them.
 * A signed-in visitor's list is saved with the account, anyone else's in this
 * browser (`useReadingLanguages`).
 */

import { useState } from 'react';
import { Alert, Box, Button, Chip, FormControl, IconButton, Stack, TextField, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import { MAX_READING_LANGUAGES, READING_LANGUAGE } from '@tyr/shared/preferences';
import { useReadingLanguages } from '../../hooks/useReadingLanguages';
import { languageName } from '../../utils/readingLanguages';

/** A language as the list shows it: *Russian (ru)*. */
function labelOf(code: string): string {
  const name = languageName(code);
  return name === code ? code : `${name} (${code})`;
}

export function ReadingLanguagesSetting({ signedIn }: { signedIn: boolean }) {
  const { chosen, order, setChosen, ready, unread, saving, failed } = useReadingLanguages();
  // Nothing is changed before the account's own list has been read, nor while a change is on its way.
  const locked = saving || !ready;
  const [draft, setDraft] = useState('');
  // What the links read, and what a change starts from: the languages ahead of English.
  const list = order.slice(0, order.indexOf('en'));
  const code = draft.trim().toLowerCase();
  const addable = READING_LANGUAGE.test(code) && code !== 'en' && !list.includes(code) && list.length < MAX_READING_LANGUAGES;

  const change = (next: string[]) => setChosen(next);
  // One save at a time: a second sent while the first is on its way could land before it.
  const add = () => {
    if (!addable || locked) return;
    change([...list, code]);
    setDraft('');
  };

  return (
    <FormControl component="fieldset" disabled={locked} sx={{ width: '100%' }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Read Wikipedia in
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {/* A plain label with its own named buttons beside it: a button inside a deletable
            chip is a control inside a control, which a screen reader may not name. */}
        {list.map((language, index) => (
          <Box key={language} sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Chip label={labelOf(language)} />
            {index > 0 && (
              <IconButton size="small" aria-label={`Read ${labelOf(language)} before ${labelOf(list[index - 1])}`} disabled={locked}
                onClick={() => change([...list.slice(0, index - 1), language, list[index - 1], ...list.slice(index + 1)])}>
                <ArrowUpwardIcon fontSize="inherit" />
              </IconButton>
            )}
            <IconButton size="small" aria-label={`Stop reading ${labelOf(language)}`} disabled={locked}
              onClick={() => change(list.filter(other => other !== language))}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Box>
        ))}
        <Chip label="then English" variant="outlined" />
      </Stack>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1 }}>
        <TextField
          size="small" label="Add a language" placeholder="ru, de, ja" value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          helperText={code && READING_LANGUAGE.test(code) ? labelOf(code) : 'Wikipedia\'s language code'}
          inputProps={{ maxLength: 20, 'aria-label': 'Add a language by its code' }}
        />
        <Button variant="outlined" onClick={add} disabled={!addable || locked} sx={{ mt: 0.25 }}>Add</Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {chosen === null
          ? 'Your browser\'s languages, then English. A link opens the article in the first of them it is written in.'
          : 'A link opens the article in the first of these it is written in, then in English.'}
        {' '}
        {signedIn ? 'Saved with your account, on every device you sign in on.' : 'Kept in this browser.'}
      </Typography>
      {chosen !== null && (
        <Box>
          <Button size="small" onClick={() => setChosen(null)} disabled={locked} sx={{ mt: 0.5, px: 0 }}>Use my browser's languages</Button>
        </Box>
      )}
      {unread && <Alert severity="warning" sx={{ mt: 1 }}>Your languages could not be read, so they cannot be changed now. Reload the page to try again.</Alert>}
      {failed && <Alert severity="error" sx={{ mt: 1 }}>The languages could not be saved. Try again.</Alert>}
    </FormControl>
  );
}
