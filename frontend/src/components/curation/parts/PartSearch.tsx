/**
 * The search a curator adds a part with, or the whole a place is a part of
 * (#2118). Empty, it offers the places nearest the whole's parts — or the
 * place itself while it has none, the three works near the Brâncuși ensemble
 * — and, for a whole, the wholes near the place; typed, the places so named,
 * nearest first. Each says how near it stands and whether it waits for a
 * curator. One that cannot be chosen says why, and one far from every part
 * asks the curator to check it is the place meant.
 */

import { useState } from 'react';
import { Alert, Box, Button, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { findPartCandidates, type PartCandidate } from '../../../api/parts';
import { queryKeys } from '../../../api/queryKeys';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { DenseThumbnail } from '../../shared/DenseThumbnail';
import { FAR_M, nearLine, placeLine, takenLine } from './partWords';

function Candidate({ candidate, role, selfName, pending, onChoose }: {
  candidate: PartCandidate;
  role: 'part' | 'whole';
  selfName: string;
  pending: boolean;
  onChoose: (candidate: PartCandidate) => void;
}) {
  const taken = takenLine(candidate, role, selfName);
  const refused = candidate.taken === 'self' || candidate.taken === 'loop' || candidate.taken === 'scope';
  const far = candidate.distance_m !== null && candidate.distance_m > FAR_M;
  const near = nearLine(candidate, role);
  return (
    <Box sx={{ py: 1, borderTop: 1, borderColor: 'divider', opacity: candidate.taken ? 0.7 : 1 }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <DenseThumbnail imageUrl={candidate.place.image_url} title={candidate.place.name} credit={candidate.place.image_credit} reserve />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{candidate.place.name}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">{placeLine(candidate.place)}</Typography>
          {near && <Typography variant="caption" color="text.secondary" display="block">{near}</Typography>}
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', '&:empty': { display: 'none' } }}>
            {candidate.place.waiting && <Chip size="small" variant="outlined" color="warning" label="Waiting for a curator" />}
            {candidate.taken === 'already' && <Chip size="small" variant="outlined" label={taken} />}
            {candidate.kept_out && <Chip size="small" variant="outlined" label="Kept out by a curator" />}
            {candidate.also_part_of && (
              <Chip size="small" variant="outlined" label={`Also part of ${candidate.also_part_of}`} />
            )}
          </Stack>
          {refused && <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>{taken}</Typography>}
          {!candidate.taken && far && (
            <Alert severity="warning" sx={{ py: 0, mt: 0.5 }}>
              {candidate.near_name ? 'Far from every part.' : 'Far from this place.'} Check it is the place you mean.
            </Alert>
          )}
        </Box>
        {!candidate.taken && (
          <Button size="small" variant="outlined" disabled={pending} onClick={() => onChoose(candidate)} sx={{ flexShrink: 0 }}>
            {candidate.kept_out ? 'Put it back' : 'Add'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export function PartSearch({ experienceId, selfName, role, pending, onChoose }: {
  experienceId: number;
  /** The place the card is about, as a refusal names it. */
  selfName: string;
  /** `part`: places to add as its parts; `whole`: wholes to add it to. */
  role: 'part' | 'whole';
  pending: boolean;
  onChoose: (candidate: PartCandidate) => void;
}) {
  const [q, setQ] = useState('');
  const asked = useDebouncedValue(q.trim(), 300);
  const named = asked.length >= 2 ? asked : '';
  const found = useQuery({
    queryKey: queryKeys.curation.partCandidates(experienceId, role, named),
    queryFn: () => findPartCandidates(experienceId, role, named),
  });
  const candidates = found.data?.candidates ?? [];
  const placeholder = role === 'part' ? 'Add a part: find a place by name' : 'Add it to a whole: find the whole by name';
  let heading: string | null = null;
  if (!named && candidates.length > 0) heading = role === 'part' ? 'Near it' : 'Wholes near it';

  return (
    <Box>
      <TextField
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        size="small"
        fullWidth
        inputProps={{ 'aria-label': placeholder, maxLength: 100 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />
      {heading && (
        <Typography variant="overline" color="text.secondary" display="block" sx={{ mt: 1, lineHeight: 1.5 }}>{heading}</Typography>
      )}
      {named && found.isSuccess && candidates.length === 0 && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          No place in the catalogue is called “{named}”. Check the spelling, or try its local name.
        </Typography>
      )}
      {found.isError && <Alert severity="error" sx={{ py: 0, mt: 1 }}>The search failed. Try again in a moment.</Alert>}
      {candidates.map(candidate => (
        <Candidate
          key={candidate.place.id}
          candidate={candidate}
          role={role}
          selfName={selfName}
          pending={pending}
          onChoose={onChoose}
        />
      ))}
    </Box>
  );
}
