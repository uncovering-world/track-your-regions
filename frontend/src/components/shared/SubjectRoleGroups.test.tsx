/**
 * The role groups of a subject line (#2485): a rename opened before the
 * dialog started saving is disabled with the rest of the field, and commits
 * nothing over the save.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SubjectRoleGroups } from './SubjectRoleGroups';

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { item: 'Q15756', label: 'Dmitry Pozharsky', articleUrl: null, role: 'warrior' };
const MININ = { item: 'Q469785', label: 'Kuzma Minin', articleUrl: null, role: 'warrior' };

describe('SubjectRoleGroups (#2485)', () => {
  it('disables an open rename when the field is disabled, and commits nothing from it', () => {
    const onChange = vi.fn();
    const props = { subjects: [POZHARSKY, MININ], onChange, other: 'Commemorates', typedRole: '' };
    const { rerender } = render(<SubjectRoleGroups {...props} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename the role warrior' }));
    fireEvent.change(screen.getByLabelText('Role of these figures'), { target: { value: 'heroes' } });
    rerender(<SubjectRoleGroups {...props} disabled />);

    const rename = screen.getByLabelText('Role of these figures');
    expect(rename).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    fireEvent.keyDown(rename, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
