/**
 * What an admin reads in a curator's trail.
 *
 * The same rows as an object's History, asked a different question — what has this
 * person done. Answered with the machine's word for the column, run
 * through `action.replace(/_/g, ' ')`, it reads `admission overridden`, `location marked
 * former`, `accepted source`; a six-entry colour map of its own would name the same six
 * acts the History's table names, with neither knowing about the other, which is how one
 * screen gets fixed and the other is left saying the opposite thing about one act.
 *
 * The chip's words come from `ACTION_LABELS`, keyed by the vocabulary both sides import
 * (`@tyr/shared/curationLog`, ADR-0065) and held to the schema's CHECK by a type, so what
 * holds this screen to the acts the database accepts is the typecheck.
 * This pins the wiring: that the label reaching an admin is the product's word for the
 * act, and the payload stays underneath, an audit rather than a story.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CuratorPanel } from './CuratorPanel';
import { listCurators, getCuratorActivity, revokeCuratorAssignment } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  listCurators: vi.fn(),
  createCuratorAssignment: vi.fn(),
  revokeCuratorAssignment: vi.fn(),
  getCuratorActivity: vi.fn(),
  searchUsers: vi.fn(),
  getSources: vi.fn(),
}));
vi.mock('../../api/worldViews', async () => ({ fetchWorldViews: vi.fn().mockResolvedValue([]) }));
vi.mock('../../hooks/useAuth', async () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

const mockedCurators = listCurators as unknown as ReturnType<typeof vi.fn>;
const mockedActivity = getCuratorActivity as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(revokeCuratorAssignment).mockReset();
  mockedCurators.mockReset().mockResolvedValue([
    {
      user_id: 7,
      email: 'curator@example.com',
      display_name: 'A curator',
      role: 'curator',
      avatar_url: null,
      scopes: [],
    },
  ]);
  // Villa Farnesina's own row, as the development database holds it.
  mockedActivity.mockReset().mockResolvedValue({
    total: 1,
    limit: 50,
    offset: 0,
    activity: [{
      id: 41,
      action: 'admission_overridden',
      created_at: '2026-08-09T11:02:00Z',
      details: { reason: 'site, not a venue: villa', note: null, published: true },
      experience_id: 6287,
      experience_name: 'Villa Farnesina',
      region_id: 6967,
      region_name: 'Lazio',
    }],
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CuratorPanel />
    </QueryClientProvider>,
  );
}

describe('a curator’s activity, as an admin reads it', () => {
  it('shows an administrator’s role-based scope without offering to revoke it, and opens their trail', async () => {
    mockedCurators.mockResolvedValue([{
      user_id: 1, email: 'admin@example.com', display_name: 'Administrator',
      role: 'admin', avatar_url: null, scopes: [],
    }]);
    renderPanel();

    expect(await screen.findByText('Global, by role')).toBeInTheDocument();
    expect(screen.queryByTestId('DeleteIcon')).not.toBeInTheDocument();
    // The admin is always listed, so "nobody holds an assignment" is the
    // state the hint to promote someone is for.
    expect(screen.getByText(/No scopes assigned yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /view activity/i }));
    expect(await screen.findByText('Villa Farnesina')).toBeInTheDocument();
    expect(mockedActivity).toHaveBeenCalledWith(1);
  });

  it.each(['admin', 'curator'])('keeps real assignments revocable for a %s', async (role) => {
    vi.mocked(revokeCuratorAssignment).mockResolvedValue({
      success: true, assignmentId: 12, userId: 7, roleReverted: false, remainingAssignments: 0,
    });
    mockedCurators.mockResolvedValue([{
      user_id: 7, email: 'curator@example.com', display_name: 'A curator',
      role, avatar_url: null,
      scopes: [{
        id: 77, scopeType: 'region', regionId: 3, regionName: 'Algeria',
        sourceId: null, sourceName: null, assignedAt: '2026-08-23T10:00:00Z', notes: null,
      }],
    }]);
    renderPanel();

    expect(await screen.findByText('Algeria')).toBeInTheDocument();
    expect(screen.queryByText('Global, by role') !== null).toBe(role === 'admin');
    expect(screen.queryByText(/No scopes assigned yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('DeleteIcon'));
    await waitFor(() => expect(vi.mocked(revokeCuratorAssignment)).toHaveBeenCalledWith(77));
  });

  it('names the act in the product’s words, not the column’s', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /view activity/i }));

    expect(await screen.findByText('Put back')).toBeInTheDocument();
    expect(screen.queryByText('admission overridden')).not.toBeInTheDocument();
    expect(screen.getByText('Villa Farnesina')).toBeInTheDocument();
  });
});
