/**
 * "Read Wikipedia in" (#2209): the browser's languages shown as what links do
 * today, a change starting from them, and the way back to them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { state, setChosen } = vi.hoisted(() => ({
  state: { chosen: null as string[] | null, browser: ['ru', 'de'], saving: false, ready: true, unread: false },
  setChosen: vi.fn(),
}));
vi.mock('../../hooks/useReadingLanguages', () => ({
  useReadingLanguages: () => ({
    ...state, order: [...(state.chosen ?? state.browser), 'en'], setChosen, failed: false,
  }),
}));

import { ReadingLanguagesSetting } from './ReadingLanguagesSetting';

beforeEach(() => {
  setChosen.mockReset();
  state.chosen = null;
  state.saving = false;
  state.ready = true;
  state.unread = false;
});

describe('ReadingLanguagesSetting', () => {
  it('shows the browser\'s languages, then English, and starts a change from them', () => {
    render(<ReadingLanguagesSetting signedIn />);
    expect(screen.getByText('Russian (ru)')).toBeInTheDocument();
    expect(screen.getByText('German (de)')).toBeInTheDocument();
    expect(screen.getByText('then English')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my browser\'s languages' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a language by its code' }), { target: { value: 'JA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(setChosen).toHaveBeenCalledWith(['ru', 'de', 'ja']);
  });

  it('moves a language ahead of the one before it, and goes back to the browser\'s', () => {
    state.chosen = ['ru', 'de'];
    render(<ReadingLanguagesSetting signedIn={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Read German (de) before Russian (ru)' }));
    expect(setChosen).toHaveBeenLastCalledWith(['de', 'ru']);
    fireEvent.click(screen.getByRole('button', { name: 'Use my browser\'s languages' }));
    expect(setChosen).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/Kept in this browser/)).toBeInTheDocument();
  });

  it('adds no code Wikipedia does not name, no English and no language twice', () => {
    render(<ReadingLanguagesSetting signedIn />);
    const input = screen.getByRole('textbox', { name: 'Add a language by its code' });
    for (const value of ['en', 'ru', 'r u', '<b>']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    }
  });

  it('offers no second save while one is on its way', () => {
    state.chosen = ['ru', 'de'];
    state.saving = true;
    render(<ReadingLanguagesSetting signedIn />);
    expect(screen.getByRole('button', { name: 'Use my browser\'s languages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Read German (de) before Russian (ru)' })).toBeDisabled();
  });

  it('removes a language by its own named button', () => {
    state.chosen = ['ru', 'de'];
    render(<ReadingLanguagesSetting signedIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop reading Russian (ru)' }));
    expect(setChosen).toHaveBeenLastCalledWith(['de']);
  });

  it('changes nothing before the account\'s own list has been read', () => {
    // The account holds ['ru']; the browser's ['de'] shows meanwhile, and saving from it would replace the account's.
    state.ready = false;
    render(<ReadingLanguagesSetting signedIn />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a language by its code' }), { target: { value: 'ja' } });
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop reading Russian (ru)' })).toBeDisabled();
  });

  it('says so where the account\'s list could not be read at all', () => {
    state.ready = false;
    state.unread = true;
    render(<ReadingLanguagesSetting signedIn />);
    expect(screen.getByText(/could not be read, so they cannot be changed now/)).toBeInTheDocument();
  });
});
