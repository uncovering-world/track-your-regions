/**
 * A curator's correction to one work: its title, who made it, when, and which
 * photograph it is shown by.
 *
 * The body of `WorkPreviewDialog` wherever a curator may correct the work it
 * shows, and only the body — the dialog decides where a work can be looked at,
 * this decides what a correction says and sends. One mode, opened already
 * editing, as the point's form is (#583): there is no look to go back to.
 *
 * The two questions it exists for are different in kind. **An attribution can be
 * wrong**: the *Borghese Gladiator* in the Louvre is credited to Nicolas Cordier,
 * who restored one of its arms in the 17th century, where Agasias of Ephesus
 * carved it — and the credit under its own photograph on Commons says so. **Or
 * the order can be unvouched for**, which is not the same thing at all: the
 * stored order is a query planner's rather than the source's (ADR-0040), so a
 * work of three reads "3 artists" until somebody says who led it. The second is
 * a claim with nothing changed, which is why "Confirm these makers" is an action
 * of its own rather than something only an edit can produce — without it a
 * curator looking at an order that is already right has nothing to press, and
 * `work-makers-unconfirmed` in Catalogue Checks goes on counting the work.
 *
 * The picture is corrected here, with the credit that belongs to it. The
 * endpoint resolves the credit from Commons for whatever address this sends and
 * writes the two in one statement (ADR-0043), so the form neither asks for a
 * credit nor shows the stored one under an address that is not yet saved — the
 * rule `PictureWithCredit` is built on (#801).
 *
 * Sends only what changed. The endpoint refuses an empty body, so a save with
 * nothing to say is not offered rather than refused.
 *
 * The mutation lives here rather than in the caller, so the invalidation does
 * too — and it has to reach further than a place's. `invalidateExperiences`
 * drops the caches of the object the curator came from; a work is one row shared
 * by every museum showing it (ADR-0025 decision 2), so every museum's contents
 * list is dropped beside them, or the promise this form makes about the reach
 * would be false on the next card opened in the same session.
 */

import { useState } from 'react';
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { editWork, type ExperienceTreasure, type ImageCredit } from '../../api/experiences';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { creators, creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { plural } from '../../utils/plural';
import { MakerList, MAX_MAKERS } from './MakerList';
import { YearField } from './YearField';
import { PictureWithCredit } from './PictureWithCredit';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';

/** The work a curator is correcting, as the surface that opened it knows it. */
export interface WorkToCorrect {
  treasureId: number;
  /** The museum the curator came from: what proves the work is theirs to correct. */
  experienceId: number;
  museumName: string;
  name: string;
  artists: string[];
  /** Whether anyone has vouched for the stored order yet (`curated_fields ? 'artists'`). */
  artistsCurated: boolean;
  year: number | null;
  imageUrl: string | null;
  imageCredit?: ImageCredit | null;
  /** How many museums hang it, so the form can say how far the correction reaches. */
  venueCount?: number | null;
  /** What it is — "painting", "woodblock print" — and the source's own id, for the dialog's header. */
  treasureType?: string | null;
  externalId?: string | null;
  /** The region whose batch drew the museum's pin, where the caller is on a region's map. */
  regionId?: number | null;
}

/**
 * A row of a museum's contents, as the dialog needs it.
 *
 * Map mode and Discover read the same endpoint and draw the same work two ways,
 * so the mapping from its row to this form is written once: a second copy is how
 * one surface comes to send a field the other does not.
 */
export function workToCorrect(
  museum: { id: number; name: string },
  work: ExperienceTreasure,
  regionId?: number | null,
): WorkToCorrect {
  return {
    treasureId: work.id,
    experienceId: museum.id,
    museumName: museum.name,
    name: work.name,
    artists: work.artists,
    artistsCurated: work.artists_curated,
    year: work.year,
    imageUrl: work.image_url,
    imageCredit: work.image_credit,
    venueCount: work.venue_count,
    treasureType: work.treasure_type,
    externalId: work.external_id,
    regionId,
  };
}

type Correction = { name?: string; artists?: string[]; year?: number | null; imageUrl?: string };
type Reply = Awaited<ReturnType<typeof editWork>>;

/** What the curator changed, as one line for wherever the caller reports its answers. */
export function correctionOutcome(work: WorkToCorrect, correction: Correction, reply: Reply): string {
  const changes: string[] = [];
  if (correction.name !== undefined) changes.push(`retitled “${correction.name}”`);
  if (correction.artists !== undefined) {
    const named = creators(correction.artists);
    if (!named) changes.push('left with no maker recorded');
    else if (sameOrder(correction.artists, work.artists)) changes.push(`confirmed as ${named}`);
    else changes.push(`made by ${named}`);
  }
  if (correction.year !== undefined) {
    changes.push(correction.year === null ? 'left undated' : `dated ${yearLabel(correction.year)}`);
  }
  if (correction.imageUrl !== undefined) {
    // Read off the reply rather than promised: Commons may name nobody, or may
    // not answer inside the five seconds the endpoint waits, and a picture the
    // catalogue shows with no credit is worth saying out loud.
    // `ImageCredit.author` is nullable — Commons can answer with a licence and
    // no name — so the name is what decides the sentence, not the credit
    // object. Without that this read "given a picture by null".
    const photographer = reply.imageCredit?.author;
    if (correction.imageUrl === '') changes.push('left without a picture');
    else if (photographer) changes.push(`given a picture by ${photographer}`);
    else changes.push('given a picture no photographer could be found for');
  }
  const sentences = [`${work.name}: ${changes.join(', ')}.`];
  sentences.push(`The source will no longer overwrite ${claimedFields(reply.claimed)}.`);
  const venues = work.venueCount ?? 1;
  if (venues > 1) {
    // "carry", not "show": the count is of museums the work hangs in, which is a
    // fact about the world and stable under curation — one of them may be
    // refused or still gated, and readers would then see it nowhere while the
    // row it carries is corrected all the same (`venueCountSql`).
    sentences.push(`All ${venues} museums holding this work carry the correction.`);
  }
  return sentences.join(' ');
}

/** The columns a correction claimed, as the outcome names them to a person. */
const CLAIM_WORDS: Record<string, string> = {
  name: 'its title',
  artists: 'who made it',
  year: 'when it was made',
  image_url: 'which photograph it is shown by',
};

/** The claimed columns as a sentence, dropping any key this screen cannot name. */
function claimedFields(claimed: ReadonlyArray<string>): string {
  const words = claimed.map(key => CLAIM_WORDS[key]).filter(Boolean);
  if (words.length === 0) return 'what you changed';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/**
 * Whether two maker lists are the same names in the same order.
 *
 * Order-sensitive on purpose, and that is the whole point of the field: the same
 * people in another order is precisely the change a curator makes here, so the
 * set comparison the importer uses (`sameLabelSet`) would report nothing.
 */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * **Everything the endpoint would refuse, refused here in words.**
 *
 * A Zod failure reaches the client as `{ error: 'Validation error' }` with the
 * reason in a `details` array no screen reads, so anything this form lets
 * through and the server then turns down comes back as a red box explaining
 * nothing. Each of the three is a value a curator can plausibly type.
 *
 * Its own function, and exported for its test, because these are claims about
 * what the *server* accepts: they are worth pinning where they can be read
 * against `editWorkBodySchema` rather than driven through a form.
 */
export function refusals(name: string, picture: string, year: number | null, makers: string[] = []) {
  // A title cleared to nothing. The endpoint's `min(1)` is the right rule — a
  // work has a name — but without this the field is simply dropped from the
  // body, so a curator who deleted the title and also fixed the year would get
  // a success line and an unchanged title, with nothing saying so.
  const nameCleared = name === '';
  // An address the catalogue may not draw from — the server's rule
  // (`isDisplayablePictureUrl`) asked in the two halves it actually has, since
  // neither half answers for the other.
  //
  // The **legacy shape first**, and only that one. The column once held a
  // JSON-encoded `{"url": …}`, which the preview still decodes
  // (`PictureWithCredit`); asked raw it matches neither branch below — it is not
  // `http`, so it takes the local one and fails `/images/`. The cost would not
  // be a wrong picture but a locked dialog: the refusal feeds Save, so a curator
  // who opened the work to fix its *title* would find Save greyed out beside a
  // preview drawing that picture correctly. No stored row holds the shape today
  // (measured: 0 in `treasures` and 0 in `experiences`), which is what makes it
  // the kind of thing a split quietly drops.
  //
  // Decoded through `extractImageUrl` but only for that shape, because the rest
  // of what it does is a *rendering* concern rather than a validation one: it
  // resolves a stored `/images/…` path against the API's origin, and asking the
  // whole of it would refuse every local path — which is a value the endpoint
  // takes.
  const decoded = picture.startsWith('{') ? (extractImageUrl(picture) ?? picture) : picture;
  // A **remote** address is asked of `toThumbnailUrl`, the same question the
  // preview answers by drawing nothing, so the host list stays in one place
  // (#527) and the form cannot refuse a picture the preview would draw. A
  // **local** one is asked whether it is `/images/`, the one shape the drawing
  // side maps onto our API.
  const remote = /^https?:\/\//i.test(decoded);
  const pictureRefused = picture !== '' && (remote
    ? toThumbnailUrl(decoded, 250) === ''
    : !decoded.startsWith('/images/'));
  // A year outside what the column may hold. Six digits are typeable and
  // `18899` for `1889` is the ordinary slip; the floor is the one the stored
  // rows set — the Lion man's 38000 BC, with room under it.
  const yearRefused = year !== null && (year > 2200 || year < -200000);
  // More makers than the endpoint stores. `MakerList` stops a curator adding a
  // twenty-first, but nothing caps the import, so a work can *arrive* over the
  // line — and a work of twenty-one is exactly what `work-makers-unconfirmed`
  // puts at the top of its list.
  //
  // The bound is the endpoint's, and the endpoint's is on the **body**: `artists`
  // is optional there, so a title or a year on such a work is a request it takes.
  // The caller therefore asks this only of a save that sends the list — which is
  // not a nicety. Refusing every field would leave one exit, "take a maker off",
  // and that exit sends `artists`, which claims the column: `treasureWriter`
  // then keeps the row's list for good. Fixing a typo in a title would have
  // permanently dropped a maker the source supplied, frozen an order nobody
  // vouched for, and taken the work out of the count that asks somebody to.
  const tooManyMakers = makers.length > MAX_MAKERS;
  return { nameCleared, pictureRefused, yearRefused, tooManyMakers };
}

export function WorkCorrection({ work, onDone, onCancel }: {
  work: WorkToCorrect;
  /** The outcome line, for wherever the caller reports the rest of its answers. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(work.name);
  const [makers, setMakers] = useState<string[]>(work.artists);
  const [year, setYear] = useState<number | null>(work.year);
  const [picture, setPicture] = useState(work.imageUrl ?? '');
  // A claim on the makers with nothing changed: the curator vouching for an
  // order that was already right. Held apart from the list itself, because it
  // is the one thing the list cannot express.
  const [vouched, setVouched] = useState(false);

  // **Both sides trimmed, or the comparison invents an edit.** What is typed is
  // trimmed before it is sent, so a stored value carrying outer whitespace would
  // differ from itself: opening such a work and saving its *year* would send the
  // title too and claim the column, and the source would stop writing it — a
  // claim on a field nobody touched, which is the one thing a claim must never
  // be. No stored row carries whitespace today (measured, 0 of both columns);
  // nothing forbids one, since the importer writes what the source sends.
  const trimmedName = name.trim();
  const storedName = work.name.trim();
  const typedPicture = picture.trim();
  const storedPicture = (work.imageUrl ?? '').trim();
  const { nameCleared, pictureRefused, yearRefused, tooManyMakers } =
    refusals(trimmedName, typedPicture, year, makers);
  const renamed = !nameCleared && trimmedName !== storedName;
  const makersEdited = !sameOrder(makers, work.artists);
  const makersClaimed = makersEdited || vouched;
  const redated = year !== work.year;
  const repictured = typedPicture !== storedPicture;

  const correction: Correction = {
    ...(renamed ? { name: trimmedName } : {}),
    ...(makersClaimed ? { artists: makers } : {}),
    ...(redated ? { year } : {}),
    ...(repictured ? { imageUrl: typedPicture } : {}),
  };
  const nothingToSave = Object.keys(correction).length === 0;
  // **A stored value that is already wrong blocks the field it belongs to and
  // nothing else.** Every bound the endpoint has is on the *body*, and each of
  // these columns is optional there, so it is validated only when the request
  // carries it — and each can be over the line without a curator doing
  // anything. Nothing constrains `treasures.year` (its one CHECK is on
  // `curation_state`), so a mis-parsed date storing 20250 must not grey out
  // Save for that work's *title* — on the row whose obviously wrong year is why
  // the curator opened it. And `pictureRepair` sweeps `experiences` only, so an
  // unshowable stored picture on a work has no repair at all.
  //
  // The exit a blanket refusal leaves is worse than the refusal: correcting the
  // field sends it, which claims the column, and the source stops writing it
  // for good. A curator fixing a typo in a title would freeze a year or a
  // picture they never meant to take ownership of.
  //
  // `nameCleared` is the exception and belongs on the other side of the line: it
  // is the one refusal here about an edit made *in this dialog*, and its field
  // is never sent — an emptied title makes `renamed` false — so "only where it
  // is sent" would silently drop it, which is the bug it was added to fix.
  const refused = nameCleared
    || (pictureRefused && repictured)
    || (yearRefused && redated)
    || (tooManyMakers && makersClaimed);

  const save = useMutation({
    mutationFn: () => editWork(work.experienceId, work.treasureId, correction),
    onSuccess: (reply) => {
      invalidateExperiences(queryClient, { experienceId: work.experienceId, regionId: work.regionId });
      // A work is one row shared by every museum showing it (ADR-0025 decision
      // 2), and the helper above reaches only the object the curator came from.
      // *The Great Wave off Kanagawa* hangs in eleven, and their lists are held
      // for five minutes — so without the prefix, the form's own promise that
      // the correction is what every one of them shows would be false on the
      // next card opened in the same session.
      queryClient.invalidateQueries({ queryKey: ['experience-contents'] });
      onDone(correctionOutcome(work, correction, reply));
    },
  });

  // The credit belongs to the file that is stored, so it is shown only while the
  // address still names that file. A picture being typed has no credit yet —
  // the save is what resolves one.
  const shownCredit = typedPicture === storedPicture ? work.imageCredit : null;

  // What the vouch button says, and it says three different things: a claim
  // already staged, an empty list a curator is calling final, and the ordinary
  // "these are right as they stand".
  let vouchLabel = 'Confirm these makers';
  if (vouched) vouchLabel = 'Undo';
  else if (makers.length === 0) vouchLabel = 'Confirm: no maker is known';
  const venues = work.venueCount ?? 1;

  return (
    <Stack spacing={2}>
      {venues > 1 && (
        <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
          <strong>This work hangs in {venues} museums.</strong> They share one row —
          correcting it here corrects it for all of them.
        </Alert>
      )}

      <TextField
        label="Title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        size="small"
        fullWidth
        error={nameCleared}
        helperText={nameCleared ? 'A work has a name — this one cannot be left empty.' : undefined}
        slotProps={{ htmlInput: { maxLength: 500 } }}
      />

      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '.06em' }}>
            MAKERS
          </Typography>
          <OrderChip
            claimed={makersClaimed}
            already={work.artistsCurated}
            count={makers.length}
          />
          <Stack sx={{ flex: 1 }} />
          {!work.artistsCurated && !makersEdited && (
            <Button size="small" onClick={() => setVouched(!vouched)} sx={{ textTransform: 'none' }}>
              {vouchLabel}
            </Button>
          )}
        </Stack>
        <MakerList makers={makers} onChange={setMakers} overCap={tooManyMakers} />
        {/* Said only where the order is a question. One maker has no order, and a
            sentence about how two names read is noise on a work that names one. */}
        {makers.length > 2 && (
          <Typography variant="caption" color="text.secondary">
            {`The first name leads: a row with one line reads “${makers[0]} and ${plural(makers.length - 1, 'other')}” once the order is confirmed, and “${creatorsBrief(makers, false)}” until then.`}
          </Typography>
        )}
        {makers.length === 2 && (
          <Typography variant="caption" color="text.secondary">
            Two names are given whole either way — “A and B” says they made it together, and
            nothing about which of them leads. Drop one to say the other made it alone.
          </Typography>
        )}
      </Stack>

      <YearField
        value={year}
        onChange={setYear}
        error={yearRefused}
        helperText={yearRefused
          ? 'Older than anything a museum hangs, or later than this catalogue goes.'
          : 'Empty for a work nobody dates. BC reaches as far back as the catalogue does.'}
      />

      <Stack spacing={0.5}>
        <TextField
          label="Picture"
          value={picture}
          onChange={(e) => setPicture(e.target.value)}
          size="small"
          fullWidth
          spellCheck={false}
          placeholder="https://commons.wikimedia.org/wiki/Special:FilePath/…"
          error={pictureRefused}
          helperText={pictureRefused
            ? 'Not a picture this catalogue may show: a Wikimedia Commons file, or a path we host.'
            : 'A Wikimedia Commons file, or a picture we host. Empty takes it off.'}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        {/* The trimmed value, which is what the refusal beside it is asked and
            what Save sends. `extractImageUrl` does not trim, so a pasted address
            with a trailing space — off a wiki page, off a document — draws
            nothing while the field stays black and Save stays live: the frame is
            a curator's only signal about an address, so a good one would read as
            a refused one. The same for a stored value carrying whitespace. */}
        <PictureWithCredit url={typedPicture} credit={shownCredit} alt={work.name} width={250} />
        {repictured && typedPicture !== '' && !pictureRefused && (
          <Typography variant="caption" color="text.secondary">
            A new file: whoever took it is looked up on Commons when you save, and the credit
            stored for the old one goes with it.
          </Typography>
        )}
      </Stack>

      {save.isError && (
        <Alert severity="error">
          {save.error instanceof Error ? save.error.message : 'The correction could not be saved.'}
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Saving claims what you change: the source stops overwriting that field at every later
          run, while everything else about this work still follows it.
        </Typography>
        <Button onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={save.isPending || nothingToSave || refused}
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * Where the makers stand: following the source, already claimed, or about to be.
 *
 * The chip is the state and the button beside it acts on the state, so the one
 * thing a curator cannot see from the list itself — whether anybody has vouched
 * for this order — is said in the block it belongs to.
 */
function OrderChip({ claimed, already, count }: {
  claimed: boolean;
  already: boolean;
  count: number;
}) {
  if (claimed) return <Chip size="small" color="primary" variant="outlined" label="confirmed on save" />;
  if (already) return <Chip size="small" color="primary" variant="outlined" label="order confirmed" />;
  if (count === 0) return <Chip size="small" variant="outlined" label="no maker recorded" />;
  return <Chip size="small" variant="outlined" label={count > 2 ? 'order not confirmed' : 'follows the source'} />;
}
