/**
 * A run asks again about an answer a curator pinned (#1367): the curator put a
 * place back over its rule, or kept it out, and a later run says something
 * else — it refuses the place for another reason, or its rule would now admit
 * what the curator kept out — or, on an admin's request after a rule changed
 * (#1370), still says what the curator answered over (`restated`). The place
 * stays as the curator left it until someone answers here.
 *
 * The card puts the two side by side, in the order a curator reads them: what
 * they answered, when, and why; what they answered it against; what the run
 * says now. Two answers — keep it, so the pin answers the run's new reason
 * until a run says something else again, or let the rule decide, which writes
 * the run's verdict now. One section per pin, so a place two kinds ask about
 * is one card.
 */

import { useState } from 'react';
import { Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { answerPinQuestion, type PinQuestionAnswered } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { formatDateTime } from '../../utils/dateFormat';
import { ItemHeader, messageFor } from './queueCard';
import { RefusalLine } from './RefusalLine';

type OnDone = (message?: string, experienceId?: number) => void;
type PinQuestion = NonNullable<ReviewQueueItem['pin_question']>;

export function PinQuestionCard({ items, onDone }: { items: ReviewQueueItem[]; onDone: OnDone }) {
  const several = items.length > 1;
  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={items[0]} kinds={several ? items.map(item => item.kind_name) : undefined} />
        <Stack spacing={2}>
          {items.map(item => item.pin_question && item.membership_id != null && (
            <PinSection
              key={`${item.id}:${item.membership_id}`}
              item={item}
              membershipId={item.membership_id}
              question={item.pin_question}
              heading={several ? item.kind_name : undefined}
              onDone={onDone}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** What the curator's answer did, in the card's words. */
function answeredWords(question: PinQuestion): string {
  return question.answer === 'admitted' ? 'You put it back' : 'You kept it out';
}

/**
 * How the answer stood to the rule's verdict of the day (#2195). A put-back
 * beside a refusal overrode it; a keep-out beside one agreed with it, and
 * "over the rule's objection" there would invent an objection the rule never
 * raised (Karl Marx Monument: kept out at 17 editions, as the rule said).
 */
function ruleThenWords(question: PinQuestion): string {
  return question.answer === question.answeredVerdict ? 'as the rule did then:' : 'over the rule’s objection then:';
}

/** The outcome line the page shows once the answer lands. */
function outcomeFor(item: ReviewQueueItem, result: PinQuestionAnswered): string {
  if (result.pinned) return `${item.name}: your answer stands in ${item.kind_name}`;
  return result.admission === 'admitted'
    ? `${item.name}: back in ${item.kind_name}, as the rule now decides`
    : `${item.name}: out of ${item.kind_name}, as the rule now decides`;
}

function PinSection({ item, membershipId, question, heading, onDone }: {
  item: ReviewQueueItem;
  membershipId: number;
  question: PinQuestion;
  heading?: string;
  onDone: OnDone;
}) {
  const [note, setNote] = useState('');
  const answer = useMutation({
    mutationFn: (decision: 'keep' | 'release') => answerPinQuestion(item.id, {
      decision,
      membershipId,
      asked: { verdict: question.askedVerdict, reason: question.askedReason },
      note: note || undefined,
    }),
    onSettled: (data, error) => onDone(error || !data ? messageFor(item, error) : outcomeFor(item, data), item.id),
  });
  const admits = question.askedVerdict === 'admitted';

  return (
    <Stack sx={heading ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 2 } : undefined}>
      {heading && <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{heading}</Typography>}

      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {answeredWords(question)}
        {question.answeredAt ? ` on ${formatDateTime(question.answeredAt)}` : ''}
        {question.note ? ` — “${question.note}”` : ''}
      </Typography>
      {/* A script's words about how the answer came about (the unread batch's
          pins, read as a list, ADR-0096): the system's, so said to be and never
          put in the curator's quotes (#2195). */}
      {question.systemNote && (
        <Typography variant="caption" color="text.secondary">Recorded by the system: {question.systemNote}</Typography>
      )}
      {question.answeredVerdict === 'refused' && question.answeredReason && (
        <Stack sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">{ruleThenWords(question)}</Typography>
          <RefusalLine reason={question.answeredReason} name={item.name} />
        </Stack>
      )}

      {question.restated
        ? (
          // Asked again on request (#1370): the run still says what was answered
          // over, so repeating its reason would read as a change it is not.
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
            A run on {formatDateTime(question.askedAt)} was asked to look again at the answers pinned against the
            rule, and still says what you answered over. Keep your answer, or let the rule have its way now.
          </Typography>
        )
        : (
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
            A run on {formatDateTime(question.askedAt)} says something else:
          </Typography>
        )}
      {/* An admission is said either way: for a refused arrival asked again it is
          the only statement of what the curator kept out, since no "rule then"
          line precedes it. A refusal's reason, restated, was shown above. */}
      {admits && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          The rule would now admit it to {item.kind_name}.
        </Typography>
      )}
      {!admits && !question.restated && <RefusalLine reason={question.askedReason} name={item.name} />}

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
        <Button variant="outlined" disabled={answer.isPending} onClick={() => answer.mutate('keep')}>
          Keep my answer
        </Button>
        <Button variant="outlined" color="warning" disabled={answer.isPending} onClick={() => answer.mutate('release')}>
          {admits ? 'Let the rule decide — admit it' : 'Let the rule decide — keep it out'}
        </Button>
      </Stack>
    </Stack>
  );
}
