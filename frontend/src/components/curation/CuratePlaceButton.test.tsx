import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fetchExperience } from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';
import { CuratePlaceButton } from './CuratePlaceButton';

vi.mock('../../api/experiences', () => ({ fetchExperience: vi.fn() }));
// The dialog, as the button hands it the place and its close.
vi.mock('../shared/lazyCurationDialogs', () => ({
  LazyCurationDialog: ({ experience, regionId, onClose }: {
    experience: { name: string } | null; regionId: number | null; onClose: () => void;
  }) => (experience ? (
    <div>
      {`curating ${experience.name} in ${regionId ?? 'no region'}`}
      <button type="button" onClick={onClose}>Close the dialog</button>
    </div>
  ) : null),
}));

const mockedFetch = fetchExperience as unknown as ReturnType<typeof vi.fn>;

/** The Tree of Sadness in Beslan, a waiting arrival in Monuments & memorials, as its read answers a curator. */
const TREE = { id: 50731, name: 'Tree of Sadness', image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Beslan%20kollazh.jpg' };

function renderButton(name?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <CuratePlaceButton placeId={TREE.id} name={name} />
    </QueryClientProvider>,
  );
  return invalidate;
}

describe('a place a review card names, opened for curation (#2293)', () => {
  it('reads the place by its id only once asked, and opens its dialog with no region', async () => {
    mockedFetch.mockResolvedValue(TREE);
    renderButton();
    expect(mockedFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Curate' }));

    expect(await screen.findByText('curating Tree of Sadness in no region')).toBeTruthy();
    expect(mockedFetch).toHaveBeenCalledWith(TREE.id);
  });

  it('reads the queue again once the dialog closes, so the card shows the place as it now stands', async () => {
    mockedFetch.mockResolvedValue(TREE);
    const invalidate = renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Curate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close the dialog' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.curation.reviewQueueAll });
    expect(screen.queryByText(/curating/)).toBeNull();
  });

  it('is called by the place it opens where the card names more than one', () => {
    renderButton('Beslan School Number One');
    expect(screen.getByRole('button', { name: 'Curate Beslan School Number One' })).toBeTruthy();
  });

  it('says it could not open the place, and asks again on the next press', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(TREE);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Curate' }));
    const retry = await screen.findByRole('button', { name: 'Could not open it — try again' });

    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText('curating Tree of Sadness in no region')).toBeTruthy());
  });
});
