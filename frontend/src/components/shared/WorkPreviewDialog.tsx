/**
 * One work, opened where a curator may correct it.
 *
 * In `shared/` because the same dialog is asked for from every surface that
 * shows a curator a work — the museum's contents on an open card in Map mode
 * and in Discover, the works waiting to be published on the review page, and
 * the held card's proposal about one — and the rule for where a work may be
 * corrected is the same on all of them: wherever a curator is looking at one
 * (#731, the sibling of #583 one level over).
 *
 * The header carries what identifies the work rather than what is being edited:
 * the museum it is being corrected from, what kind of thing it is, and the two
 * doors to the source — its Wikidata item and the article resolved from it,
 * which is where a curator goes to settle whether Nicolas Cordier carved the
 * *Borghese Gladiator* or only repaired it (#806). Both open in a new tab: losing
 * the queue to read about one sculpture costs the curator their place in it.
 *
 * No read-only mode. Every caller is a curator screen, and a work with nothing
 * to correct — a held record naming a row that no longer exists — is not opened
 * anywhere: `factRows`' `openable` gives such a part no door, since the picture,
 * the makers and the year a preview would draw are all the missing row's.
 */

import { Dialog, DialogContent, DialogTitle, IconButton, Link, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { WorkCorrection, type WorkToCorrect } from './WorkCorrection';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';

export function WorkPreviewDialog({ work, onClose, onDone }: {
  /** The work to correct, or null for nothing open. */
  work: WorkToCorrect | null;
  onClose: () => void;
  /** Where the outcome line goes: the caller's own reporting. */
  onDone: (message: string) => void;
}) {
  const item = work?.externalId ? wikidataItemUrl(work.externalId) : null;
  const article = work?.externalId ? wikipediaArticleUrl(work.externalId) : null;
  return (
    <Dialog open={work !== null} onClose={onClose} maxWidth="sm" fullWidth>
      {work && (
        <>
          <DialogTitle sx={{ pr: 6 }}>
            {/* The name is the door to the source, as it is on every other
                surface that shows a work (`WorkCard`, the queue's rows): a bare
                Q-number is not something to put in front of a person, and the
                thing a curator wants to click is the title. */}
            {item
              ? (
                <Link href={item} target="_blank" rel="noopener noreferrer" color="inherit">
                  {work.name}
                </Link>
              )
              : work.name}
            <Typography variant="body2" color="text.secondary">
              {[work.museumName, work.treasureType].filter(Boolean).join(' · ')}
              {article && (
                <>
                  {' · '}
                  <Link
                    href={article}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="inherit"
                    aria-label={`Wikipedia article for ${work.name}`}
                  >
                    Wikipedia
                  </Link>
                </>
              )}
            </Typography>
            <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="close">
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          {/* MUI zeroes a content's top padding when a title sits above it, and
              the content scrolls — so the floating label of the first field, which
              sits above that field's own box, was clipped against the header rule:
              "Title" read as a row of half-letters.
              Written against the class rather than as a bare `pt`, because the
              rule doing the zeroing is `.MuiDialogTitle-root + .MuiDialogContent-root`
              and outranks the single class `sx` generates — a plain `pt: 2` is
              applied and loses, which looks like the fix not working. */}
          <DialogContent sx={{ '&.MuiDialogContent-root': { pt: 2 } }}>
            {/* Keyed on the work, since a caller mounted unkeyed must not carry
                one work's draft onto the next. Cancel is the dialog's close:
                there is no look to go back to. */}
            <WorkCorrection
              key={work.treasureId}
              work={work}
              onDone={(message) => { onDone(message); onClose(); }}
              onCancel={onClose}
            />
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
