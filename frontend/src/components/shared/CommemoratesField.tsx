/**
 * Whom or what a place commemorates, as a curator corrects it (#2144): the
 * subjects the card names, each a chip that can be removed, and a field that
 * finds a person or an event on Wikidata by name and adds it.
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
import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
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

function noOptionsText(query: string, failed: boolean): string {
  if (query.length < MIN_QUERY) return 'Type a name';
  return failed ? 'Wikidata did not answer; try again' : 'Nobody found by that name';
}

export function CommemoratesField({ subjects, onChange, error, disabled = false }: {
  subjects: readonly CommemoratedSubjectValue[];
  onChange: (subjects: CommemoratedSubjectValue[]) => void;
  /** The server's refusal of the list, shown under the search field. */
  error?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const query = useDebouncedValue(input.trim(), SEARCH_DELAY_MS);
  const search = useQuery({
    queryKey: queryKeys.curation.commemorationSearch(query),
    queryFn: () => searchCommemorationSubjects(query),
    enabled: query.length >= MIN_QUERY,
    staleTime: 300_000,
  });
  const listed = new Set(subjects.map(subject => subject.item));
  // A subject already listed is not offered again: the list names each once.
  const options = query.length >= MIN_QUERY ? (search.data ?? []).filter(candidate => !listed.has(candidate.item)) : [];

  const add = (candidate: CommemorationCandidate | null) => {
    if (!candidate || listed.has(candidate.item)) return;
    onChange([...subjects, { item: candidate.item, label: candidate.label, articleUrl: candidate.articleUrl }]);
    setInput('');
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>Commemorates</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {subjects.length === 0 ? (
          <Typography variant="caption" color="text.secondary">Nobody named</Typography>
        ) : subjects.map(subject => (
          <Chip
            key={subject.item}
            label={subject.label}
            title={subject.item}
            size="small"
            variant="outlined"
            disabled={disabled}
            onDelete={() => onChange(subjects.filter(other => other.item !== subject.item))}
            deleteIcon={<CancelIcon titleAccess={`Remove ${subject.label}`} />}
          />
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
            label="Add a person or event"
            error={!!error}
            helperText={error ?? 'Found on Wikidata by name'}
          />
        )}
      />
    </Box>
  );
}
