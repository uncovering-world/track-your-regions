/**
 * A proposal as a table of facts: one fact per row, both values in their own columns,
 * the kind of change readable at a glance, one sentence about what it means.
 *
 * The shape is the one the tools built for exactly this decision converge on. Wikidata's
 * Mismatch Finder lays a disagreement between Wikidata and an external database out as
 * *property · Wikidata value · external value · review status*, one row per property,
 * the decision in its own column; OSMCha colours a changeset added / modified / deleted
 * before a reviewer opens a single feature; Wikimedia's visual diffs show a change as
 * the reader would see it rather than as it is stored. What replaced them here was a
 * stack of captions — "readers see", "the run proposed", a question mark, a note — five
 * lines per fact and no line more important than another, which a curator read as a
 * pile of text (#570).
 *
 * So: the fact's name anchors the row, with its definition on the term itself (dotted,
 * hover or focus) rather than on an icon; a 3 px stripe says the kind — green arriving,
 * amber changing, red removed — and the summary above the table counts the same kinds
 * before the rows do; a value is rendered as readers see it (the In Danger badge is the
 * badge, the criteria are chips, empty is a dash); the one sentence a fact has about its
 * change sits under the proposed value, and an event gets an arrow. Long text keeps the
 * two-column comparison with the differing words marked, which is the one place
 * side-by-side beats a line.
 *
 * Rows come grouped by subject. The object's group has no heading of its own — the card
 * is its heading. A part's group (a place of a serial site, a work in a museum) is headed
 * by the part's name and a way to open it, so a change inside the object reads on the
 * object's card and can be looked at where it lives.
 */

import { type ReactNode } from 'react';
import {
  Box, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { wordDiff, type DiffPart } from '../../utils/wordDiff';
import type { ChangeContext, FieldMeaning } from './fieldMeaning';
import { summarize, type FactGroup, type FactKind, type FactRow, type FactSubject } from './factRows';
import { ProvenanceTrail } from './ProvenanceTrail';

/** Whose two columns these are — the caller's to say, since the same table answers two questions. */
export interface FactLabels {
  before: string;
  after: string;
}

const KIND_COLOR: Record<FactKind, string> = { new: 'success.main', changed: 'warning.main', removed: 'error.main' };
const KIND_WORD: Record<FactKind, string> = { new: 'new', changed: 'changed', removed: 'removed' };

/** The kind as a small mark: a dot in the kind's colour and the word, set the same way everywhere. */
function KindMark({ kind, count }: { kind: FactKind; count?: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.6, px: 0.9, py: 0.1, borderRadius: 0.75,
        fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: KIND_COLOR[kind],
        bgcolor: theme => theme.palette.action.hover,
      }}
    >
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'currentColor' }} />
      {count !== undefined ? `${count} ${KIND_WORD[kind]}` : KIND_WORD[kind]}
    </Box>
  );
}

/**
 * What the run proposes, counted by kind and named, before a single row.
 *
 * The first thing a curator needs to know is which question this card asks: a value
 * replacing one readers can see, or a fact appearing where there was none. On this
 * catalogue the second is the whole batch — 1272 held cards on which the criteria and a
 * picture credit arrive — and the line says so in one glance rather than after the rows.
 */
export function ProposalSummary({ lead, rows, trailing }: {
  /** "Run 68 proposes", "The run that finished 22 Aug proposes". */
  lead: string;
  rows: ReadonlyArray<FactRow>;
  /** Something said after the counts: "over an edit claimed on 4 Aug". */
  trailing?: string | null;
}) {
  const byKind = summarize(rows);
  const kinds = (['changed', 'new', 'removed'] as const).filter(kind => byKind[kind].length > 0);
  const names = (kind: FactKind) => [...new Set(byKind[kind].map(r => r.meaning.label))].join(', ');
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ py: 1, fontSize: 13 }}>
      <Typography variant="body2" color="text.secondary">{lead}</Typography>
      {kinds.map((kind, i) => (
        <Stack key={kind} direction="row" spacing={1} alignItems="center">
          {i > 0 && <Typography variant="body2" color="text.secondary">·</Typography>}
          <KindMark kind={kind} count={byKind[kind].length} />
          <Typography variant="body2">{names(kind)}</Typography>
        </Stack>
      ))}
      {kinds.length === 0 && <Typography variant="body2" color="text.secondary">nothing</Typography>}
      {/* From the facts, not from the kind: a picture arriving is a fact appearing, and
          readers see it. Said only where every row arrives *and* no reader surface shows
          what arrives — the criteria, the region, the area — which the vocabulary knows. */}
      {rows.length > 0 && rows.every(r => r.kind === 'new' && r.meaning.unseen) && (
        <Typography variant="body2" color="text.secondary">· nothing readers see changes</Typography>
      )}
      {trailing && <Typography variant="body2" color="text.secondary">· {trailing}</Typography>}
    </Stack>
  );
}

/**
 * The fact's name with its definition on the term: dotted underline, tooltip on hover
 * and on keyboard focus — the pattern the refusal line and the source id already use, and
 * no icon, since nineteen question marks per card were most of the pile.
 */
function Term({ meaning }: { meaning: FieldMeaning }) {
  return (
    <Tooltip
      arrow
      enterDelay={300}
      slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
      title={(
        <Box sx={{ fontSize: 12, lineHeight: 1.45 }}>
          <Box component="p" sx={{ m: 0, mb: 0.75 }}>{meaning.what}</Box>
          <Box component="p" sx={{ m: 0 }}><strong>When it changes. </strong>{meaning.whenItChanges}</Box>
        </Box>
      )}
    >
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${meaning.label} — what this fact is`}
        sx={{
          fontWeight: 600, cursor: 'help', borderBottom: '1px dotted', borderColor: 'text.disabled',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        {meaning.label}
      </Box>
    </Tooltip>
  );
}

function readable(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Text against text, or text against nothing: what a word comparison can say something about. */
function comparableText(a: unknown, b: unknown): boolean {
  const textOrEmpty = (v: unknown) => typeof v === 'string' || v === null || v === undefined;
  return textOrEmpty(a) && textOrEmpty(b) && (typeof a === 'string' || typeof b === 'string');
}

/**
 * One tint for both sides: the marking says "these words differ", the same fact about
 * both columns, and the column headings already say whose text each is. Green against
 * orange would read as a verdict on a screen whose premise is that the curator's version
 * stands until they say otherwise.
 */
function Marked({ parts }: { parts: DiffPart[] }) {
  return (
    <Typography variant="body2" component="p" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0 }}>
      {parts.map((part, i) => (part.changed
        ? <Box key={i} component="mark" sx={{ bgcolor: 'warning.light', color: 'text.primary', borderRadius: 0.5, px: 0.25 }}>{part.text}</Box>
        : <Box key={i} component="span">{part.text}</Box>))}
    </Typography>
  );
}

const EMPTY = '—';

/** A value as readers see it, or as stored where the vocabulary has nothing to add; nothing as a dash. */
function Value({ value, meaning, context }: { value: unknown; meaning: FieldMeaning; context: ChangeContext }) {
  const absent = value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
  if (absent && !meaning.render) return <Typography variant="body2" color="text.disabled">{EMPTY}</Typography>;
  const content = meaning.render ? meaning.render(value, context) : readable(value);
  return (
    <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {content === '' ? <Box component="span" sx={{ color: 'text.disabled' }}>{EMPTY}</Box> : content}
    </Typography>
  );
}

/**
 * The two value cells of a row. Text a person wrote is compared word by word across the
 * two columns; anything the vocabulary can say is said that way on both sides and read
 * whole — "listed since 2003" against "not listed" is not a word diff.
 */
function ValueCells({ row, context }: { row: FactRow; context: ChangeContext }) {
  const diff = !row.meaning.render && comparableText(row.before, row.after)
    ? wordDiff(readable(row.before), readable(row.after))
    : null;
  return (
    <>
      <TableCell sx={{ verticalAlign: 'top' }}>
        {diff ? <Marked parts={diff.before} /> : <Value value={row.before} meaning={row.meaning} context={context} />}
        {row.provenance && <ProvenanceTrail field={row.provenance} />}
      </TableCell>
      <TableCell sx={{ verticalAlign: 'top' }}>
        {diff ? <Marked parts={diff.after} /> : <Value value={row.after} meaning={row.meaning} context={context} />}
        {row.sentence && (
          <Typography variant="body2" sx={{ mt: 0.5, color: row.meaning.event ? 'text.primary' : 'text.secondary' }}>
            {row.meaning.event && <Box component="span" sx={{ color: 'warning.main', fontWeight: 600, mr: 0.5 }}>→</Box>}
            {row.sentence}
          </Typography>
        )}
        {diff?.capped && (
          <Typography variant="caption" color="text.secondary">
            Too long to compare word by word — both values are shown in full.
          </Typography>
        )}
        {row.acceptable === false && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {/* Said before the click rather than in the line that confirms it. The
                coordinate is only half deferred: the pin moves now, the object's own
                position follows at the next sync. */}
            {row.field === 'location'
              ? 'Taking it moves the pin now; the object’s own position follows at the next sync.'
              : 'Taking it lands at the next sync.'}
          </Typography>
        )}
      </TableCell>
    </>
  );
}

/**
 * A part's heading: its name, what tells it from its siblings, and the way to open it.
 * The object's own group renders none — the card is its heading.
 */
function SubjectRow({ group, columns }: { group: FactGroup; columns: number }) {
  const { subject } = group;
  if (subject.kind === 'object') return null;
  return (
    <TableRow>
      <TableCell colSpan={columns} sx={{ bgcolor: 'action.hover', py: 0.75 }}>
        <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {subject.kind === 'place' ? 'a place of this object' : 'a work in this object'}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{subject.label}</Typography>
          {subject.detail && <Typography variant="body2" color="text.secondary">{subject.detail}</Typography>}
          {subject.onOpen && (
            <Link component="button" type="button" variant="body2" onClick={subject.onOpen} underline="hover">
              open
            </Link>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/**
 * How many rows share a field, counted from a row forward — an answer applies to a field,
 * never to a key inside one, so the answer cell spans them.
 */
function fieldSpan(rows: FactRow[], from: number): number {
  let span = 1;
  while (from + span < rows.length && rows[from + span].field === rows[from].field) span += 1;
  return span;
}

export function FactTable({ groups, labels, context, answer }: {
  groups: FactGroup[];
  labels: FactLabels;
  context: ChangeContext;
  /**
   * The answer to one field — rendered once per field, in its own column, spanning every
   * row the field made. Absent on a card answered whole.
   *
   * The subject comes with it because a field name is not an identity across groups: two
   * works in one museum both have an `artist` row, and the held card has to say which
   * work it is answering about (#722). The conflict card ignores it — its table is the
   * object's group and nothing else.
   */
  answer?: (field: string, rows: FactRow[], subject: FactSubject) => ReactNode;
}) {
  const columns = answer ? 4 : 3;
  const head = (text: string) => (
    <TableCell sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
      {text}
    </TableCell>
  );

  return (
    // Capped rather than stretched to the window. Left to fill it, the proposed
    // value took 897px on a wide screen and pushed the buttons that answer it
    // some 750px to the right of the words they are about, across empty space --
    // a curator reading a value has to cross the table to answer it, and a long
    // measure is the harder half of that to read in the first place.
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { px: 1.5 }, minWidth: 640, maxWidth: 1180 }}>
        <TableHead>
          <TableRow>
            {head('Fact')}
            {head(labels.before)}
            {head(labels.after)}
            {answer && head('Your answer')}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map(group => (
            // The subject's own key where it has one: two works with one name are
            // two groups, and a key built from the label would hand one the other's rows.
            <GroupRows key={group.subject.key ?? `${group.subject.kind}:${group.subject.label}`} group={group} columns={columns} context={context} answer={answer} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function GroupRows({ group, columns, context, answer }: {
  group: FactGroup;
  columns: number;
  context: ChangeContext;
  answer?: (field: string, rows: FactRow[], subject: FactSubject) => ReactNode;
}) {
  const { rows } = group;
  return (
    <>
      <SubjectRow group={group} columns={columns} />
      {rows.map((row, i) => {
        const first = i === 0 || rows[i - 1].field !== row.field;
        const span = first ? fieldSpan(rows, i) : 0;
        return (
          <TableRow key={row.id} sx={{ verticalAlign: 'top' }}>
            <TableCell sx={{ verticalAlign: 'top', borderLeft: '3px solid', borderLeftColor: KIND_COLOR[row.kind], width: 180 }}>
              <Term meaning={row.meaning} />
              <Box sx={{ mt: 0.75 }}><KindMark kind={row.kind} /></Box>
            </TableCell>
            <ValueCells row={row} context={context} />
            {answer && first && (
              // Centred rather than top-aligned wherever the cell spans more
              // than its own row: pinned to the top, the buttons sat beside the
              // first row and every row under it read as a fact with no answer,
              // which is how a curator comes to think a fact cannot be answered
              // at all. What still spans is a card filed before the writer
              // recorded facts rather than columns — a bare `metadata` entry
              // (ADR-0039), or a whole language map (#728) — splitting into rows
              // that all carry one field. Several *facts* under one answer, and
              // the same defect either way, kept alive only because a changeset
              // is never rewritten. There this caption is the only thing on
              // screen saying so — the fallback ADR-0039 rejected as a
              // sufficient fix, doing the job it can still do until the last of
              // those cards is re-proposed.
              <TableCell
                rowSpan={span}
                sx={{ verticalAlign: span > 1 ? 'middle' : 'top', width: 160 }}
              >
                {answer(row.field, rows.slice(i, i + span), group.subject)}
                {span > 1 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {`Answers all ${span}.`}
                  </Typography>
                )}
              </TableCell>
            )}
          </TableRow>
        );
      })}
    </>
  );
}
