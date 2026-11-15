import { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useVisitedExperiences } from '../../hooks/useVisitedExperiences';
import { placesNamed } from './visitWords';
import { declineAsk, revealPlaces, stopAsking, useAsking } from './wholeAsk';

interface WholeVisitAskProps {
  experienceId: number;
  /** Drawn under a row of Map mode's list, indented as the date line is; Discover's panel holds its own margins. */
  inset?: boolean;
}

/**
 * The line after "Visited, not sure which part" (#2121, ADR-0206): "Which
 * places were you at?", with "Mark them in the list", which brings the
 * card's own list of places into view as the picker, and "I don't remember",
 * which leaves the whole at "? of N" and does not ask again in this session.
 * Never a dialog and never a second list. Shown while the whole stays ticked
 * and no place of it is named: naming one turns "? of 34" into "1 of 34", and
 * the question has its answer.
 */
export function WholeVisitAsk({ experienceId, inset = false }: WholeVisitAskProps) {
  return useAsking(experienceId) && <AskLine experienceId={experienceId} inset={inset} />;
}

function AskLine({ experienceId, inset }: Required<WholeVisitAskProps>) {
  const { isWholeTicked, progressOf } = useVisitedExperiences();
  // A place named is the answer: the question goes, and taking that place
  // back later does not bring it back.
  const named = placesNamed(progressOf(experienceId));
  useEffect(() => { if (named) stopAsking(experienceId); }, [named, experienceId]);
  if (!isWholeTicked(experienceId) || named) return null;
  return (
    <Box
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, ...(inset ? { px: 2, py: 0.5 } : { mt: 1 }) }}
      onClick={e => e.stopPropagation()}
    >
      <Typography role="status" variant="body2" sx={{ flex: 1 }}>Which places were you at?</Typography>
      <Button size="small" onClick={() => revealPlaces(experienceId)}>Mark them in the list</Button>
      <Button size="small" color="inherit" onClick={() => declineAsk(experienceId)}>I don't remember</Button>
    </Box>
  );
}
