/**
 * What an admin reads in a curator's trail.
 *
 * The same rows as an object's History, asked a different question — what has this
 * person done — and until #691 answered with the machine's word for the column, run
 * through `action.replace(/_/g, ' ')`: `admission overridden`, `location marked former`,
 * `accepted source`. Its own six-entry colour map named the same six acts the History's
 * table did, and neither knew about the other, which is how one screen can be fixed and
 * the other left saying the opposite thing about one act.
 *
 * The chip's words come from `ACTION_LABELS` now, so what holds this screen to the twenty
 * the database accepts is the guard on that table (`curationLogActionLabels.test.ts`).
 * This pins the wiring: that the label reaching an admin is the product's word for the
 * act, and the payload stays underneath, an audit rather than a story.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CuratorPanel } from './CuratorPanel';
import { listCurators, getCuratorActivity } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  listCurators: vi.fn(),
  createCuratorAssignment: vi.fn(),
  revokeCuratorAssignment: vi.fn(),
  getCuratorActivity: vi.fn(),
  searchUsers: vi.fn(),
  getCategories: vi.fn(),
}));
vi.mock('../../api/worldViews', async () => ({ fetchWorldViews: vi.fn().mockResolvedValue([]) }));
vi.mock('../../hooks/useAuth', async () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

const mockedCurators = listCurators as unknown as ReturnType<typeof vi.fn>;
const mockedActivity = getCuratorActivity as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
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
  it('names the act in the product’s words, not the column’s', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /view activity/i }));

    expect(await screen.findByText('Put back')).toBeInTheDocument();
    expect(screen.queryByText('admission overridden')).not.toBeInTheDocument();
    expect(screen.getByText('Villa Farnesina')).toBeInTheDocument();
  });
});
