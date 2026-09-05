/**
 * Two promises the dialog makes about a picture, on one real site.
 *
 * An emptied field is an edit, and it has to leave the browser (#696). The
 * dialog used to fold an emptied box into `undefined`, which `JSON.stringify`
 * drops: clearing the Image URL of Bamiyan and saving was answered "No fields
 * to update", and clearing it beside a name change was answered success — with
 * the photograph still there. What the API needs is the empty string, which the
 * controller stores as NULL under a claim.
 *
 * And the picture the box names is on screen, with whose it is (#801) — the
 * second block below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

vi.mock('../../api/experiences', () => ({
  editExperience: vi.fn(),
  rejectExperience: vi.fn(),
  unrejectExperience: vi.fn(),
  removeExperienceFromRegion: vi.fn(),
  fetchCurationLog: vi.fn(),
  fetchExperience: vi.fn(),
  setExperienceState: vi.fn(),
}));

import { editExperience, fetchExperience, type Experience } from '../../api/experiences';
import { CurationDialog } from './CurationDialog';

const mockedEdit = editExperience as unknown as ReturnType<typeof vi.fn>;
const mockedDetail = fetchExperience as unknown as ReturnType<typeof vi.fn>;

/** The issue's own example: a site whose picture points at a page the product may not draw. */
const OLD_PICTURE = 'https://whc.unesco.org/document/109141';
const PORTAL_PAGE = 'https://whc.unesco.org/en/list/208';

const bamiyan: Experience = {
  id: 1,
  external_id: '208',
  name: 'Cultural Landscape and Archaeological Remains of the Bamiyan Valley',
  short_description: 'The remains of the Buddhas and the monastic caves around them.',
  type: 'cultural',
  // World Heritage: the one kind whose type a curator can set in this dialog.
  category_id: 1,
  country_codes: ['AF'],
  country_names: ['Afghanistan'],
  image_url: OLD_PICTURE,
  in_danger: true,
  longitude: 67.82,
  latitude: 34.84,
  category_name: 'UNESCO World Heritage',
};

function renderDialog(experience: Experience = bamiyan) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurationDialog experience={experience} regionId={5} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const clear = (label: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

describe('CurationDialog clearing a field', () => {
  beforeEach(() => {
    mockedEdit.mockReset();
    mockedEdit.mockResolvedValue({ success: true, experienceId: bamiyan.id, curatedFields: [] });
    mockedDetail.mockReset();
    mockedDetail.mockResolvedValue({
      ...bamiyan,
      metadata: { website: PORTAL_PAGE, wikipediaUrl: 'https://en.wikipedia.org/wiki/Buddhas_of_Bamiyan' },
    });
  });

  it('sends an emptied picture rather than dropping it', async () => {
    renderDialog();
    await screen.findByDisplayValue(PORTAL_PAGE);

    clear('Image URL');
    save();

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(bamiyan.id, { imageUrl: '' }));
  });

  it('sends the removal beside the other change in the same save', async () => {
    // The silent half: this save used to go out with the name alone and be
    // answered success, the photograph untouched.
    renderDialog();
    await screen.findByDisplayValue(PORTAL_PAGE);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Bamiyan Valley' } });
    clear('Image URL');
    save();

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(bamiyan.id, { name: 'Bamiyan Valley', imageUrl: '' }));
  });

  it('sends an emptied description and link', async () => {
    renderDialog();
    await screen.findByDisplayValue(PORTAL_PAGE);

    clear('Short Description');
    clear('Website URL');
    save();

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(bamiyan.id, { shortDescription: '', websiteUrl: '' }));
  });

  it('sends the category None as an emptied category', async () => {
    renderDialog();
    await screen.findByDisplayValue(PORTAL_PAGE);

    // The one Select in the dialog; its label is not wired to it by id (#564).
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    save();

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledWith(bamiyan.id, { type: '' }));
  });
});

/**
 * The dialog shows the picture it edits, and names whose it is (#801).
 *
 * A curator checking what the Image URL box draws used to open the address in
 * another tab; the create dialog drew a thumbnail under the same box, so the
 * two forms disagreed. The credit is part of the picture (ADR-0043), and it is
 * the *stored* picture's: an address typed and not yet saved has none until the
 * save resolves it.
 */
describe('CurationDialog showing the picture it edits', () => {
  // The same site once *Fix pictures* answered it from Commons, as the
  // development catalogue holds it — picture and credit alike.
  const COMMONS_PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan%20Valley2.jpg';
  const THUMBNAIL = 'https://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan%20Valley2.jpg?width=250';
  const CREDIT = {
    author: 'Carl Montgomery',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg',
  };
  // Its neighbour's picture, as a curator might paste it in by mistake — or on purpose.
  const JAM = 'http://commons.wikimedia.org/wiki/Special:FilePath/Minaret%20of%20jam%202009%20ghor.jpg';
  const onCommons: Experience = { ...bamiyan, image_url: COMMONS_PICTURE, image_credit: CREDIT };

  const preview = () => screen.queryByRole('img', { name: 'Picture preview' });
  const type = (value: string) => fireEvent.change(screen.getByLabelText('Image URL'), { target: { value } });

  beforeEach(() => {
    mockedDetail.mockReset();
    mockedDetail.mockResolvedValue({ ...onCommons, metadata: { website: PORTAL_PAGE } });
  });

  it('draws the stored picture at a size the CDN holds, with its credit', () => {
    renderDialog(onCommons);

    expect(preview()).toHaveAttribute('src', THUMBNAIL);
    expect(screen.getByText('Carl Montgomery')).toBeInTheDocument();
    expect(screen.getByText('CC BY 2.0')).toBeInTheDocument();
  });

  it('draws nothing once the box is emptied — no frame, and no credit under it', () => {
    renderDialog(onCommons);

    type('');

    expect(preview()).not.toBeInTheDocument();
    expect(screen.queryByText('Carl Montgomery')).not.toBeInTheDocument();
  });

  it('previews an address typed and not yet saved, without a credit', () => {
    // None exists until the save resolves one — and the stored credit is not
    // this picture's photographer.
    renderDialog(onCommons);

    type(JAM);

    expect(preview()).toHaveAttribute('src', `${JAM.replace('http://', 'https://')}?width=250`);
    expect(screen.queryByText('Carl Montgomery')).not.toBeInTheDocument();
  });

  it('hides a picture that does not load, and its credit with it', () => {
    renderDialog(onCommons);

    fireEvent.error(preview() as HTMLElement);

    expect(preview()).not.toBeInTheDocument();
    expect(screen.queryByText('Carl Montgomery')).not.toBeInTheDocument();
  });

  it('asks again for a different address after one failed', () => {
    // The failure is held by address, not as a flag: a curator who retypes the
    // box after a broken picture is asking a new question.
    renderDialog(onCommons);
    fireEvent.error(preview() as HTMLElement);

    type(JAM);

    expect(preview()).toBeInTheDocument();
  });

  it('draws no frame for an address the product may not show', () => {
    // The first fixture's own case: a row still pointing at the World Heritage
    // portal, which `toThumbnailUrl` refuses (ADR-0043). `src=""` would be a
    // broken frame, not "no picture".
    renderDialog(bamiyan);

    expect(preview()).not.toBeInTheDocument();
  });

  it('takes the credit from the detail read when the row does not carry one', async () => {
    const rowWithoutCredit: Experience = { ...bamiyan, image_url: COMMONS_PICTURE };
    mockedDetail.mockResolvedValue({ ...rowWithoutCredit, metadata: { imageCredit: CREDIT } });
    renderDialog(rowWithoutCredit);

    expect(await screen.findByText('Carl Montgomery')).toBeInTheDocument();
  });
});
