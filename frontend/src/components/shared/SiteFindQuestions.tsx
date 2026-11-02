import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import {
  answerFindSiteLink, fetchFindSiteLinks, searchFindSiteCandidates, type FindSiteAnswer, type FindSiteCandidate,
} from '../../api/findSiteLinks';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { queryKeys } from '../../api/queryKeys';
import { distanceLabel } from '../../utils/moveDescription';
import { yearLabel } from '../../utils/yearLabel';
import { invalidateFindSiteLink } from '../../utils/queryInvalidation';


/**
 * Where a find comes from, answered in the place's curation dialog
 * (`CurationDialog`, #2242), never on the card a traveller reads: the card
 * lists the finds from this site and nothing more.
 *
 * A run proposes a find whose Wikidata item names no place of discovery for
 * the site its own coordinate stands on: the Dendera zodiac in the Louvre for
 * the Dendera Temple complex, 0 m from its point. A coordinate can also be the
 * scene a painting shows or where a lost original stood, so it is a question,
 * not an answer. The curator reads the find, where it is shown and how far its
 * point lies, and says *Comes from here* or *Not from here*. A link already
 * confirmed is listed under its own heading with *Unlink*, which is a no.
 * *Link a find to this place* searches the works by name for one no run
 * proposed — its item names no find spot, and its point stands elsewhere or
 * it has none — and *Comes from here* links it by hand.
 *
 * Only for a place a find may come from: a World Heritage place or an
 * Archaeology site, never a museum (`mayBeFindOrigin`). With nothing to ask,
 * only the control that links a find by hand is drawn.
 */
export function SiteFindQuestions({ siteId }: { siteId: number }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.experience.findSiteLinks(siteId),
    queryFn: () => fetchFindSiteLinks(siteId),
  });
  const answer = useMutation({
    mutationFn: ({ link, value }: { link: FindSiteCandidate; value: FindSiteAnswer }) =>
      answerFindSiteLink(siteId, link.treasure_id, value),
    onSuccess: (_result, { link }) =>
      invalidateFindSiteLink(queryClient, siteId, link.shown_at.map((venue) => venue.id)),
  });

  const links = data?.links ?? [];
  const proposed = links.filter((link) => link.state === 'proposed');
  const confirmed = links.filter((link) => link.state === 'confirmed');

  const busy = answer.isPending;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Finds from this place</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        The museum objects taken from this place. A find whose own record names no find spot is proposed when its
        point stands here; say whether it comes from here, or link one by hand.
      </Typography>
      {proposed.length > 0 && (
        <QuestionGroup title={`May come from here (${proposed.length})`}>
          {proposed.map((link) => (
            <FindRow key={link.treasure_id} find={link}>
              {link.distance_m !== null && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Its own point is {distanceLabel(link.distance_m)} from this place&apos;s.
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                <Button size="small" variant="outlined" disabled={busy} aria-label={`Comes from here: ${link.name}`}
                  onClick={() => answer.mutate({ link, value: 'confirmed' })}>
                  Comes from here
                </Button>
                <Button size="small" color="inherit" disabled={busy} aria-label={`Not from here: ${link.name}`}
                  onClick={() => answer.mutate({ link, value: 'refused' })}>
                  Not from here
                </Button>
              </Box>
            </FindRow>
          ))}
        </QuestionGroup>
      )}
      {confirmed.length > 0 && (
        <QuestionGroup title={`Linked as from here (${confirmed.length})`}>
          {confirmed.map((link) => (
            <FindRow key={link.treasure_id} find={link}>
              <Button size="small" color="inherit" disabled={busy} sx={{ mt: 0.5 }} aria-label={`Unlink: ${link.name}`}
                onClick={() => answer.mutate({ link, value: 'refused' })}>
                Unlink
              </Button>
            </FindRow>
          ))}
        </QuestionGroup>
      )}
      <LinkByHand siteId={siteId} busy={busy} onLink={(link) => answer.mutate({ link, value: 'confirmed' })} />
      {answer.isError && (
        <Typography variant="caption" color="error" display="block">
          The answer was not saved. Try again.
        </Typography>
      )}
    </Box>
  );
}

function QuestionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
        {title}
      </Typography>
      <Box sx={{ bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * A search over the works by part of a name, for a find no run proposed here,
 * folded behind one control so a curator who is not linking anything sees a
 * single line. Two letters at least; the server's list is the best known first.
 */
function LinkByHand({ siteId, busy, onLink }: {
  siteId: number;
  busy: boolean;
  onLink: (find: FindSiteCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const asked = useDebouncedValue(words.trim(), 300);
  const { data, isFetching, isError } = useQuery({
    queryKey: queryKeys.experience.findSiteCandidates(siteId, asked),
    queryFn: () => searchFindSiteCandidates(siteId, asked),
    enabled: open && asked.length >= 2,
  });

  if (!open) {
    return (
      <Button size="small" color="inherit" onClick={() => setOpen(true)} sx={{ textTransform: 'none' }}>
        Link a find to this place…
      </Button>
    );
  }
  const candidates = asked.length >= 2 ? (data?.candidates ?? []) : [];
  return (
    <Box sx={{ mt: 1 }}>
      <TextField
        size="small"
        fullWidth
        autoFocus
        label="Find, by name"
        value={words}
        onChange={(event) => setWords(event.target.value)}
      />
      {asked.length >= 2 && !isFetching && isError && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
          The search did not answer. Try again.
        </Typography>
      )}
      {asked.length >= 2 && !isFetching && !isError && candidates.length === 0 && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          No find of that name that this place does not hold already.
        </Typography>
      )}
      {candidates.length > 0 && (
        <QuestionGroup title="Found">
          {candidates.map((find) => (
            <FindRow key={find.treasure_id} find={find}>
              <Button size="small" variant="outlined" disabled={busy} sx={{ mt: 0.5 }} aria-label={`Comes from here: ${find.name}`}
                onClick={() => { onLink(find); setWords(''); }}>
                Comes from here
              </Button>
            </FindRow>
          ))}
        </QuestionGroup>
      )}
    </Box>
  );
}

/**
 * One find in the dialog: its name, what it is and when, and the museums that
 * show it, as words. Not the card's row (`FindRow` in `SiteFinds.tsx`): the
 * dialog is a lazy chunk, and a module it shares with the startup chunk is
 * split into a file of its own that every page preloads, so the dialog draws
 * its own row rather than share the card's. No picture, so no credit to hang
 * under one; the museum's card shows the photograph.
 */
function FindRow({ find, children }: {
  find: Pick<FindSiteCandidate, 'name' | 'treasure_type' | 'year' | 'shown_at'>;
  children?: ReactNode;
}) {
  return (
    <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{find.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        {[find.treasure_type, yearLabel(find.year)].filter(Boolean).join(' · ')}
      </Typography>
      {find.shown_at.length > 0 && (
        <Typography variant="caption" color="text.secondary" display="block">
          shown at {find.shown_at.map((venue) => venue.name).join(', ')}
        </Typography>
      )}
      {children}
    </Box>
  );
}

