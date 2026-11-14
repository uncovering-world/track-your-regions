/**
 * A tick's answer reaches the offer of a date through the trips chunk, which
 * a tab's first tick fetches (#2120). A traveller forgotten while it is on its
 * way, by a sign-out or a refresh that returns another tab's account, is not
 * offered a date once it arrives: nothing is stored or written for them, and
 * no request goes out under the account signed in since.
 */
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const chunk = vi.hoisted(() => {
  let release = () => {};
  const arrived = new Promise<void>(resolve => { release = resolve; });
  return { arrived, release: () => release(), offerDate: vi.fn(), forgetOffer: vi.fn() };
});
vi.mock('./trips/visitTrips', async () => {
  await chunk.arrived;
  return { default: () => null, offerDate: chunk.offerDate, forgetOffer: chunk.forgetOffer };
});
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));

import './lazyVisitTrips';
import { forgetTraveller, noteTicked, writeOrigin } from './visitRemovals';

const client = new QueryClient();
const UFFIZI = { experienceId: 9461, name: 'Uffizi', latitude: 43.77, longitude: 11.26 };
const settle = async () => { await import('./trips/visitTrips'); await new Promise(resolve => setTimeout(resolve, 0)); };

describe('the offer of a date once its chunk arrives', () => {
  it('is not made for a traveller forgotten while the chunk was on its way', async () => {
    noteTicked(UFFIZI.experienceId, [UFFIZI], client, writeOrigin(7));
    forgetTraveller();
    chunk.release();
    await settle();
    expect(chunk.offerDate).not.toHaveBeenCalled();
  });

  it('is made for the traveller still signed in', async () => {
    const origin = writeOrigin(7);
    noteTicked(UFFIZI.experienceId, [UFFIZI], client, origin);
    await settle();
    expect(chunk.offerDate).toHaveBeenCalledWith(UFFIZI.experienceId, [UFFIZI], client, origin);
  });
});
