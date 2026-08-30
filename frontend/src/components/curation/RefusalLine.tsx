/**
 * The refusal, as one sentence with the checkable part checkable.
 *
 * The summary names a phrase worth hovering — the count of works, or the work that pulled
 * a building into the list — and this is what turns that phrase into the thing that shows
 * them. Everything else in the sentence is ordinary text, so the underline means exactly
 * one thing: there is something to look at here.
 */

import { Box, Stack, Typography } from '@mui/material';
import { refusalSummary, refusalHelp } from './refusalReason';
import { WorksPreview, type CountedWork } from './WorksPreview';
import { HelpHint } from './HelpHint';

export function RefusalLine({ reason, works, held, name }: {
  reason: string | null | undefined;
  works?: CountedWork[] | null;
  /** How many the catalogue holds, since `works` is capped and cannot say. */
  held?: number | null;
  /** The object's own name, so a note that opens by naming it need not repeat the heading. */
  name?: string;
}) {
  const { text, highlight, worksTotal, namedWork } = refusalSummary(reason, name);
  const at = highlight ? text.indexOf(highlight) : -1;

  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ mb: 2 }}>
      <Typography variant="body2">
        {at < 0 ? text : (
          <>
            {text.slice(0, at)}
            <WorksPreview works={works} total={worksTotal} held={held ?? undefined} only={namedWork}>
              {/* A dotted underline rather than a link: it opens nothing and goes nowhere,
                  it shows. `tabIndex` because the tooltip must be reachable without a
                  mouse, and a span takes no focus on its own. */}
              <Box
                component="span"
                // Focusable only when there is something to open: without works the phrase
                // is ordinary text, and a tab stop on ordinary text is a keyboard user
                // being told to look at something that is not there.
                tabIndex={works?.length ? 0 : undefined}
                sx={{
                  textDecoration: works?.length ? 'underline dotted' : 'none',
                  cursor: works?.length ? 'help' : 'inherit',
                }}
              >
                {highlight}
              </Box>
            </WorksPreview>
            {text.slice(at + (highlight?.length ?? 0))}
          </>
        )}
      </Typography>
      <HelpHint text={refusalHelp(reason)} label="how this rule decides" />
    </Stack>
  );
}
