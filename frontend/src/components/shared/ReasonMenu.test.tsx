/**
 * The chooser an act that says why opens (#863): one click on a line is the
 * act, "Other…" asks for a few words first, and a disabled one opens nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReasonMenu } from './ReasonMenu';

const REFUSAL = ['not-worth-a-visit', 'gone', 'other'] as const;

function renderMenu(props: { heading?: string; disabled?: boolean } = {}) {
  const onChoose = vi.fn();
  render(<ReasonMenu label="Turn away" reasons={REFUSAL} onChoose={onChoose} {...props} />);
  return onChoose;
}

describe('ReasonMenu', () => {
  it('lists the reasons in their words, with Other last, and acts on one click', () => {
    const onChoose = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    const lines = within(screen.getByRole('menu')).getAllByRole('menuitem').map(line => line.textContent);
    expect(lines).toEqual(['Nothing to see', 'Gone or not built', 'Other…']);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Gone or not built' }));
    expect(onChoose).toHaveBeenCalledWith('gone');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('asks for a few words under Other, and sends them with it', () => {
    const onChoose = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    expect(onChoose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('A few words'), { target: { value: '  a contested crossing  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn away' }));
    expect(onChoose).toHaveBeenCalledWith('other', 'a contested crossing');
  });

  it('takes Other with no words, since the words are optional', () => {
    const onChoose = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn away' }));
    expect(onChoose).toHaveBeenCalledWith('other', undefined);
  });

  it('acts on Enter, but not on the Enter an IME confirms its conversion with', () => {
    const onChoose = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    const field = within(screen.getByRole('dialog')).getByLabelText('A few words');
    fireEvent.change(field, { target: { value: '国境' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    // Safari: the composition has ended, and the confirming keydown carries keyCode 229.
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('other', '国境');
  });

  it('takes nothing when the words are cancelled', () => {
    const onChoose = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('says what the reasons are about where its label does not', () => {
    renderMenu({ heading: 'Why the arrivals are turned away' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn away' }));
    expect(within(screen.getByRole('menu')).getByText('Why the arrivals are turned away')).toBeInTheDocument();
  });

  it('opens nothing while disabled', () => {
    const onChoose = renderMenu({ disabled: true });
    const button = screen.getByRole('button', { name: 'Turn away' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
