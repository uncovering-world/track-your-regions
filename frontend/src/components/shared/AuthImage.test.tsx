import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AuthImage } from './AuthImage';

/**
 * A picture read behind the API's auth draws nothing while the next one is
 * read, rather than the last file under a new address (#844).
 */
describe('AuthImage', () => {
  const answers = new Map<string, (blob: Blob) => void>();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((src: string) => new Promise((resolve) => {
      answers.set(src, (blob) => resolve({ blob: () => Promise.resolve(blob) }));
    })));
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as Blob & { name: string }).name}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    answers.clear();
  });

  const picture = (name: string) => Object.assign(new Blob(['x']), { name });

  it("drops the last picture as soon as the address changes, and draws the next one when it arrives", async () => {
    const { rerender } = render(<AuthImage src="data:first" alt="preview" />);
    await act(async () => answers.get('data:first')!(picture('first')));
    expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'blob:first');

    rerender(<AuthImage src="data:second" alt="preview" />);
    expect(screen.queryByRole('img', { name: 'preview' })).toBeNull();

    await act(async () => answers.get('data:second')!(picture('second')));
    expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'blob:second');
  });
});
