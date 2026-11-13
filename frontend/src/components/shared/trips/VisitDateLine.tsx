import { useState, type KeyboardEvent } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useVisitWritePending } from '../../../hooks/useVisitedExperiences';
import type { TripDateBody } from '../../../api/trips';
import { askSentence, askYears, dayOf, savedSentence } from './dateOffer';
import { answerDate, closeOffer, silenceOffer, useCurrentOffer } from './offerRuntime';
import { TripDateEditor } from './TripDateEditor';
import { quickDates } from './TripsSection';

const NO_DATE: TripDateBody = { year: null, month: null, day: null };
const yearOnly = (year: number): TripDateBody => ({ year, month: null, day: null });

/**
 * The line under the newest tick (#2120): the date it saved, "Visited today,
 * 12 Nov · Change", or in past travels the question, "When were you here?",
 * with the latest years as buttons. Never a dialog, and the tick never waits
 * for it. "Change" opens the quick choices in the same line, and Escape
 * closes them. Under an object's row for one of its parts, ticked in
 * Discover's panel, the line names the part. Every control waits while a
 * visit write is on its way.
 */
export function VisitDateLine() {
  const offer = useCurrentOffer();
  const pending = useVisitWritePending();
  const [open, setOpen] = useState<{ for: unknown; what: 'choices' | 'editor'; initial?: TripDateBody } | null>(null);
  if (!offer) return null;
  const { line } = offer;
  const named = line.count === 1 && offer.at > 0 && offer.places[0] !== offer.at;
  const shown = open?.for === line ? open : null;
  const now = Date.now();
  const answer = (date: TripDateBody) => { setOpen(null); answerDate(date); };
  const choose = (what: 'choices' | 'editor', initial?: TripDateBody) => setOpen({ for: line, what, initial });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && shown) { e.stopPropagation(); setOpen(null); }
  };
  const thisYear = new Date(now).getFullYear();

  const pick = (date: TripDateBody | 'year' | 'pick') => {
    if (date === 'year') choose('editor', yearOnly(thisYear));
    else if (date === 'pick') choose('editor', dayOf(now));
    else answer(date);
  };
  let choices: { label: string; act: () => void }[] = [];
  if (shown?.what === 'choices') {
    choices = quickDates(new Date(now)).map(({ label, date }) => ({ label, act: () => pick(date) }));
  } else if (line.kind === 'ask') {
    choices = [
      ...askYears(line, now).map(({ year, label }) => ({ label, act: () => answer(yearOnly(year)) })),
      { label: 'Earlier…', act: () => choose('editor', yearOnly(thisYear - 4)) },
      { label: "I don't remember", act: () => answer(NO_DATE) },
    ];
  }

  // "Change" asks the question in the line's own place, as an unanswered line does.
  const question = askSentence(line.kind === 'ask' ? line : { kind: 'ask', count: line.count, first: null });
  const sentence = line.kind === 'saved' && !shown ? savedSentence(line, now) : question;

  return (
    <Box sx={{ px: 2, py: 0.5 }} onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
      {named && <Typography variant="caption" color="text.secondary">{offer.where.label}</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
        <Typography role="status" variant="body2" sx={{ flex: 1 }}>{sentence}</Typography>
        {line.kind === 'saved' && !shown && (
          <Button size="small" disabled={pending} onClick={() => choose('choices')}>Change</Button>
        )}
        <IconButton size="small" aria-label="Close" disabled={pending} onClick={closeOffer}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      {shown?.what === 'editor'
        ? (
          <TripDateEditor
            initial={shown.initial ?? NO_DATE} disabled={pending}
            onCancel={() => setOpen(null)} onSave={answer}
          />
        )
        : choices.length > 0 && (
          <Box role="group" aria-label={question}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {choices.map(({ label, act }) => (
              <Button key={label} size="small" variant="outlined" disabled={pending} onClick={act}>{label}</Button>
            ))}
          </Box>
        )}
      <Button size="small" color="inherit" disabled={pending} onClick={silenceOffer}>Don't ask in this session</Button>
    </Box>
  );
}
