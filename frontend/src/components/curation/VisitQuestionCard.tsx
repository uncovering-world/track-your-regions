/**
 * A run asks about a place a kind offers where little says a visitor goes
 * (#1770): fewer than two of the four witnesses vouch for it (ADR-0128), and
 * Jev reads it, sure enough, as a place with nothing to see, not a place, or
 * an object kept elsewhere — Eboracum, Roman York, under a living city; the
 * Venus of Tan-Tan, a stone in a museum. Readers still see it until someone
 * answers.
 *
 * The card says what vouched and what did not, then Jev's reading, then the
 * suggested answer: refuse it from the kind, which a curator's refusal of an
 * arrival is, and which the kept-out list can take back. Keeping it closes the
 * question for good. One section per kind asked about, so a place two kinds
 * offer is one card.
 */

import { useState } from 'react';
import { Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { answerVisitQuestion, type VisitQuestionAnswered } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { formatDateTime } from '../../utils/dateFormat';
import { ItemHeader, messageFor } from './queueCard';
import { readingWords } from './VisitReadingLine';

type OnDone = (message?: string, experienceId?: number) => void;
type VisitQuestion = NonNullable<ReviewQueueItem['visit_question']>;
type Witness = VisitQuestion['witnesses'][number];

/** The four witnesses, in the order a run reads them: as found, and as missing. */
const WITNESS_WORDS: Record<Witness, { found: string; missing: string }> = {
  guide: { found: 'a travel guide lists it', missing: 'no travel guide lists it' },
  photos: { found: 'photographs were taken there', missing: 'too few photographs were taken there' },
  formal: {
    found: 'Wikidata gives a heritage listing, opening hours, a visitor count or a website',
    missing: 'Wikidata gives no heritage listing, opening hours, visitor count or website',
  },
  map: { found: 'the map marks something standing there', missing: 'the map marks nothing standing there' },
};
const WITNESSES = Object.keys(WITNESS_WORDS) as Witness[];

/** What vouched for the place and what did not: a run asks only where fewer than two of the four did. */
export function witnessLines(witnesses: readonly Witness[]): { found: string | null; missing: string } {
  const missing = WITNESSES.filter(witness => !witnesses.includes(witness)).map(witness => WITNESS_WORDS[witness].missing);
  return {
    found: witnesses.length === 0 ? null : witnesses.map(witness => WITNESS_WORDS[witness].found).join('; '),
    missing: missing.join('; '),
  };
}

/** The outcome line the page shows once the answer lands. */
function outcomeFor(item: ReviewQueueItem, result: VisitQuestionAnswered): string {
  return result.answer === 'refused'
    ? `${item.name}: out of ${item.kind_name}, in the kept-out list`
    : `${item.name}: kept in ${item.kind_name}`;
}

export function VisitQuestionCard({ items, onDone }: { items: ReviewQueueItem[]; onDone: OnDone }) {
  const several = items.length > 1;
  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={items[0]} kinds={several ? items.map(item => item.kind_name) : undefined} />
        <Stack spacing={2}>
          {items.map(item => item.visit_question && item.membership_id != null && (
            <VisitSection
              key={`${item.id}:${item.membership_id}`}
              item={item}
              membershipId={item.membership_id}
              question={item.visit_question}
              heading={several ? item.kind_name : undefined}
              onDone={onDone}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function VisitSection({ item, membershipId, question, heading, onDone }: {
  item: ReviewQueueItem;
  membershipId: number;
  question: VisitQuestion;
  heading?: string;
  onDone: OnDone;
}) {
  const [note, setNote] = useState('');
  const witnesses = witnessLines(question.witnesses);
  const answer = useMutation({
    mutationFn: (decision: 'keep' | 'refuse') => answerVisitQuestion(item.id, {
      decision, membershipId, note: note || undefined,
    }),
    onSettled: (data, error) => onDone(error || !data ? messageFor(item, error) : outcomeFor(item, data), item.id),
  });

  return (
    <Stack sx={heading ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 2 } : undefined}>
      {heading && <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{heading}</Typography>}

      <Typography variant="body2">
        {witnesses.found ? `One witness of four says a visitor goes here: ${witnesses.found}.` : 'None of the four witnesses says a visitor goes here.'}
      </Typography>
      <Typography variant="body2" color="text.secondary">Missing: {witnesses.missing}.</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {readingWords({ reading: question.reading, confidence: question.confidence })}.
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        Suggested: refuse it from {item.kind_name}.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Asked by the run on {formatDateTime(question.askedAt)}. Visitors still see it until you answer; a refused
        place goes to the kept-out list, where it can be put back.
      </Typography>

      <TextField
        size="small"
        fullWidth
        label="Note (optional)"
        helperText="Kept in this place's curation history with your answer."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        sx={{ my: 2 }}
      />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="contained" color="warning" disabled={answer.isPending} onClick={() => answer.mutate('refuse')}>
          Refuse from {item.kind_name}
        </Button>
        <Button variant="outlined" disabled={answer.isPending} onClick={() => answer.mutate('keep')}>
          Keep it
        </Button>
      </Stack>
    </Stack>
  );
}
