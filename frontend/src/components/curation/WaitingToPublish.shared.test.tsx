/**
 * A fact two kinds' runs both propose, asked once (#1599).
 *
 * The Vatican Museums as the development catalogue held them on 2026-10-16:
 * the Art Museums run 170 and the Archaeology run 169 both propose AD 120 for
 * the Apollo Belvedere's year, and the same website for the museum. The
 * Archaeology run also proposes a description of its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HeldPart, ProposedField, ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  publishExperience: vi.fn(),
}));

import { publishExperience } from '../../api/curation';
import { GatedCard, groupGated } from './WaitingToPublish';
import { rowQuestionWord } from './feed/rowSpecific';
import { toAnswerRows } from './selection/answerRows';
import type { QueueRow } from './queueRows';
import { sectionsKinds } from './gatedGroup';

const mockedPublish = vi.mocked(publishExperience);

beforeEach(() => {
  mockedPublish.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof publishExperience>>);
});

const PLACE = { id: 6192, external_id: 'Q182955', name: 'Vatican Museums' };
const WEBSITE: ProposedField = { field: 'metadata.website', old: null, new: 'https://www.museivaticani.va', held: true };
const DESCRIPTION: ProposedField = { field: 'description', old: 'A museum.', new: 'Museums of the Vatican City.', held: true };
const apollo = (year: number): HeldPart => ({
  kind: 'treasures', item: { ref: 'Q619135', name: 'Apollo Belvedere' },
  fields: [{ field: 'year', old: -350, new: year, held: true }],
});

function held(kind: 'Art Museums' | 'Archaeology', over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  const art = kind === 'Art Museums';
  return {
    ...PLACE, kind: 'held', kind_id: art ? 2 : 5, kind_name: kind, membership_id: art ? 30 : 31,
    sync_log_id: art ? 170 : 169,
    missing_since: null, source_membership: 'present', existence: 'extant',
    pending_locations: 0, pending_treasures: 0, pending_points: [], pending_works: [],
    proposed: [WEBSITE], proposed_parts: [apollo(120)],
    ...over,
  };
}

const sectionsOf = (...items: ReviewQueueItem[]) => groupGated([], items, []).get(PLACE.id)!;

function renderCard(items: ReviewQueueItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard sections={sectionsOf(...items)} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

describe('a fact two kinds propose alike', () => {
  it('is lifted into one section for the place, leaving each kind what it asks alone', () => {
    const sections = sectionsOf(held('Art Museums'), held('Archaeology', { proposed: [WEBSITE, DESCRIPTION] }));

    expect(sections.map(group => group.sharedBy?.map(run => run.kindName) ?? group.held?.kind_name)).toEqual([
      ['Art Museums', 'Archaeology'],
      'Archaeology',
    ]);
    expect(sections[0].held?.proposed).toEqual([WEBSITE]);
    expect(sections[0].held?.proposed_parts).toEqual([apollo(120)]);
    expect(sections[1].held?.proposed).toEqual([DESCRIPTION]);
    expect(sections[1].held?.proposed_parts).toEqual([]);
  });

  it('names every run that proposes it, and publishes it under the first kind alone', async () => {
    renderCard([held('Art Museums'), held('Archaeology', { proposed: [WEBSITE, DESCRIPTION] })]);

    expect(screen.getByText('This place')).toBeInTheDocument();
    expect(screen.queryByText('Art Museums asks')).toBeNull();
    expect(screen.getByText('Archaeology asks')).toBeInTheDocument();
    const place = within(screen.getByText('This place').parentElement!);
    expect(place.getByText(/Art Museums run 170 and Archaeology run 169 propose/)).toBeInTheDocument();

    fireEvent.click(place.getByRole('button', { name: 'Publish what Art Museums and Archaeology propose alike' }));

    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(PLACE.id, {
      heldFields: ['metadata.website'],
      heldParts: [{ kind: 'treasures', ref: 'Q619135', name: 'Apollo Belvedere', fields: ['year'] }],
      expectedSyncLogId: 170,
      membershipId: 30,
    }));
  });

  it('leaves the kind\'s button publishing only what its own section shows', async () => {
    renderCard([held('Art Museums'), held('Archaeology', { proposed: [WEBSITE, DESCRIPTION] })]);

    fireEvent.click(screen.getByRole('button', { name: 'Publish everything Archaeology asks' }));

    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(PLACE.id, {
      heldFields: ['description'],
      expectedSyncLogId: 169,
      membershipId: 31,
    }));
  });

  it('publishes such a section\'s rows by name and then its unread contents, as one answer', async () => {
    const contents: ReviewQueueItem = {
      ...held('Archaeology'), kind: 'contents', proposed: null, proposed_parts: null, sync_log_id: null,
      pending_treasures: 1,
      pending_works: [{
        id: 3120, name: 'Belvedere Torso', artists: [], artistsCurated: false,
        year: null, imageUrl: null, iconic: false, externalId: 'Q1543041',
      }],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <GatedCard
          sections={groupGated([], [held('Art Museums'), held('Archaeology', { proposed: [WEBSITE, DESCRIPTION] })], [contents])
            .get(PLACE.id)!}
          onDone={() => {}}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish everything Archaeology asks' }));

    await waitFor(() => expect(mockedPublish).toHaveBeenCalledTimes(2));
    expect(mockedPublish.mock.calls.map(([, body]) => body)).toEqual([
      { heldFields: ['description'], expectedSyncLogId: 169, membershipId: 31 },
      { contentsOnly: true, membershipId: 31 },
    ]);
  });

  it('says what the first request wrote when the second fails', async () => {
    const contents: ReviewQueueItem = {
      ...held('Archaeology'), kind: 'contents', proposed: null, proposed_parts: null, sync_log_id: null,
      pending_treasures: 1,
      pending_works: [{
        id: 3120, name: 'Belvedere Torso', artists: [], artistsCurated: false,
        year: null, imageUrl: null, iconic: false, externalId: 'Q1543041',
      }],
    };
    mockedPublish
      .mockResolvedValueOnce({ appliedFields: ['description'], claimedFieldsSkipped: [], appliedParts: [] } as never)
      .mockRejectedValueOnce(new Error('The works could not be released'));
    const done = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <GatedCard
          sections={groupGated([], [held('Art Museums'), held('Archaeology', { proposed: [WEBSITE, DESCRIPTION] })], [contents])
            .get(PLACE.id)!}
          onDone={done}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish everything Archaeology asks' }));

    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0][0]).toMatch(/description[\s\S]*The works could not be released/i);
  });

  it('counts as one question on the list, and is answered in a batch under the first kind once', () => {
    const sections = sectionsOf(held('Art Museums'), held('Archaeology'));
    const row = { kind: 'waiting', id: PLACE.id, runId: null, sections } as unknown as QueueRow;

    expect(sections).toHaveLength(1);
    expect(sectionsKinds(sections)).toEqual(['Art Museums', 'Archaeology']);
    expect(rowQuestionWord(row)).not.toMatch(/questions/);
    // Under the first kind alone: the answer is recorded on the place by value,
    // which settles the other kind's copy, and a second row would find nothing open.
    expect(toAnswerRows(row).map(answer => [answer.membershipId, answer.runId])).toEqual([[30, 170]]);
  });
});

describe('a fact two later kinds propose alike', () => {
  it('is answered under the kind that shares the most, as Mỹ Sơn\'s are', () => {
    const wikipedia: ProposedField = { field: 'metadata.wikipediaUrl', old: null, new: 'https://en.wikipedia.org/wiki/My_Son', held: true };
    const qid: ProposedField = { field: 'metadata.wikidataQid', old: null, new: 'Q391406', held: true };
    const description: ProposedField = { field: 'description', old: null, new: 'Cham Hindu temples.', held: true };
    const run = (kindName: string, membership: number, runId: number, proposed: ProposedField[]): ReviewQueueItem => ({
      ...held('Art Museums'), kind_name: kindName, membership_id: membership, sync_log_id: runId, proposed, proposed_parts: [],
    });
    const sections = sectionsOf(
      run('World Heritage Sites', 40, 101, [wikipedia]),
      run('Places of worship', 41, 102, [description, qid, wikipedia]),
      run('Archaeology', 42, 103, [description, qid, wikipedia]),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].membershipId).toBe(41);
    expect(sections[0].held?.proposed).toEqual([description, qid, wikipedia]);
    expect(sections[0].sharedBy?.map(by => [by.kindName, by.proposesAll])).toEqual([
      ['World Heritage Sites', false], ['Places of worship', true], ['Archaeology', true],
    ]);
  });
});

describe('a section whose runs propose only some of its facts', () => {
  it('names those runs apart, and its button names no kind', () => {
    const wikipedia: ProposedField = { field: 'metadata.wikipediaUrl', old: null, new: 'https://en.wikipedia.org/wiki/My_Son', held: true };
    const qid: ProposedField = { field: 'metadata.wikidataQid', old: null, new: 'Q391406', held: true };
    const description: ProposedField = { field: 'description', old: null, new: 'Cham Hindu temples.', held: true };
    const picture: ProposedField = { field: 'imageUrl', old: null, new: 'https://upload.wikimedia.org/x.jpg', held: true };
    const run = (kindName: string, membership: number, runId: number, proposed: ProposedField[]): ReviewQueueItem => ({
      ...held('Art Museums'), kind_name: kindName, membership_id: membership, sync_log_id: runId, proposed, proposed_parts: [],
    });
    renderCard([
      run('World Heritage Sites', 40, 101, [wikipedia]),
      run('Places of worship', 41, 102, [description, qid, wikipedia, picture]),
      run('Archaeology', 42, 103, [description, qid]),
    ]);

    const place = within(screen.getByText('This place').parentElement!);
    expect(place.getByText(
      'Places of worship run 102 proposes, and World Heritage Sites run 101 and Archaeology run 103 some of them',
      { exact: false },
    )).toBeInTheDocument();
    expect(place.getByRole('button', { name: 'Publish the place’s own facts' })).toBeInTheDocument();
    expect(screen.getByText('Places of worship asks')).toBeInTheDocument();
  });
});

describe('a fact two kinds propose differently, or a kind proposes for itself', () => {
  it('stays in each kind\'s section, answered on its own as before', () => {
    const sections = sectionsOf(
      held('Art Museums', { proposed: [] }),
      held('Archaeology', { proposed: [], proposed_parts: [apollo(130)] }),
    );

    expect(sections.map(group => group.sharedBy ?? group.held?.kind_name)).toEqual(['Art Museums', 'Archaeology']);
  });

  it('keeps the type within each kind, which is the membership\'s', () => {
    const type: ProposedField = { field: 'type', old: null, new: 'museum', held: true };
    const sections = sectionsOf(
      held('Art Museums', { proposed: [type], proposed_parts: [] }),
      held('Archaeology', { proposed: [type], proposed_parts: [] }),
    );

    expect(sections.every(group => group.sharedBy === undefined)).toBe(true);
    expect(sections.map(group => group.held?.proposed)).toEqual([[type], [type]]);
  });
});
