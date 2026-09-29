import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../api/fetchUtils';
import { useEditForm, type EditFormOptions } from './useEditForm';

type Place = { name: string; imageUrl: string; website: string; coords: string };

const stored: Place = {
  name: 'Cologne Cathedral',
  imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Koelner_Dom.jpg',
  website: 'https://www.koelner-dom.de',
  coords: '50.9413, 6.9583',
};

function renderForm(opts: Partial<EditFormOptions<Place>> = {}, initial: Place = stored) {
  return renderHook(
    (props: { initial: Place; resetKey: number }) =>
      useEditForm<Place>({ ...opts, initial: props.initial, resetKey: props.resetKey }),
    { initialProps: { initial, resetKey: 1 } },
  );
}

function refusal(issues: Array<{ path: string; message: string }>): ApiError {
  return new ApiError('Validation error — …', 400, 'Validation error', undefined, issues);
}

/**
 * The one statement of what a dialog sends and how a refusal is shown
 * (ADR-0076). Each dialog's own spec holds that it goes through this; the
 * rules themselves are held here.
 */
describe('useEditForm', () => {
  it('sends an emptied optional field as empty, never as absent (#696, #1133)', () => {
    const { result } = renderForm();

    act(() => result.current.set('imageUrl', ''));

    expect(result.current.changes()).toEqual({ imageUrl: '' });
    expect('imageUrl' in result.current.changes()).toBe(true);
  });

  it('sends the changed fields alone', () => {
    const { result } = renderForm();

    act(() => result.current.set('name', 'Hohe Domkirche St. Petrus'));

    expect(result.current.changes()).toEqual({ name: 'Hohe Domkirche St. Petrus' });
    expect(result.current.dirty).toBe(true);
    expect(result.current.isDirty('website')).toBe(false);
  });

  it('does not count a stray space as a change, and sends the value trimmed', () => {
    const { result } = renderForm();

    act(() => result.current.set('name', ' Cologne Cathedral  '));
    expect(result.current.dirty).toBe(false);

    act(() => result.current.set('website', ' https://www.koelner-dom.de/en '));
    expect(result.current.changes()).toEqual({ website: 'https://www.koelner-dom.de/en' });
  });

  it('tidies a field the way the dialog names', () => {
    const { result } = renderForm({ tidy: { name: v => v.replace(/\s+/g, ' ').trim() } });

    act(() => result.current.set('name', 'Cologne   Cathedral'));

    expect(result.current.dirty).toBe(false);
  });

  it('opens a create on blanks and sends only what was filled in', () => {
    const blank: Place = { name: '', imageUrl: '', website: '', coords: '' };
    const { result } = renderForm({ required: ['name'] }, blank);

    expect(result.current.missing).toBe(true);
    act(() => result.current.set('name', 'Aachen Cathedral'));

    expect(result.current.missing).toBe(false);
    expect(result.current.changes()).toEqual({ name: 'Aachen Cathedral' });
  });

  it('narrows what is sent to the fields named', () => {
    const { result } = renderForm();

    act(() => {
      result.current.set('name', 'Dom');
      result.current.set('website', '');
    });

    expect(result.current.changes(['website'])).toEqual({ website: '' });
  });

  it('takes a late stored value into the fields the user did not touch, and keeps the ones they did', () => {
    const early: Place = { ...stored, website: '' };
    const { result, rerender } = renderForm({}, early);

    act(() => result.current.set('name', 'Dom'));
    rerender({ initial: { ...stored, name: 'Kölner Dom' }, resetKey: 1 });

    expect(result.current.values.website).toBe(stored.website);
    expect(result.current.values.name).toBe('Dom');
    expect(result.current.changes()).toEqual({ name: 'Dom' });
  });

  it('lets a newer stored value reach a field typed back to the stored one', () => {
    const { result, rerender } = renderForm();

    act(() => result.current.set('website', 'https://example.org'));
    act(() => result.current.set('website', stored.website));
    rerender({ initial: { ...stored, website: 'https://www.koelner-dom.de/en' }, resetKey: 1 });

    expect(result.current.values.website).toBe('https://www.koelner-dom.de/en');
    expect(result.current.changes()).toEqual({});
  });

  it('starts over on a new key', () => {
    const { result, rerender } = renderForm();

    act(() => result.current.set('name', 'Dom'));
    rerender({ initial: { ...stored, name: 'Aachen Cathedral' }, resetKey: 2 });

    expect(result.current.values.name).toBe('Aachen Cathedral');
    expect(result.current.dirty).toBe(false);
  });

  it('shows each refused field on its field, and the rest as the form error', async () => {
    const { result } = renderForm({ paths: { latitude: 'coords' } });
    act(() => result.current.set('imageUrl', 'javascript:alert(1)'));

    let landed = true;
    await act(async () => {
      landed = await result.current.submit(() => Promise.reject(refusal([
        { path: 'imageUrl', message: 'Invalid url' },
        { path: 'latitude', message: 'Too big: expected number to be <=90' },
        { path: 'tags.0', message: 'Expected string' },
        { path: 'regionId', message: 'Expected number' },
      ])));
    });

    expect(landed).toBe(false);
    expect(result.current.errors).toEqual({
      imageUrl: 'Invalid url',
      coords: 'Too big: expected number to be <=90',
    });
    expect(result.current.formError).toBe('Validation error — tags.0: Expected string; regionId: Expected number');
    expect(result.current.field('imageUrl')).toMatchObject({ error: true, helperText: 'Invalid url' });
  });

  it('maps a nested path to the field it starts with', async () => {
    type Makers = { artists: string[] };
    const { result } = renderHook(() => useEditForm<Makers>({ initial: { artists: ['Rembrandt'] } }));

    await act(async () => {
      await result.current.submit(() => Promise.reject(refusal([{ path: 'artists.1', message: 'Too long' }])));
    });

    expect(result.current.errors).toEqual({ artists: 'Too long' });
    expect(result.current.formError).toBeNull();
  });

  it('shows a refusal with no field issue, and any other failure, as the form error', async () => {
    const { result } = renderForm();

    await act(async () => {
      await result.current.submit(() => Promise.reject(new ApiError('Admin access required', 403, 'Admin access required', undefined)));
    });
    expect(result.current.formError).toBe('Admin access required');

    await act(async () => {
      await result.current.submit(() => Promise.reject(new TypeError('Failed to fetch')));
    });
    expect(result.current.formError).toBe('Failed to fetch');
  });

  it('clears a field error once the field is edited', async () => {
    const { result } = renderForm();
    await act(async () => {
      await result.current.submit(() => Promise.reject(refusal([{ path: 'website', message: 'Invalid url' }])));
    });

    act(() => result.current.set('website', 'https://www.koelner-dom.de/'));

    expect(result.current.errors).toEqual({});
  });

  it('compares against what a landed save sent', async () => {
    const send = vi.fn().mockResolvedValue({});
    const { result } = renderForm();
    act(() => result.current.set('website', ''));

    let landed = false;
    await act(async () => { landed = await result.current.submit(send); });

    expect(send).toHaveBeenCalledWith({ website: '' });
    expect(landed).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('drops the answer of a save the user put back while it was in flight', async () => {
    let refuse: (err: Error) => void = () => {};
    const { result } = renderForm();
    act(() => result.current.set('name', 'x'.repeat(300)));

    let pending: Promise<boolean> = Promise.resolve(true);
    act(() => { pending = result.current.submit(() => new Promise((_, reject) => { refuse = reject; })); });
    act(() => result.current.resetField('name'));
    let landed = true;
    await act(async () => {
      refuse(refusal([{ path: 'name', message: 'Too big' }]));
      landed = await pending;
    });

    expect(landed).toBe(false);
    expect(result.current.errors).toEqual({});
    expect(result.current.formError).toBeNull();
  });

  it('puts a field back to its stored value', () => {
    const { result } = renderForm();
    act(() => result.current.set('name', 'Dom'));

    act(() => result.current.resetField('name'));

    expect(result.current.values.name).toBe(stored.name);
    expect(result.current.dirty).toBe(false);
  });
});
