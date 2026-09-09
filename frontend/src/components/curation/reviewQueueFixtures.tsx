/**
 * What the review page's two test files both need: a queue answer in the endpoint's own
 * shape, the rows to fill it with, and the page rendered at an address.
 *
 * Shared rather than copied because the two files ask different questions of the same
 * screen — `ReviewQueue.test.tsx` about the cards a curator answers, `ReviewPage.test.tsx`
 * about the list the address names — and a second copy of the fixtures is what drifts when
 * the endpoint's shape changes again.
 *
 * Each test file still declares its own `vi.mock` of `../../api/experiences`: a module mock
 * belongs to the file that installs it. What it answers with is `shaped`, below.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import {
  MemoryRouter, useLocation, useNavigate, useNavigationType,
} from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewPage } from './ReviewPage';

/** A row of any kind, as a case cares to state it. */
export interface Row { id: number; [key: string]: unknown }

/** What a case says about one read; everything it leaves out, `shaped` fills in. */
export interface QueuePatch {
  missing?: Row[];
  refused?: Row[];
  conflicts?: Row[];
  keptOut?: Row[];
  arrivals?: Row[];
  held?: Row[];
  contents?: Row[];
  withdrawn?: Row[];
  answeredWithdrawals?: Row[];
  refusedParts?: Row[];
  limit?: number;
  total?: number;
  order?: unknown[];
  facets?: unknown;
  paging?: {
    cursor?: string | null;
    nextCursor?: string | null;
    keptOut?: { offset: number; hasMore: boolean };
    answeredWithdrawals?: { offset: number; hasMore: boolean };
    refusedParts?: { offset: number; hasMore: boolean };
  };
}

type Sub = 'arrival' | 'held' | 'contents';

/** When the run that asked these questions finished, and which run it was. */
export const ASKED_AT = '2026-09-05T10:00:00Z';
const RUN_ID = 98;

/** No counts at all, but every field the toolbar reads — an unfiltered, unrun catalogue. */
export const NO_FACETS = {
  kind: [], source: [], region: [], run: [], setAside: { batches: 0 },
};

/**
 * The page's `order`, derived from whichever arrays the case supplied.
 *
 * Kind order rather than date order, and written here rather than in every fixture: what
 * the server's keys phase chooses is its own test's claim (`reviewQueueKeys`) and
 * `queueRows.test.ts`'s, while every case in these files is about a card, a control or the
 * address. The three gated kinds collapse to one entry per object, as the endpoint's own
 * order does.
 */
function orderOf(over: QueuePatch): unknown[] {
  const list: unknown[] = [];
  const push = (kind: string, id: number, subs: Sub[] = []) => list.push({
    kind, id, askedAt: ASKED_AT, runId: RUN_ID, subs,
  });

  (over.conflicts ?? []).forEach(item => push('conflict', item.id));

  const gated = new Map<number, Sub[]>();
  const note = (rows: Row[] | undefined, sub: Sub) => (rows ?? []).forEach(item => {
    gated.set(item.id, [...(gated.get(item.id) ?? []), sub]);
  });
  note(over.arrivals, 'arrival');
  note(over.held, 'held');
  note(over.contents, 'contents');
  gated.forEach((subs, id) => push('waiting', id, subs));

  (over.withdrawn ?? []).forEach(item => push('withdrawn', item.id));
  (over.refused ?? []).forEach(item => push('refused', item.id));
  (over.missing ?? []).forEach(item => push('missing', item.id));
  return list;
}

/**
 * One read's answer in the endpoint's own shape.
 *
 * A case states only what it is about; this fills in the parts no card test cares for —
 * the `order` the page draws its rows from, the filtered `total`, the `facets` the toolbar
 * counts with, and the one cursor the union pages by (ADR-0051). A case that *is* about
 * one of them states it, and what it states is kept.
 */
export function shaped(over: QueuePatch = {}) {
  const order = over.order ?? orderOf(over);
  return {
    missing: [],
    refused: [],
    conflicts: [],
    keptOut: [],
    arrivals: [],
    held: [],
    contents: [],
    withdrawn: [],
    answeredWithdrawals: [],
    refusedParts: [],
    limit: 25,
    ...over,
    order,
    total: over.total ?? order.length,
    facets: over.facets ?? NO_FACETS,
    paging: {
      cursor: null,
      nextCursor: null,
      keptOut: { offset: 0, hasMore: false },
      answeredWithdrawals: { offset: 0, hasMore: false },
      refusedParts: { offset: 0, hasMore: false },
      ...over.paging,
    },
  };
}

export const MISSING = {
  id: 77,
  external_id: '1234',
  name: 'Dresden Elbe Valley',
  category_id: 1,
  category_name: 'UNESCO World Heritage Sites',
  missing_since: '2026-08-03T10:00:00Z',
  source_membership: 'present' as const,
  existence: 'extant' as const,
  kind: 'missing' as const,
  proposed: null,
};

export const REFUSED = {
  ...MISSING,
  id: 99,
  external_id: 'Q6373',
  name: 'British Museum',
  category_id: 2,
  category_name: 'Art Museums',
  kind: 'refused' as const,
  missing_since: null,
  admission_reason: 'not an art museum — archaeology',
};

export const KEPT_OUT = {
  ...REFUSED,
  kind: 'kept-out' as const,
  state_decided_at: '2026-08-08T09:00:00Z',
  state_note: 'archaeology, comes back with that import',
};

/**
 * An object holding one turned-down point and one turned-down work (#859).
 *
 * Both kinds on one row on purpose: a museum can lose a branch and a painting to
 * the same click, and the card has to label them apart. The counts are larger
 * than the lists, which is what the cap line is for.
 */
export const REFUSED_PARTS = {
  ...MISSING,
  id: 6188,
  external_id: 'Q23402',
  name: "Musée d'Orsay",
  category_id: 2,
  category_name: 'Art Museums',
  kind: 'contents-refused' as const,
  missing_since: null,
  // The server's own verdict on whether the take-back would be accepted; a case
  // about a blocked object sets it false and says why.
  takeable: true,
  object_admission: 'admitted',
  object_curation_state: 'auto',
  refused_points_total: 2,
  refused_points: [{
    id: 4101,
    name: 'Pavillon Amont',
    externalRef: null,
    latitude: 48.8601,
    longitude: 2.3265,
    curatedFields: [],
    refusedAt: '2026-09-09T12:00:00Z',
    refusedBy: 'Camille',
    note: 'the annexe, not the museum',
    missingSince: null,
    visited: false,
  }],
  refused_works_total: 3,
  // The work is the branch the points do not cover: turned down, and since then
  // dropped by the source. Taking it back restores the question and nothing else,
  // which is the whole reason the offered filter came off the list and the writer
  // — a part in this state is on no other screen, and its card has to say so.
  refused_works: [{
    id: 14341,
    name: 'The Oreads',
    artists: ['William-Adolphe Bouguereau'],
    artistsCurated: false,
    year: 1902,
    externalId: 'Q16372213',
    curatedFields: [],
    refusedAt: '2026-09-09T12:00:00Z',
    refusedBy: null,
    note: null,
    missingSince: '2026-09-09T18:00:00Z',
  }],
};

export const CONFLICT = {
  ...MISSING,
  id: 88,
  name: 'Serengeti National Park',
  kind: 'conflict' as const,
  missing_since: null,
  proposed: [{ field: 'name', old: 'Curator wording', new: 'Renamed upstream', acceptable: true }],
  sync_log_id: 41,
};

export const ARRIVAL = {
  ...MISSING,
  id: 55,
  external_id: 'Q160236',
  name: 'Museo Soumaya',
  category_id: 2,
  category_name: 'Art Museums',
  kind: 'arrival' as const,
  missing_since: null,
  curation_state: 'pending',
  // The run that first saw it, not a held pointer — see the test that pins
  // what the publish body may carry for an arrival.
  sync_log_id: 61,
};

export const HELD = {
  ...MISSING,
  id: 7,
  external_id: 'Q160112',
  name: 'Museo del Prado',
  category_id: 2,
  category_name: 'Art Museums',
  kind: 'held' as const,
  missing_since: null,
  proposed: [{ field: 'name', old: 'Prado', new: 'Museo Nacional del Prado', held: true }],
  sync_log_id: 47,
};

export const CONTENTS = {
  ...HELD,
  kind: 'contents' as const,
  proposed: null,
  sync_log_id: undefined,
  pending_locations: 1,
  pending_treasures: 12,
};

/**
 * The address the router is at, how it was last written, and the browser's Back, rendered
 * beside the page.
 *
 * The selection lives in the URL now (ADR-0051 decision 5), so what a click did and what
 * the page corrected on its own are both readable here — and they are different acts: a
 * curator's choice is pushed, a selection the page moves for them is replaced. Back is a
 * control rather than a call because `MemoryRouter` keeps a history of its own, which
 * `window.history.back()` does not touch; it is the only way to reach the one transition
 * that changes the filter *and* restores a row in a single commit.
 *
 * The URL sits in its own node so `at()` reads the address and not the button's label.
 */
function AddressProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="address" data-nav={useNavigationType()}>
        {`${location.pathname}${location.search}`}
      </div>
      <button type="button" onClick={() => navigate(-1)}>history back</button>
    </div>
  );
}

/** The browser's Back, as a test can press it. */
export const goBack = () => fireEvent.click(screen.getByRole('button', { name: 'history back' }));

export const at = () => screen.getByTestId('address').textContent;
export const navType = () => screen.getByTestId('address').getAttribute('data-nav');

/**
 * The page, not the cards.
 *
 * These assertions are about what a curator can do — answer, be told what happened, reach
 * what is behind a page — and none of them was about the single-column layout the page used
 * to have. The screen is now a list beside a bench, which selects the first question on its
 * own, so a queue holding one of something opens on it exactly as before.
 *
 * `entry` is the address the page opens at: the filters it asks the queue for and the row
 * it opens on come out of it.
 */
export function renderQueue(entry = '/review') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ReviewPage />
        <AddressProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Open one question, where the queue holds more than one.
 *
 * The page selects the first row on its own, so a queue with a single question needs no
 * click. With several, the bench shows one at a time — which is the change — and a test
 * about a particular card has to say which.
 */
export async function openRow(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}
