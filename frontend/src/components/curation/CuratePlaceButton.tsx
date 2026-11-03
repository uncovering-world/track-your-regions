/**
 * A place a review card names, opened in its curation dialog (#2293): the
 * same dialog Map mode and Discover open, for a published place and a waiting
 * arrival alike.
 *
 * A curator reading a card often sees what is wrong with the place itself, a
 * picture that is a collage of the town rather than the Tree of Sadness in
 * Beslan, and the card's own answers are about the question it asks. So the
 * place opens from the card. The dialog edits the place as it does from the
 * map: through the same endpoint, claimed from runs and written to the
 * curation log, and it answers none of the card's questions by being opened.
 * An edit that sets a field a held proposal asks about answers that proposal
 * on the server (`settleHeldByEdit`).
 *
 * The place is read by its id (`fetchExperience`), which answers a curator
 * for a place readers do not see yet, so a card can open any place it names:
 * its own, the whole a part belongs to, the other place of a near pair. No
 * region is open on the review page, so the dialog offers no region's
 * reject. Once it closes, the queue is read again, so the card shows the
 * place as it now stands and drops a question the edit settled.
 */

import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchExperience } from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';
import { LazyCurationDialog } from '../shared/lazyCurationDialogs';

export function CuratePlaceButton({ placeId, name }: {
  placeId: number;
  /**
   * The place's name, for a card that names more than the place it asks about:
   * the button is then called by it. The card's own place leaves it out, and its
   * button is the card's *Curate*.
   */
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // The dialog's own read of the place, under its key, so the two are one.
  const place = useQuery({
    queryKey: queryKeys.experience.one(placeId),
    queryFn: () => fetchExperience(placeId),
    enabled: open,
    staleTime: 300_000,
  });
  const close = () => {
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
  };
  const opening = open && place.isPending;
  return (
    <>
      <Button
        size="small"
        variant="text"
        aria-label={name ? `Curate ${name}` : undefined}
        // The card a button sits on may itself answer a click.
        onClick={(event) => {
          event.stopPropagation();
          if (place.isError) place.refetch().catch(() => undefined);
          setOpen(true);
        }}
        disabled={opening}
        startIcon={opening ? <CircularProgress size={12} /> : undefined}
        sx={{ minWidth: 0, py: 0 }}
      >
        {open && place.isError ? 'Could not open it — try again' : 'Curate'}
      </Button>
      <LazyCurationDialog
        experience={open && place.data ? place.data : null}
        regionId={null}
        curatesRegion={false}
        onClose={close}
      />
    </>
  );
}
