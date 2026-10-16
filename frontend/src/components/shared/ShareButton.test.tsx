/**
 * *Share* hands a card's address to the system sheet, or copies it, and says
 * what happened (#1192).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { COULD_NOT_COPY_LINK_TEXT, COULD_NOT_SHARE_TEXT, LINK_COPIED_TEXT, ShareButton } from './ShareButton';

const URL = 'https://uncovering.world/wv/5/r/6782-vlaanderen/e/850-historic-centre-of-brugge';
const TITLE = 'Historic Centre of Brugge';

function stub(key: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true });
}

afterEach(() => {
  stub('share', undefined);
  stub('clipboard', undefined);
});

function press() {
  render(<ShareButton url={URL} title={TITLE} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
}

describe('ShareButton', () => {
  it("hands the system sheet the card's address and the place's name", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stub('share', share);
    press();

    expect(share).toHaveBeenCalledWith({ title: TITLE, url: URL });
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('says nothing when the visitor cancels the sheet, and clears what a failure said', async () => {
    const share = vi.fn()
      .mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    stub('share', share);
    press();
    expect(await screen.findByRole('status')).toHaveTextContent(COULD_NOT_SHARE_TEXT);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    // Every pending rejection and the render it causes, before anything is read.
    await act(async () => {});

    expect(share).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('says it could not share, and offers a fresh click to copy instead', async () => {
    stub('share', vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')));
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub('clipboard', { writeText });
    press();

    expect(await screen.findByRole('status')).toHaveTextContent(COULD_NOT_SHARE_TEXT);
    // The failed sheet does not copy on its own: its click's activation is spent.
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(LINK_COPIED_TEXT));
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('copies the address where there is no system sheet, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub('clipboard', { writeText });
    press();

    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(LINK_COPIED_TEXT));
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('says it could not copy where the browser refuses the clipboard', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    press();

    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(COULD_NOT_COPY_LINK_TEXT));
  });
});
