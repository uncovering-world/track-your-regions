import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../api/fetchUtils';
import type { WorldView } from '../api/worldViews';

const wikivoyage = {
  id: 2, name: 'Wikivoyage Regions', description: 'Imported from Wikivoyage region hierarchy (4308 regions)',
  source: 'English Wikivoyage', isDefault: false, isPublic: true, tileVersion: 3,
} as unknown as WorldView;
const gadm = { id: 1, name: 'GADM', description: null, source: null, isDefault: true, isPublic: true, tileVersion: 1 } as unknown as WorldView;

const loaded = () => ({
  worldViews: [gadm, wikivoyage] as WorldView[],
  selectedWorldView: wikivoyage as WorldView | null,
  setSelectedWorldView: vi.fn(),
  invalidateTileCache: vi.fn(),
  isLoading: false,
});
const navigation = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../hooks/useNavigation', () => ({ useNavigation: () => navigation.state }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }));

const createWorldView = vi.fn();
const updateWorldView = vi.fn();
vi.mock('../api', () => ({
  createWorldView: (...args: unknown[]) => createWorldView(...args),
  updateWorldView: (...args: unknown[]) => updateWorldView(...args),
  deleteWorldView: vi.fn(),
}));

const { HierarchySwitcher } = await import('./HierarchySwitcher');

beforeEach(() => { navigation.state = loaded(); });

function renderSwitcher() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <HierarchySwitcher />
    </QueryClientProvider>,
  );
}

function openMenuItem(label: string) {
  fireEvent.click(screen.getByTestId('MoreVertIcon'));
  fireEvent.click(screen.getByText(label));
}

/**
 * The world view dialogs go through the form layer (ADR-0076): they send what
 * changed, an emptied description as empty, and a refused field shows under
 * that field. The layer's rules themselves are `useEditForm.test.tsx`.
 */
describe('the world view settings dialog', () => {
  beforeEach(() => {
    updateWorldView.mockReset();
    createWorldView.mockReset();
  });

  it('sends only what changed, an emptied description as empty (#1133)', async () => {
    updateWorldView.mockResolvedValue(wikivoyage);
    renderSwitcher();
    openMenuItem('Settings');

    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateWorldView).toHaveBeenCalledWith(2, { description: '' }));
  });

  it('keeps Save asleep until something changes', () => {
    renderSwitcher();
    openMenuItem('Settings');

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('shows a refused name under the name, and stays open', async () => {
    updateWorldView.mockRejectedValue(new ApiError('Validation error — name: Too big', 400, 'Validation error', undefined,
      [{ path: 'name', message: 'Too big: expected string to have <=255 characters' }]));
    renderSwitcher();
    openMenuItem('Settings');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(300) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Too big: expected string to have <=255 characters')).toBeInTheDocument();
    expect(screen.getByText('World View Settings')).toBeInTheDocument();
  });
});

describe('the create dialog', () => {
  it('sends what was filled in, and no empty description', async () => {
    createWorldView.mockResolvedValue({ ...wikivoyage, id: 9, name: 'Cultural Regions' });
    renderSwitcher();
    openMenuItem('Create world view');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Cultural Regions ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createWorldView).toHaveBeenCalledWith({ name: 'Cultural Regions' }));
  });

  it('shows a refusal that names no field in the dialog', async () => {
    createWorldView.mockRejectedValue(new ApiError('Admin access required', 403, 'Admin access required', undefined));
    renderSwitcher();
    openMenuItem('Create world view');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cultural Regions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });
});

/**
 * The switcher holds its place while the world views load (#2376): rendered
 * late, it pushed the search and the region list 56 px down, the map view's
 * whole layout shift.
 */
describe('the world view select before the world views load', () => {
  it('holds the select\'s place while the world views load', () => {
    navigation.state = { ...loaded(), worldViews: [], selectedWorldView: null, isLoading: true };
    renderSwitcher();
    expect(screen.getByTestId('world-view-select-placeholder')).toBeInTheDocument();
    expect(screen.queryByLabelText('World View')).not.toBeInTheDocument();
  });

  it('holds it too between the load and the selection', () => {
    navigation.state = { ...loaded(), selectedWorldView: null };
    renderSwitcher();
    expect(screen.getByTestId('world-view-select-placeholder')).toBeInTheDocument();
  });

  it('shows nothing for a catalogue that holds no world view, and the select once one is chosen', () => {
    navigation.state = { ...loaded(), worldViews: [], selectedWorldView: null };
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><HierarchySwitcher /></QueryClientProvider>);
    expect(screen.queryByTestId('world-view-select-placeholder')).not.toBeInTheDocument();
    unmount();
    navigation.state = loaded();
    renderSwitcher();
    expect(screen.queryByTestId('world-view-select-placeholder')).not.toBeInTheDocument();
    expect(screen.getByLabelText('World View')).toBeInTheDocument();
  });
});
