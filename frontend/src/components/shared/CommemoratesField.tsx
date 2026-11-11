/**
 * Whom or what a place commemorates, as a curator corrects it (#2144), and the
 * figures a work depicts, corrected the same way (#2421): the subjects the
 * card's line names, each a chip that can be removed, and a field that finds a
 * person, an event or a figure on Wikidata by name and adds it. Where the
 * dialog shows both lines, each chip can also be moved to the other line:
 * Garuda read as whom a statue commemorates is what it depicts.
 *
 * India Gate's statement names World War I and also one person a traveller
 * would not know as its subject; the curator removes her chip, and the card
 * names the war alone. A monument whose subject no step of the reading found
 * gets one added by name. The list is the field's value, held by the dialog's
 * form (`useEditForm`), which sends it whole; an empty list is a value too,
 * the curator's word that the place commemorates nobody.
 *
 * Each option shows the item's description under its label, so two people of
 * one name are told apart before one is picked. Wikidata is asked through the
 * product's own endpoint once the curator pauses typing, never from the
 * browser.
 */

import { useState } from 'react';
import { Autocomplete, Box, Chip, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { useQuery } from '@tanstack/react-query';
import {
  searchCommemorationSubjects,
  type CommemorationCandidate,
  type EditExperienceBodyCommemoratesItem,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/** One subject as the edit sends it: its Wikidata item, its label and its English article. */
export type CommemoratedSubjectValue = EditExperienceBodyCommemoratesItem;

/** The shortest name the endpoint searches for. */
const MIN_QUERY = 2;
/** How long the field waits after the last keystroke before it asks. */
const SEARCH_DELAY_MS = 300;

/** The two lines a card can carry, and each one's words. */
export type SubjectLine = 'commemorates' | 'depicts';

const LINE_WORDS: Record<SubjectLine, { heading: string; none: string; add: string }> = {
  commemorates: { heading: 'Commemorates', none: 'Nobody named', add: 'Add a person or event' },
  depicts: { heading: 'Depicts', none: 'No figure named', add: 'Add a figure' },
};

function noOptionsText(query: string, failed: boolean): string {
  if (query.length < MIN_QUERY) return 'Type a name';
  return failed ? 'Wikidata did not answer; try again' : 'Nobody found by that name';
}

export function CommemoratesField({ line = 'commemorates', subjects, elsewhere = [], onChange, onMove, error, disabled = false }: {
  /** Which of the card's lines the field corrects. */
  line?: SubjectLine;
  subjects: readonly CommemoratedSubjectValue[];
  /** The subjects on the other line, which this one never offers: a subject stands on one line. */
  elsewhere?: readonly CommemoratedSubjectValue[];
  onChange: (subjects: CommemoratedSubjectValue[]) => void;
  /** Where the dialog shows the other line too: the subject moved there, out of this list. */
  onMove?: (subject: CommemoratedSubjectValue) => void;
  /** The server's refusal of the list, shown under the search field. */
  error?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const words = LINE_WORDS[line];
  const other = LINE_WORDS[line === 'commemorates' ? 'depicts' : 'commemorates'].heading;
  const query = useDebouncedValue(input.trim(), SEARCH_DELAY_MS);
  const search = useQuery({
    queryKey: queryKeys.curation.commemorationSearch(query),
    queryFn: () => searchCommemorationSubjects(query),
    enabled: query.length >= MIN_QUERY,
    staleTime: 300_000,
  });
  const listed = new Set([...subjects, ...elsewhere].map(subject => subject.item));
  // A subject already listed, here or on the other line, is not offered again: the card names each once.
  const options = query.length >= MIN_QUERY ? (search.data ?? []).filter(candidate => !listed.has(candidate.item)) : [];

  const add = (candidate: CommemorationCandidate | null) => {
    if (!candidate || listed.has(candidate.item)) return;
    onChange([...subjects, { item: candidate.item, label: candidate.label, articleUrl: candidate.articleUrl }]);
    setInput('');
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{words.heading}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {subjects.length === 0 ? (
          <Typography variant="caption" color="text.secondary">{words.none}</Typography>
        ) : subjects.map(subject => (
          <Box key={subject.item} sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Chip
              label={subject.label}
              title={subject.item}
              size="small"
              variant="outlined"
              disabled={disabled}
              onDelete={() => onChange(subjects.filter(kept => kept.item !== subject.item))}
              deleteIcon={<CancelIcon titleAccess={`Remove ${subject.label}`} />}
            />
            {onMove && (
              <Tooltip title={`Move to ${other}`}>
                <IconButton size="small" disabled={disabled} aria-label={`Move ${subject.label} to ${other}`} onClick={() => onMove(subject)}>
                  <SwapVertIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ))}
      </Box>
      <Autocomplete<CommemorationCandidate>
        options={options}
        value={null}
        inputValue={input}
        onInputChange={(_event, value, reason) => setInput(reason === 'reset' ? '' : value)}
        onChange={(_event, candidate) => add(candidate)}
        // The endpoint has already searched; the field filters nothing out itself.
        filterOptions={candidates => candidates}
        getOptionLabel={candidate => candidate.label}
        isOptionEqualToValue={(candidate, other) => candidate.item === other.item}
        loading={search.isFetching}
        noOptionsText={noOptionsText(query, search.isError)}
        disabled={disabled}
        size="small"
        fullWidth
        renderOption={(props, candidate) => (
          <li {...props} key={candidate.item}>
            <Box>
              <Typography variant="body2">{candidate.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {candidate.description ? `${candidate.description} · ${candidate.item}` : candidate.item}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={params => (
          <TextField
            {...params}
            label={words.add}
            error={!!error}
            helperText={error ?? 'Found on Wikidata by name'}
          />
        )}
      />
    </Box>
  );
}
