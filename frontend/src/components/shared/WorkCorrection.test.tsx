/**
 * A curator's correction to one work: what it sends, and what it refuses to.
 *
 * Three rules here cannot be read off the form:
 *
 * Only what changed is sent. The endpoint refuses an empty body, and a field
 * sent unchanged would claim a column nobody meant to take from the source.
 *
 * **Except the makers, which can be claimed unchanged on purpose.** That is the
 * common case rather than an edge one: the stored order is a query planner's
 * (ADR-0040), so most of the works `work-makers-unconfirmed` counts need
 * somebody to vouch for an order that is already right. Without an action of its
 * own there would be nothing to press.
 *
 * An empty list of makers is a value. "Nobody knows who made this" is the right
 * answer for the *Salvator Mundi*, whose stored maker names no person.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({
  editWork: vi.fn(),
}));

import { WorkCorrection, correctionOutcome, refusals, type WorkToCorrect } from './WorkCorrection';
import { editWork } from '../../api/experiences';

const mockedEdit = editWork as unknown as ReturnType<typeof vi.fn>;

/** The Visitation in the Prado: three makers, and Raphael filed last. */
const VISITATION: WorkToCorrect = {
  treasureId: 2562,
  experienceId: 6185,
  museumName: 'Museo del Prado',
  name: 'Visitation',
  artists: ['Gianfrancesco Penni', 'Giulio Romano', 'Raphael'],
  artistsCurated: false,
  year: 1517,
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Visitation.jpg',
  // Commons names the painter as the author of a photograph of a painting, which
  // is why the rows that show this pass `redundantWith`.
  imageCredit: {
    author: 'Raphael',
    license: 'Public domain',
    licenseUrl: null,
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Visitation.jpg',
  },
  venueCount: 1,
  treasureType: 'painting',
  externalId: 'Q2467082',
};

/** Every key this render asked to be dropped, so the reach can be asserted. */
let invalidated: unknown[][] = [];

function show(work: WorkToCorrect, onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidated = [];
  const realInvalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return realInvalidate(filters as never);
  }) as typeof client.invalidateQueries;
  render(
    <QueryClientProvider client={client}>
      <WorkCorrection work={work} onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return onDone;
}

const save = () => screen.getByRole('button', { name: 'Save' });

describe('WorkCorrection', () => {
  beforeEach(() => {
    mockedEdit.mockReset();
    mockedEdit.mockResolvedValue({ success: true, treasureId: 2562, claimed: [] });
  });

  it('offers no save until something is worth sending', () => {
    show(VISITATION);
    // The endpoint refuses an empty body, so a save with nothing to say is not
    // offered rather than refused after the fact.
    expect(save()).toBeDisabled();
  });

  it('sends only the field that changed', async () => {
    show(VISITATION);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'The Visitation' } });
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, { name: 'The Visitation' });
  });

  it('lets a curator vouch for an order nothing changed about', async () => {
    show(VISITATION);
    // The row reads "3 artists" until this is pressed, and no edit is available
    // to a curator who thinks the stored order is already right.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm these makers' }));
    expect(save()).toBeEnabled();
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, {
      artists: ['Gianfrancesco Penni', 'Giulio Romano', 'Raphael'],
    });
  });

  it('sends the order a curator put the makers in', async () => {
    show(VISITATION);
    fireEvent.click(screen.getByRole('button', { name: 'Move Raphael up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Raphael up' }));
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, {
      artists: ['Raphael', 'Gianfrancesco Penni', 'Giulio Romano'],
    });
  });

  it('sends an empty list when a curator says nobody is known', async () => {
    // *Salvator Mundi* reads "Leonardeschi", which names no person at all.
    show({ ...VISITATION, name: 'Salvator Mundi', artists: ['Leonardeschi'], treasureId: 3676 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Leonardeschi' }));
    expect(screen.getByText(/No maker recorded/)).toBeTruthy();
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    expect(mockedEdit).toHaveBeenCalledWith(6185, 3676, { artists: [] });
  });

  it('still corrects a work whose stored year or picture is out of bounds', async () => {
    // Nothing constrains `treasures.year` and works have no picture repair, so
    // either can be over the line without a curator doing anything — and the
    // exit a blanket refusal leaves costs a claim on the field, which the source
    // then stops writing for good.
    show({ ...VISITATION, year: 20250 });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'The Visitation' } });

    // The field still says the stored value is wrong…
    expect(screen.getByText(/Older than anything a museum hangs/)).toBeTruthy();
    // …and the title, which the endpoint takes, still saves.
    fireEvent.click(save());
    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, { name: 'The Visitation' }));
  });

  it('does not claim a field whose stored value merely carries whitespace', async () => {
    // What is typed is trimmed before it is sent, so an untrimmed stored value
    // would differ from itself — and saving the year would send the title and
    // the picture too, claiming both against the source without an edit.
    show({
      ...VISITATION,
      name: '  Visitation  ',
      imageUrl: ' http://commons.wikimedia.org/wiki/Special:FilePath/Visitation.jpg ',
    });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1518' } });
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, { year: 1518 }));
  });

  it('draws the picture of an address pasted with whitespace around it', () => {
    // The frame is a curator's only signal about an address, so a good one
    // drawing nothing reads as a refused one — and this address is one the form
    // accepts and Save sends.
    show({ ...VISITATION, imageUrl: null });
    fireEvent.change(screen.getByLabelText('Picture'), {
      target: { value: ' https://commons.wikimedia.org/wiki/Special:FilePath/Visitation.jpg ' },
    });

    expect(screen.getByAltText('Visitation')).toBeTruthy();
  });

  it('refuses a year the curator typed out of bounds', () => {
    show(VISITATION);
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '18899' } });

    expect(save()).toBeDisabled();
  });

  it('still corrects the other fields of a work that names too many makers', async () => {
    // The endpoint's cap is on the *body*, and `artists` is optional there — so
    // a title on such a work is a request it takes. Refusing everything would
    // leave one exit, taking a maker off, and that sends the list and claims the
    // column: a typo in a title would permanently drop a maker the source
    // supplied and freeze an order nobody vouched for.
    const twentyOne = Array.from({ length: 21 }, (_, i) => `Maker ${i}`);
    show({ ...VISITATION, artists: twentyOne });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'The Visitation' } });

    expect(screen.getByText(/the makers cannot be confirmed or reordered/)).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, { name: 'The Visitation' }));
  });

  it('refuses to send a list that is over the cap', () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => `Maker ${i}`);
    show({ ...VISITATION, artists: twentyOne });
    // Confirming sends the list, which is the one request the cap is about.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm these makers' }));

    expect(save()).toBeDisabled();
    expect(mockedEdit).not.toHaveBeenCalled();
  });

  it('says how far the correction reaches, before it is made', () => {
    // *The Great Wave off Kanagawa* is one row and eleven museums, each holding
    // an impression of the same print (ADR-0025 decision 2).
    show({ ...VISITATION, name: 'The Great Wave off Kanagawa', venueCount: 11 });
    expect(screen.getByText(/hangs in 11 museums/)).toBeTruthy();
  });

  it('keeps the reach quiet for a work only one museum holds', () => {
    show(VISITATION);
    expect(screen.queryByText(/hangs in/)).toBeNull();
  });

  it('refuses a picture the catalogue may not show, and says why', () => {
    show(VISITATION);
    fireEvent.change(screen.getByLabelText('Picture'), {
      target: { value: 'https://www.museodelprado.es/photo.jpg' },
    });

    // The endpoint refuses this through Zod, and a Zod failure reaches a client
    // as "Validation error" with the reason in a `details` array no screen
    // reads — so the reason has to be said here, before the request.
    expect(screen.getByText(/Not a picture this catalogue may show/)).toBeTruthy();
    expect(save()).toBeDisabled();
    expect(mockedEdit).not.toHaveBeenCalled();
  });

  it('will not save a work whose title was cleared, and says why', () => {
    show(VISITATION);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1518' } });

    // The year alone would otherwise be a saveable change, and the emptied
    // title would go out of the body without a word about it.
    expect(screen.getByText('A work has a name — this one cannot be left empty.')).toBeTruthy();
    expect(save()).toBeDisabled();
  });

  it('drops every museum\'s contents, since the work is one row they share', async () => {
    show(VISITATION);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'The Visitation' } });
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    // The form has just promised the correction is what every museum holding the
    // work shows; their lists are held for five minutes, so the object's own
    // invalidation is not enough to keep that true.
    await waitFor(() => expect(invalidated).toContainEqual(['experience-contents']));
  });

  it('sends a picture change and warns that the credit goes with it', async () => {
    show(VISITATION);
    const next = 'http://commons.wikimedia.org/wiki/Special:FilePath/Visitation%20detail.jpg';
    fireEvent.change(screen.getByLabelText('Picture'), { target: { value: next } });
    // The stored credit belongs to the stored file, and this is not it yet.
    expect(screen.getByText(/looked up on Commons when you save/)).toBeTruthy();
    fireEvent.click(save());

    await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
    expect(mockedEdit).toHaveBeenCalledWith(6185, 2562, { imageUrl: next });
  });
});

describe('what the form refuses before the server does', () => {
  // Every one of these reaches the client as "Validation error" with the reason
  // in a `details` array no screen reads, so a form that let them through would
  // show a red box explaining nothing.

  it('refuses a title cleared to nothing', () => {
    // The endpoint's `min(1)` simply drops the field, so without this a curator
    // who deleted the title and fixed the year would be told it saved.
    expect(refusals('', '', 1517).nameCleared).toBe(true);
    expect(refusals('Visitation', '', 1517).nameCleared).toBe(false);
  });

  it('refuses a picture from a host the catalogue may not draw from', () => {
    expect(refusals('x', 'https://www.museodelprado.es/photo.jpg', null).pictureRefused).toBe(true);
    expect(refusals('x', 'https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg', null)
      .pictureRefused).toBe(false);
  });

  it('reads the legacy JSON shape the preview still decodes', () => {
    // The column once held `{"url": …}`. Asked raw it is neither remote nor
    // `/images/`, so it was refused — and the refusal feeds Save, greying out a
    // dialog opened to fix the title beside a preview drawing that picture.
    const legacy = '{"url":"https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg"}';
    expect(refusals('x', legacy, null).pictureRefused).toBe(false);
    // And a legacy value naming a host we may not draw from is still refused.
    expect(refusals('x', '{"url":"https://example.com/a.jpg"}', null).pictureRefused).toBe(true);
  });

  it('refuses a local path that is not one we serve pictures from', () => {
    // `toThumbnailUrl` passes any same-origin path, where the endpoint takes
    // only `/images/` — the one shape the drawing side maps onto our API.
    expect(refusals('x', '/img/works/7.jpg', null).pictureRefused).toBe(true);
    expect(refusals('x', '/images/works/7.jpg', null).pictureRefused).toBe(false);
  });

  it('refuses a list of makers longer than the endpoint stores', () => {
    // `MakerList` guards the way up; nothing caps the import, so a work can
    // *arrive* over the line. The cap is the endpoint's and the endpoint's is on
    // the body, so what it refuses is the request that sends the list — the
    // work's other fields go through, which the form test below pins.
    const twentyOne = Array.from({ length: 21 }, (_, i) => `Maker ${i}`);
    expect(refusals('x', '', null, twentyOne).tooManyMakers).toBe(true);
    expect(refusals('x', '', null, twentyOne.slice(0, 20)).tooManyMakers).toBe(false);
  });

  it('refuses a year outside what the column may hold', () => {
    // The ordinary slip is a digit too many.
    expect(refusals('x', '', 18899).yearRefused).toBe(true);
    expect(refusals('x', '', -400000).yearRefused).toBe(true);
    // And the floor still clears everything the catalogue holds.
    expect(refusals('x', '', -38000).yearRefused).toBe(false);
    expect(refusals('x', '', null).yearRefused).toBe(false);
  });
});

describe('correctionOutcome', () => {
  it('reads the credit off the reply rather than promising one', () => {
    const line = correctionOutcome(
      VISITATION,
      { imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg' },
      { success: true, treasureId: 2562, claimed: ['image_url'], imageCredit: null },
    );
    // Commons may name nobody, or may not answer in the five seconds the
    // endpoint waits — and a picture shown with no credit is worth saying.
    expect(line).toContain('no photographer could be found');
    expect(line).toContain('which photograph it is shown by');
  });

  it('says nobody was found when the credit names no photographer', () => {
    // `ImageCredit.author` is nullable: Commons can answer with a licence and no
    // name. Read off the object rather than the name, this said "by null".
    const line = correctionOutcome(
      VISITATION,
      { imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg' },
      {
        success: true, treasureId: 2562, claimed: ['image_url'],
        imageCredit: { author: null, license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null },
      },
    );
    expect(line).toContain('no photographer could be found');
    expect(line).not.toContain('null');
  });

  it('says a confirmed order was confirmed, not changed', () => {
    const line = correctionOutcome(
      VISITATION,
      { artists: VISITATION.artists },
      { success: true, treasureId: 2562, claimed: ['artists'] },
    );
    expect(line).toContain('confirmed as');
  });

  it('names every museum the correction reaches', () => {
    const line = correctionOutcome(
      { ...VISITATION, venueCount: 11 },
      { name: 'The Great Wave off Kanagawa' },
      { success: true, treasureId: 7705, claimed: ['name'] },
    );
    expect(line).toContain('All 11 museums holding this work carry the correction');
  });
});
