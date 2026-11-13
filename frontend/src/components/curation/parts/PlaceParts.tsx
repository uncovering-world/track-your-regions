/**
 * The curator's *Parts* and *Part of* sections on a place's card (#2118), the
 * maintainer's accepted mock of 2026-11-13: on the card itself, in Map mode
 * and in Discover.
 *
 * *Parts*, on a place made of parts, lists its parts, each with whose word
 * makes it one, and adds a part at once, with Undo; *Part of*, on a part,
 * lists the wholes it counts toward and adds it to another. Taking one out
 * asks first (`PartRow`). An empty World Heritage site is offered the places
 * near it (the Brâncuși ensemble and its three works). The first part of a
 * place in a kind of its own makes it a place made of parts, never merged and
 * found by no item, so the card says so before the search, and the add says
 * it knew (`makesWhole`). Every word is a record of the Curators source that
 * no run undoes (`partRecordController.ts`).
 */

import { useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../api/fetchUtils';
import {
  addPart, fetchPlaceParts, takeOutPart, type PartCandidate, type PartRow as Row, type PartWordAnswered,
} from '../../../api/parts';
import { queryKeys } from '../../../api/queryKeys';
import { plural } from '../../../utils/plural';
import { invalidateExperiences } from '../../../utils/queryInvalidation';
import { PartFailure, PartRow } from './PartRow';
import { PartSearch } from './PartSearch';

/** One word on a pair: the whole, the place, and what the curator was told. */
interface Word { wholeId: number; partId: number; partName: string; note?: string; makesWhole?: boolean }

/** How many standing parts a card shows before *Show N more parts*: Wudang's site has 45. */
const FIRST_PARTS = 5;

/** What the snackbar says, and the act its Undo takes. */
interface Said { message: string; undo?: Word & { act: 'add' | 'take-out' } }

function useParts(experienceId: number) {
  return useQuery({
    queryKey: queryKeys.curation.placeParts(experienceId),
    queryFn: () => fetchPlaceParts(experienceId),
    // Read afresh on every opening: a run or another curator may have moved a part.
    staleTime: 0,
  });
}

/** The heading and line over a section's box. */
function SectionHead({ title, caption }: { title: string; caption: string }) {
  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{caption}</Typography>
    </>
  );
}

/** The warning a place in a kind of its own carries before its first part. */
function FirstPartNote({ name }: { name: string }) {
  return (
    <Alert severity="warning" sx={{ py: 0, mb: 1 }}>
      Its first part makes {name} a place made of parts. Visitors then tick its parts, and it is never merged with
      another place. A run of another kind that lists its Wikidata item brings that place again for review.
    </Alert>
  );
}

export function PlaceParts({ experienceId, regionId, isSite }: {
  experienceId: number;
  regionId: number | null;
  /** The place stands in World Heritage Sites: with no part yet, it is offered the places near it at once. */
  isSite: boolean;
}) {
  const queryClient = useQueryClient();
  const parts = useParts(experienceId);
  const [said, setSaid] = useState<Said | null>(null);
  const [opened, setOpened] = useState<'whole' | 'part' | null>(null);
  const [needsWhole, setNeedsWhole] = useState<Word | null>(null);
  const [allParts, setAllParts] = useState(false);

  // A word moves two cards: this place's and the other end's, whose "Part of"
  // line or list of places changes with it.
  const settled = ({ wholeId, partId }: Word) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.placePartsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.partCandidatesAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
    invalidateExperiences(queryClient, { regionId, experienceId });
    const other = wholeId === experienceId ? partId : wholeId;
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.one(other) });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.locations(other) });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.contents(other) });
  };
  const word = useMutation({
    mutationFn: ({ act, ...w }: Word & { act: 'add' | 'take-out' }): Promise<PartWordAnswered> => act === 'add'
      ? addPart(w.wholeId, { partId: w.partId, note: w.note || undefined, makesWhole: w.makesWhole })
      : takeOutPart(w.wholeId, { partId: w.partId, note: w.note || undefined }),
    onSuccess: (answer, { act, ...w }) => {
      settled(w);
      setNeedsWhole(null);
      if (act === 'take-out') {
        // Undone, the place had the part: its first part asks nothing again.
        setSaid({ message: `${w.partName} taken out.`, undo: { ...w, note: undefined, makesWhole: true, act: 'add' } });
      } else {
        const message = answer.act === 'put_back' ? `${w.partName} put back.` : `${w.partName} added as a part.`;
        setSaid({ message, undo: { ...w, note: undefined, act: 'take-out' } });
      }
    },
    onError: (error, { act, ...w }) => {
      // A whole found by name may stand in a kind of its own: say what its first part does, then ask
      // again. Any other refusal replaces that question, so its button is never left on a new one.
      setNeedsWhole(act === 'add' && error instanceof ApiError && error.code === 'makes-whole' ? w : null);
    },
  });
  const data = parts.data;
  if (!data) return null;
  const say = (w: Word, act: 'add' | 'take-out') => { setSaid(null); word.mutate({ ...w, act }); };
  const standing = data.parts.filter(row => row.standing);
  const shownParts = allParts ? standing : standing.slice(0, FIRST_PARTS);
  const hiddenParts = standing.length - shownParts.length;
  const isWhole = data.parts.length > 0;
  const firstPartAsks = standing.length === 0 && data.in_kind;
  const addPartOf = (c: PartCandidate) =>
    say({ wholeId: experienceId, partId: c.place.id, partName: c.place.name, makesWhole: firstPartAsks || undefined }, 'add');
  const addToWhole = (c: PartCandidate) => say({ wholeId: c.place.id, partId: experienceId, partName: data.name }, 'add');
  const rowsOf = (rows: Row[], side: 'parts' | 'wholes') => rows.map(row => {
    const pair = side === 'parts'
      ? { wholeId: experienceId, partId: row.place.id, partName: row.place.name }
      : { wholeId: row.place.id, partId: experienceId, partName: data.name };
    return (
      <PartRow
        key={`${side}-${row.place.id}`}
        row={row}
        side={side}
        wholeName={side === 'parts' ? data.name : row.place.name}
        pending={word.isPending}
        onTakeOut={note => say({ ...pair, note }, 'take-out')}
        onPutBack={() => say(pair, 'add')}
      />
    );
  });
  const partsSearch = (
    <Box sx={{ p: 1.25 }}>
      {data.merged_onto && standing.length === 0 ? (
        <Alert severity="info" sx={{ py: 0 }}>
          Another place was merged into {data.name}. A place made of parts is never merged, so undo that merge from its
          history first.
        </Alert>
      ) : (
        <>
          {firstPartAsks && <FirstPartNote name={data.name} />}
          <PartSearch experienceId={experienceId} selfName={data.name} role="part" pending={word.isPending} onChoose={addPartOf} />
        </>
      )}
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      {(isWhole || isSite) && (
        <Box sx={{ mb: 2 }}>
          <SectionHead
            title={standing.length > 0 ? `Parts (${standing.length})` : 'Parts'}
            caption={standing.length > 0 ? 'The places a traveller visits for it. A visit to any of them counts here.'
              : 'No parts yet. Visitors see it as one place with one pin.'}
          />
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {rowsOf(shownParts, 'parts')}
            {hiddenParts > 0 && (
              <Box sx={{ px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                <Button size="small" onClick={() => setAllParts(true)}>Show {plural(hiddenParts, 'more part')}</Button>
              </Box>
            )}
            {rowsOf(data.parts.filter(row => !row.standing), 'parts')}
            <Box sx={{ borderTop: data.parts.length > 0 ? 1 : 0, borderColor: 'divider' }}>{partsSearch}</Box>
          </Box>
        </Box>
      )}
      <SectionHead title="Part of" caption="The wholes a visit here counts toward." />
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {rowsOf(data.wholes, 'wholes')}
        <Box sx={{ p: 1.25, borderTop: data.wholes.length > 0 ? 1 : 0, borderColor: 'divider' }}>
          {opened === 'whole'
            ? <PartSearch experienceId={experienceId} selfName={data.name} role="whole" pending={word.isPending} onChoose={addToWhole} />
            : <Button size="small" onClick={() => setOpened('whole')}>Add it to a whole…</Button>}
        </Box>
        {!isWhole && !isSite && (
          <Box sx={{ p: 1.25, borderTop: 1, borderColor: 'divider' }}>
            {opened === 'part' ? partsSearch : <Button size="small" onClick={() => setOpened('part')}>Add a part to it…</Button>}
          </Box>
        )}
      </Box>
      {needsWhole && (
        <Alert
          severity="warning"
          sx={{ py: 0, mt: 1 }}
          action={(
            <Button size="small" color="inherit" disabled={word.isPending} onClick={() => say({ ...needsWhole, makesWhole: true }, 'add')}>
              Add all the same
            </Button>
          )}
        >
          {(word.error as Error | null)?.message}
        </Alert>
      )}
      {!needsWhole && <PartFailure error={word.error} />}
      <Snackbar
        open={said !== null}
        autoHideDuration={8000}
        onClose={(_, reason) => { if (reason !== 'clickaway') setSaid(null); }}
        message={said?.message}
        action={(
          <>
            {said?.undo && (
              <Button size="small" color="inherit" disabled={word.isPending} onClick={() => said.undo && say(said.undo, said.undo.act)}>
                Undo
              </Button>
            )}
            <IconButton size="small" color="inherit" aria-label="Close" onClick={() => setSaid(null)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        )}
      />
    </Box>
  );
}
