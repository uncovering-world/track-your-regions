/**
 * A curator's correction of whom a place commemorates (#2144): the subjects as
 * chips that can be removed, and a search that adds a person or an event, each
 * option told apart from its namesakes by its description.
 */

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/curation', () => ({
  searchCommemorationSubjects: vi.fn(),
}));

import { searchCommemorationSubjects } from '../../api/curation';
import { CommemoratesField, type CommemoratedSubjectValue, type SubjectLine } from './CommemoratesField';

const mockedSearch = searchCommemorationSubjects as unknown as ReturnType<typeof vi.fn>;

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { item: 'Q15756', label: 'Dmitry Pozharsky', articleUrl: 'https://en.wikipedia.org/wiki/Dmitry_Pozharsky' };
const MININ = { item: 'Q469785', label: 'Kuzma Minin', articleUrl: null };

/** The field with its list held as the dialog's form holds it, and every list it sent. */
function renderField(initial: CommemoratedSubjectValue[], elsewhere: CommemoratedSubjectValue[] = [], line: SubjectLine = 'commemorates') {
  const sent: CommemoratedSubjectValue[][] = [];
  function Held() {
    const [subjects, setSubjects] = useState(initial);
    return (
      <CommemoratesField
        line={line}
        subjects={subjects}
        elsewhere={elsewhere}
        onChange={(next) => { sent.push(next); setSubjects(next); }}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Held /></QueryClientProvider>);
  return sent;
}

beforeEach(() => mockedSearch.mockReset());

describe('CommemoratesField', () => {
  it('shows each subject as a chip, and says so where the list names nobody', () => {
    renderField([POZHARSKY, MININ]);
    expect(screen.getByText('Dmitry Pozharsky')).toBeInTheDocument();
    expect(screen.getByText('Kuzma Minin')).toBeInTheDocument();
    expect(screen.queryByText('Nobody named')).toBeNull();
  });

  it('removes a subject, down to nobody, and sends the list that is left', () => {
    const sent = renderField([POZHARSKY, MININ]);

    fireEvent.click(screen.getByTitle('Remove Dmitry Pozharsky'));
    expect(sent.at(-1)).toEqual([MININ]);
    expect(screen.queryByText('Dmitry Pozharsky')).toBeNull();

    fireEvent.click(screen.getByTitle('Remove Kuzma Minin'));
    expect(sent.at(-1)).toEqual([]);
    expect(screen.getByText('Nobody named')).toBeInTheDocument();
  });

  it('finds a person by name, tells namesakes apart by their descriptions, and adds the one picked', async () => {
    // "Lincoln" as a curator correcting the Lincoln Memorial types it.
    mockedSearch.mockResolvedValue([
      { item: 'Q91', label: 'Abraham Lincoln', description: 'president of the United States from 1861 to 1865',
        articleUrl: 'https://en.wikipedia.org/wiki/Abraham_Lincoln' },
      { item: 'Q213559', label: 'Lincoln Memorial', description: 'memorial in Washington, D.C.',
        articleUrl: 'https://en.wikipedia.org/wiki/Lincoln_Memorial' },
      // Already listed, so not offered again.
      { item: 'Q469785', label: 'Kuzma Minin', description: 'merchant', articleUrl: null },
    ]);
    const sent = renderField([MININ]);

    const box = screen.getByLabelText('Add a person or event');
    // Focused first, as a curator's typing is: an unfocused field puts its text back.
    box.focus();
    fireEvent.change(box, { target: { value: 'Lincoln' } });

    expect(await screen.findByText(/president of the United States from 1861 to 1865/)).toBeInTheDocument();
    expect(screen.getByText(/memorial in Washington, D\.C\./)).toBeInTheDocument();
    expect(mockedSearch).toHaveBeenCalledWith('Lincoln');
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.click(screen.getByRole('option', { name: /Abraham Lincoln/ }));

    expect(sent.at(-1)).toEqual([MININ, {
      item: 'Q91', label: 'Abraham Lincoln', articleUrl: 'https://en.wikipedia.org/wiki/Abraham_Lincoln',
    }]);
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.getByTitle('Remove Abraham Lincoln')).toBeInTheDocument();
  });

  it('never offers a subject the other line lists (#2421)', async () => {
    mockedSearch.mockResolvedValue([
      { item: 'Q15756', label: 'Dmitry Pozharsky', description: 'Russian prince', articleUrl: null },
      { item: 'Q469785', label: 'Kuzma Minin', description: 'merchant', articleUrl: null },
    ]);
    renderField([], [POZHARSKY]);

    const box = screen.getByLabelText('Add a person or event');
    box.focus();
    fireEvent.change(box, { target: { value: 'Minin' } });

    expect(await screen.findByText(/merchant/)).toBeInTheDocument();
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([expect.stringContaining('Kuzma Minin')]);
  });

  it('asks nothing for a single letter', async () => {
    renderField([]);
    const box = screen.getByLabelText('Add a person or event');
    box.focus();
    fireEvent.change(box, { target: { value: 'L' } });
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  describe('the form each figure is shown in (#2485)', () => {
    // The Lady Godiva equestrian statue (Q17540305) depicts Lady Godiva (Q106077) as an equestrian.
    const GODIVA = { item: 'Q106077', label: 'Lady Godiva', articleUrl: null };

    /** Types a name in the search and picks the option it finds. */
    async function addBySearch(name: string) {
      const box = screen.getByLabelText('Add a figure');
      box.focus();
      fireEvent.change(box, { target: { value: name } });
      fireEvent.click(await screen.findByRole('option', { name: accessible => accessible.includes(name) }));
      await waitFor(() => expect(box).toHaveValue(''));
    }

    it('gives every figure added while "Shown as" holds a role that role, and keeps the box filled', async () => {
      mockedSearch.mockImplementation(async (query: string) => [POZHARSKY, MININ, GODIVA]
        .filter(subject => subject.label.includes(query))
        .map(subject => ({ ...subject, description: null })));
      const sent = renderField([GODIVA], [], 'depicts');

      fireEvent.change(screen.getByLabelText('Shown as'), { target: { value: 'as  warriors ' } });
      await addBySearch('Pozharsky');
      await addBySearch('Minin');

      expect(sent.at(-1)).toEqual([GODIVA, { ...POZHARSKY, role: 'warriors' }, { ...MININ, role: 'warriors' }]);
      expect(screen.getByLabelText('Shown as')).toHaveValue('as  warriors ');
      expect(screen.getByRole('group', { name: 'Shown as warriors' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'No role' })).toBeInTheDocument();
    });

    it('asks no role on the line of whom a place commemorates', () => {
      renderField([MININ]);
      expect(screen.queryByLabelText('Shown as')).toBeNull();
    });

    it("sets, changes and clears one figure's role from its menu", () => {
      const sent = renderField([GODIVA, { ...MININ, role: 'warrior' }], [], 'depicts');

      fireEvent.click(screen.getByRole('button', { name: 'What Lady Godiva is shown as' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'as warrior' }));
      expect(sent.at(-1)).toEqual([{ ...GODIVA, role: 'warrior' }, { ...MININ, role: 'warrior' }]);

      fireEvent.change(screen.getByLabelText('Shown as'), { target: { value: 'equestrian' } });
      fireEvent.click(screen.getByRole('button', { name: 'What Lady Godiva is shown as' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'as equestrian' }));
      expect(sent.at(-1)).toEqual([{ ...GODIVA, role: 'equestrian' }, { ...MININ, role: 'warrior' }]);

      fireEvent.click(screen.getByRole('button', { name: 'What Kuzma Minin is shown as' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'No role' }));
      // No role is no key, the shape a subject without one always had.
      expect(sent.at(-1)?.[1]).toEqual(MININ);
    });

    it("renames a group's role for every figure in it, and takes it off them all", () => {
      const sent = renderField([{ ...POZHARSKY, role: 'warrior' }, { ...MININ, role: 'warrior' }, GODIVA], [], 'depicts');

      fireEvent.click(screen.getByRole('button', { name: 'Rename the role warrior' }));
      const rename = within(screen.getByRole('group', { name: 'Shown as warrior' })).getByLabelText('Role of these figures');
      fireEvent.change(rename, { target: { value: 'heroes' } });
      fireEvent.keyDown(rename, { key: 'Enter' });
      expect(sent.at(-1)).toEqual([{ ...POZHARSKY, role: 'heroes' }, { ...MININ, role: 'heroes' }, GODIVA]);

      fireEvent.click(screen.getByRole('button', { name: 'Take the role heroes off these figures' }));
      expect(sent.at(-1)).toEqual([POZHARSKY, MININ, GODIVA]);
      expect(screen.queryByRole('group', { name: 'No role' })).toBeNull();
    });
  });
});
