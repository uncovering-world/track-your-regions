import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WorldView } from '../../api/worldViews';
import { DiscoverWorldViewSelect } from './DiscoverWorldViewSelect';

/**
 * Discover's world view select holds its place while the world views load
 * (#2378), so the panel below it does not move when it fills in.
 */

const administrative = { id: 5, name: 'Administrative' } as WorldView;
const wikivoyage = { id: 2, name: 'Wikivoyage Regions' } as WorldView;

describe('DiscoverWorldViewSelect', () => {
  it('is drawn empty and disabled while the world views load', () => {
    render(<DiscoverWorldViewSelect worldViews={[]} selected={null} loading onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'World View' });
    expect(select).toHaveAttribute('aria-disabled', 'true');
    // MUI draws an empty select with a zero-width space.
    expect(select.textContent?.replace(/\u200b/g, '').trim()).toBe('');
  });

  it('offers the world views once more than one has loaded, and hands over the one chosen', () => {
    const onChange = vi.fn();
    render(<DiscoverWorldViewSelect worldViews={[administrative, wikivoyage]} selected={administrative} loading={false} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'World View' });
    expect(select).not.toHaveAttribute('aria-disabled');
    expect(select).toHaveTextContent('Administrative');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: 'Wikivoyage Regions' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(wikivoyage);
  });

  it('stays, disabled and naming it, once a single world view has loaded, so the panel does not move back up', () => {
    render(<DiscoverWorldViewSelect worldViews={[administrative]} selected={administrative} loading={false} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'World View' });
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toHaveTextContent('Administrative');
  });

  it('shows nothing for a catalogue with no world view', () => {
    render(<DiscoverWorldViewSelect worldViews={[]} selected={null} loading={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
