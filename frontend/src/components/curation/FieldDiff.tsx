/**
 * One conflicted field, with both values in full and the difference marked.
 *
 * This replaces a summary. The screen used to cut every value at 120 characters, which
 * on Aksum meant 200 characters of a curator's text against 511 from the source, with
 * nothing on the page able to compare them — the decision was asked for and the evidence
 * withheld. So: both values whole, and the marking carries the reading load truncation
 * was standing in for.
 *
 * Values that are not text are shown as formatted JSON and **not** compared word by word.
 * A word comparison over `{"dateInscribed": "2003"}` and `{"dateInscribed": 2003}` would
 * mark nothing while the two are a real disagreement — the string-versus-number trap the
 * fixture dry run hit — so the shape stays visible instead.
 */

import { Box, Stack, Typography } from '@mui/material';
import { wordDiff, type DiffPart } from '../../utils/wordDiff';
import { fieldLabel } from './fieldLabel';

export interface ConflictField {
  field: string;
  old: unknown;
  new: unknown;
  /** False for fields `accept-source` cannot write; the note below says what happens. */
  acceptable?: boolean;
}

/**
 * Text as the curator would read it: strings as themselves, everything else as JSON.
 *
 * The JSON side wraps anywhere, not only at spaces: `metadata` conflicts run to 302
 * characters on this catalogue and carry URLs up to 97 with no break in them, so
 * `pre-wrap` alone would push one column past the other. The compared side already
 * breaks inside a word for the same reason.
 */
function readable(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * Can these two be compared word by word?
 *
 * Text against text, and text against *nothing*: a proposal that adds a description to a
 * row that has none arrives as `old: null` against a string, which is the commonest shape
 * on a held card and not a disagreement about shape at all — one side is simply empty.
 * `readable()` renders that side as an empty string, so the comparison marks the whole
 * proposal as added, which is exactly what happened.
 */
function comparablePair(a: unknown, b: unknown): boolean {
  const textOrEmpty = (v: unknown) => typeof v === 'string' || v === null || v === undefined;
  // Both empty is nothing to show either way; the note below would then be the only
  // content, and it would be wrong about a field that carries no values at all.
  return textOrEmpty(a) && textOrEmpty(b) && (typeof a === 'string' || typeof b === 'string');
}

/**
 * One tint for both sides, and that is a decision rather than a simplification.
 *
 * Green against orange is how a diff tool marks *added* against *removed*, and it reads as a
 * verdict: the source's column looked like the accepted one and the curator's like the
 * discarded one, on the screen whose entire premise is that the curator's version stands
 * until they say otherwise. What the marking is actually for is "these words differ" — the
 * same fact about both columns — and the labels above them already say whose text each is.
 */
const DIFFERS_TINT = 'warning.light';

function Marked({ parts }: { parts: DiffPart[] }) {
  return (
    <Typography
      variant="body2"
      component="p"
      sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0 }}
    >
      {parts.map((part, i) => (part.changed
        ? (
          <Box
            key={i}
            component="mark"
            sx={{ bgcolor: DIFFERS_TINT, color: 'text.primary', borderRadius: 0.5, px: 0.25 }}
          >
            {part.text}
          </Box>
        )
        // A run both sides share still renders through the same map, so the text is
        // reassembled in order — the parts are the value, not a decoration over it.
        : <Box key={i} component="span">{part.text}</Box>))}
    </Typography>
  );
}

/**
 * Both sides need naming by the caller, because the same comparison answers two different
 * questions. On a conflict the left side is the curator's own text and the right is what
 * the source wants instead; on a held change the left is what readers are looking at
 * right now and nobody's edit is involved. Calling that "yours" would be a claim about
 * authorship the card cannot make.
 */
export interface DiffLabels {
  before: string;
  after: string;
}

const CONFLICT_LABELS: DiffLabels = { before: 'yours', after: 'the source proposes' };

export function FieldDiff({ field, keepAction, takeAction, labels = CONFLICT_LABELS }: {
  field: ConflictField;
  /**
   * The two answers, each under the value it applies.
   *
   * They used to sit together in the heading, in the opposite order to the columns —
   * "take the source's value, keep mine" above "yours, the source proposes" — so the
   * button nearest a column was the one that discarded it. Under its own column there is
   * no order to get wrong and nothing to read twice.
   */
  keepAction?: React.ReactNode;
  takeAction?: React.ReactNode;
  labels?: DiffLabels;
}) {
  const before = readable(field.old);
  const after = readable(field.new);
  const comparable = comparablePair(field.old, field.new);
  const diff = comparable ? wordDiff(before, after) : null;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{fieldLabel(field.field)}</Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{labels.before}</Typography>
          {diff
            ? <Marked parts={diff.before} />
            : <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0 }}>{before}</Typography>}
          {keepAction && <Box sx={{ mt: 0.5 }}>{keepAction}</Box>}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{labels.after}</Typography>
          {diff
            ? <Marked parts={diff.after} />
            : <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0 }}>{after}</Typography>}
          {takeAction && <Box sx={{ mt: 0.5 }}>{takeAction}</Box>}
        </Box>
      </Stack>

      {diff?.capped && (
        <Typography variant="caption" color="text.secondary">
          Too long to compare word by word — both values are shown in full above.
        </Typography>
      )}
      {/* Only where a *shape* really differs. An added description — text against
          nothing — is compared above, and telling a curator "the shape is part of the
          difference" about it would be false twice over: there is no shape disagreement,
          and the marking they can see contradicts the sentence. */}
      {!comparable && (
        <Typography variant="caption" color="text.secondary">
          Shown as stored, not compared word by word: for this field the shape is part of the
          difference.
        </Typography>
      )}
      {field.acceptable === false && (
        <Typography variant="caption" color="text.secondary" component="p">
          This one lands at the next sync — accepting lifts your protection on it.
        </Typography>
      )}
    </Box>
  );
}
