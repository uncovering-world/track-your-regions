/**
 * Tests for the arrived half of the review card (#524): one row per unread work
 * and per new point, each with its own answer, and a point the source moved
 * asked as a change beside the held fields.
 *
 * A curator deciding about twelve paintings that arrived since anyone looked
 * decides by looking at twelve paintings, and one doubtful painting must not
 * hold back the eleven beside it. What is pinned here is the wiring: which row
 * opens what, which ids an answer sends, and which rows are not drawn at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

// The dialogs are the shared surfaces a place and a work are looked at and
// corrected in, with their own tests; what this file pins is which row opens,
// as which place or work of which object, and where the outcome line goes.
vi.mock('../shared/PointPreviewDialog', () => ({
  PointPreviewDialog: ({ name, correction }: {
    name: string;
    correction?: {
      place: { locationId: number; objectName: string; name: string | null; unseen?: string };
      onDone: (m: string) => void;
    };
  }) => (
    <div role="dialog">
      <span>{`opened ${name}`}</span>
      {correction && <span>{`unseen=${String(correction.place.unseen)}`}</span>}
      {correction && (
        <button onClick={() => correction.onDone(`fixed ${correction.place.locationId} of ${correction.place.objectName}`)}>
          fix
        </button>
      )}
    </div>
  ),
}));
vi.mock('../shared/WorkPreviewDialog', () => ({
  WorkPreviewDialog: ({ work }: { work: { treasureId: number; experienceId: number; museumName: string; name: string } | null }) => (
    work ? <div role="dialog">{`opened work ${work.treasureId} of ${work.experienceId} (${work.museumName})`}</div> : null
  ),
}));
vi.mock('../../api/curation', async (original) => ({
  ...await original<typeof import('../../api/curation')>(),
  publishExperience: vi.fn(),
  refuseContents: vi.fn(),
}));

import { publishExperience, refuseContents } from '../../api/curation';
import { GatedCard } from './WaitingToPublish';

const mockedPublish = vi.mocked(publishExperience);
const mockedRefuse = vi.mocked(refuseContents);

beforeEach(() => {
  mockedPublish.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof publishExperience>>);
  mockedRefuse.mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof refuseContents>>);
});

type Work = NonNullable<ReviewQueueItem['pending_works']>[number];
type Point = NonNullable<ReviewQueueItem['pending_points']>[number];

/** Gemäldegalerie Berlin with unread works under it. */
function contents(...works: Work[]): ReviewQueueItem {
  return {
    id: 6194, external_id: 'Q165631', name: 'Gemäldegalerie Berlin',
    kind_id: 2, kind_name: 'Art Museums',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'contents', proposed: null,
    pending_locations: 0, pending_treasures: works.length,
    pending_points: [], pending_works: works,
  };
}

/** Champagne Hillsides with unread components under it — nine on the live database. */
function points(...rows: Point[]): ReviewQueueItem {
  return {
    id: 1345, external_id: '1465', name: 'Champagne Hillsides, Houses and Cellars',
    kind_id: 1, kind_name: 'World Heritage Sites',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'contents', proposed: null,
    pending_locations: rows.length, pending_treasures: 0,
    pending_points: rows, pending_works: [],
  };
}

function cardFor(item: ReviewQueueItem, onDone: (message?: string) => void, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <GatedCard group={{ id: item.id, name: item.name, contents: item }} onDone={onDone} />
    </QueryClientProvider>
  );
}

function renderCard(item: ReviewQueueItem, onDone: (message?: string) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(cardFor(item, onDone, client));
}

const WINE_GLASS: Work = {
  id: 3102, name: 'The Wine Glass', artists: ['Johannes Vermeer'], artistsCurated: false,
  year: 1659, imageUrl: null, iconic: false, externalId: 'Q782639', sitelinks: 41,
};
const HOLZSCHUHER: Work = {
  id: 3103, name: 'Portrait of Hieronymus Holzschuher', artists: ['Albrecht Dürer'],
  artistsCurated: false, year: 1526, imageUrl: null, iconic: false, externalId: 'Q3399389',
};

/** The table row a name stands in. */
function rowOf(name: string): HTMLElement {
  return screen.getByRole('button', { name }).closest('tr')!;
}

describe('the works that arrived', () => {
  it('opens each work by its name, and its article by a link named for the work', () => {
    // Two works, because the article links all read "Wikipedia": a screen
    // reader's link list has to say which work each one opens.
    renderCard(contents(WINE_GLASS, HOLZSCHUHER));

    const article = screen.getByRole('link', { name: 'Wikipedia article for The Wine Glass' });
    expect(article).toHaveTextContent('Wikipedia');
    expect(article).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q782639');
    expect(article).toHaveAttribute('target', '_blank');
    expect(article).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Wikipedia article for Portrait of Hieronymus Holzschuher' }))
      .toHaveAttribute('href', 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q3399389');

    // The maker and the year under the name, the Wikidata item as the small id,
    // and how many Wikipedias write about it — the number the pool's line held
    // it to (ADR-0082). A work the server sent without the count says nothing.
    const row = within(rowOf('The Wine Glass'));
    expect(row.getByText('Johannes Vermeer · 1659')).toBeInTheDocument();
    expect(row.getByText('Q782639')).toBeInTheDocument();
    expect(row.getByText('41 Wikipedia editions')).toBeInTheDocument();
    expect(within(rowOf('Portrait of Hieronymus Holzschuher')).queryByText(/Wikipedia edition/)).toBeNull();

    // The name is the one door to the work, opened as a work of this museum.
    fireEvent.click(screen.getByRole('button', { name: 'The Wine Glass' }));
    expect(screen.getByText('opened work 3102 of 6194 (Gemäldegalerie Berlin)')).toBeInTheDocument();
  });

  it('still opens a work an older server sent without its item, and links no article', () => {
    renderCard(contents({ ...WINE_GLASS, externalId: undefined }));

    expect(screen.getByRole('button', { name: 'The Wine Glass' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Wikipedia/ })).toBeNull();
  });

  it('answers one work on its own row, leaving the rest waiting', async () => {
    renderCard(contents(WINE_GLASS, HOLZSCHUHER));

    fireEvent.click(within(rowOf('Portrait of Hieronymus Holzschuher')).getByRole('button', { name: 'publish this' }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(6194, { treasureIds: [3103] }));

    fireEvent.click(within(rowOf('The Wine Glass')).getByRole('button', { name: 'not this' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(6194, { treasureIds: [3102] }));
  });

  it('says a work readers already see in another list is not new, and names the list', () => {
    // Boy with Thorn: on show under the Capitoline Museums' Art Museums row,
    // unread under their Archaeology row.
    const capitoline: ReviewQueueItem = {
      ...contents({
        id: 3447, name: 'Boy with Thorn', artists: [], artistsCurated: false, year: null,
        imageUrl: null, iconic: false, externalId: 'Q1187500',
        venues: [
          { id: 6214, name: 'Capitoline Museums', kind: 'Art Museums', externalId: 'Q333906', onShow: true },
          { id: 14546, name: 'Capitoline Museums', kind: 'Archaeology', externalId: 'Q333906', onShow: false },
        ],
      }),
      id: 14546, external_id: 'Q333906', name: 'Capitoline Museums', kind_id: 5, kind_name: 'Archaeology',
      pending_treasures_on_show: 1,
    };
    renderCard(capitoline);

    const row = within(rowOf('Boy with Thorn'));
    expect(row.getByText(/already on show elsewhere/)).toBeInTheDocument();
    expect(row.getByText('readers see it in Capitoline Museums (Art Museums)')).toBeInTheDocument();
    expect(row.queryByText(/new to the catalogue/)).toBeNull();
  });

  it('marks a work no list has yet as new to the catalogue', () => {
    renderCard(contents(WINE_GLASS));

    expect(within(rowOf('The Wine Glass')).getByText(/new to the catalogue/)).toBeInTheDocument();
  });
});

describe('the heading of what arrived', () => {
  it('counts what arrived and offers one no for all of it from five rows', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...HOLZSCHUHER, id: 4000 + i, name: `Work ${i + 1}` }));
    renderCard(contents(...five));

    expect(screen.getByText('5 works')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'turn all 5 down' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(6194, {}));
  });

  it('names the rows it turns down where a point moved, so the moved point is left alone', async () => {
    // A body naming nothing refuses every unread row, the moved point included —
    // a row this section neither lists nor counts, asked beside the held changes.
    const five = Array.from({ length: 5 }, (_, i) => ({ ...HOLZSCHUHER, id: 4000 + i, name: `Work ${i + 1}` }));
    renderCard({
      ...contents(...five),
      pending_locations: 1,
      pending_moved_locations: 1,
      pending_points: [{
        id: 15624, name: null, externalRef: 'Q47611', latitude: 37.94058, longitude: 27.33939,
        replaces: { latitude: 37.939722, longitude: 27.340833 },
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'turn all 5 down' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(6194, {
      treasureIds: [4000, 4001, 4002, 4003, 4004],
    }));
  });

  it('offers no "turn all down" on a capped list where a point moved, since it cannot name them all', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...HOLZSCHUHER, id: 4000 + i, name: `Work ${i + 1}` }));
    renderCard({
      ...contents(...five),
      pending_treasures: 30,
      pending_locations: 1,
      pending_moved_locations: 1,
      pending_points: [{
        id: 15624, name: null, externalRef: 'Q47611', latitude: 37.94058, longitude: 27.33939,
        replaces: { latitude: 37.939722, longitude: 27.340833 },
      }],
    });

    expect(screen.getByText('the first 5 are listed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /turn all/ })).toBeNull();
  });

  it('offers no "turn all down" below five rows, where each row is its own answer', () => {
    renderCard(contents(WINE_GLASS, HOLZSCHUHER));

    expect(screen.getByText('2 works')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /turn all/ })).toBeNull();
  });
});

describe('the new points that arrived', () => {
  it('opens a point where it can be looked at and corrected, and reports the outcome', () => {
    const onDone = vi.fn();
    renderCard(points(
      { id: 6001, name: 'Coteaux de la Marne', externalRef: '1465-003', latitude: 49.0442, longitude: 3.955 },
    ), onDone);

    // The name is a button, because it is the only way to the place — a curator
    // reading "49.0442, 3.9550" cannot tell a pin on the wrong hill from the numbers.
    fireEvent.click(screen.getByRole('button', { name: 'Coteaux de la Marne' }));
    expect(screen.getByText('opened Coteaux de la Marne')).toBeInTheDocument();
    // An unread point is one readers do not see yet, and publishing — not the
    // withdrawn card's "false alarm" — is what would show it.
    expect(screen.getByText('unseen=unread')).toBeInTheDocument();

    // The correction is offered as *this* place of *this* object, and its outcome
    // line goes where the card reports its other answers.
    fireEvent.click(screen.getByRole('button', { name: 'fix' }));
    expect(onDone).toHaveBeenCalledWith('fixed 6001 of Champagne Hillsides, Houses and Cellars');
  });

  it('answers a point by its id', async () => {
    renderCard(points(
      { id: 6001, name: 'Coteaux de la Marne', externalRef: '1465-003', latitude: 49.0442, longitude: 3.955 },
      { id: 6004, name: 'Avenue de Champagne', externalRef: '1465-002', latitude: 49.0427, longitude: 3.9590 },
    ));

    expect(screen.getByText('2 new points')).toBeInTheDocument();
    fireEvent.click(within(rowOf('Avenue de Champagne')).getByRole('button', { name: 'not this' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(1345, { locationIds: [6004] }));
  });

  it('says on the row when a curator has already corrected the point', () => {
    renderCard(points(
      {
        id: 6001, name: 'Coteaux de la Marne', externalRef: '1465-003',
        latitude: 49.0442, longitude: 3.955, curatedFields: ['location'],
      },
    ));

    // Without the word, a pin a curator moved reads as the source's — on the very
    // screen where the next curator decides about it.
    expect(screen.getByText('49.0442, 3.9550 · pin corrected')).toBeInTheDocument();
  });

  it('lists a point without a coordinate as text, since there is nothing to open', () => {
    renderCard(points(
      { id: 6002, name: 'Unplaced component', externalRef: '1465-009', latitude: null, longitude: null },
    ));

    expect(screen.getByText('Unplaced component')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unplaced component' })).toBeNull();
  });
});

describe('a point the source moved', () => {
  /** Ephesus, run 146: the run keeps the stored pin and writes the new position unread. */
  function ephesus(rows: Point[], extra: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    return {
      ...points(...rows),
      id: 14724, external_id: 'Q47611', name: 'Ephesus', kind_id: 5, kind_name: 'Archaeology',
      pending_moved_locations: rows.length,
      ...extra,
    };
  }
  const MOVED: Point = {
    id: 15624, name: null, externalRef: 'Q47611', latitude: 37.94058, longitude: 27.33939,
    replaces: { latitude: 37.939722, longitude: 27.340833 },
  };

  it('is a change to what readers see, asked with the held changes and not as an arrival', async () => {
    renderCard(ephesus([MOVED]));

    // How far and which way, and the map with both pins — the point's own row
    // in the changes table, headed by the place.
    expect(screen.getByText(/Moved 158 m north-west/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'see the move on the map' })).toBeInTheDocument();
    expect(screen.queryByText('Arrived, not shown to readers yet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'publish this' }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(14724, { locationIds: [15624] }));
    fireEvent.click(screen.getByRole('button', { name: 'not this' }));
    await waitFor(() => expect(mockedRefuse).toHaveBeenCalledWith(14724, { locationIds: [15624] }));
  });

  it('asks nothing of the point the coordinates row already moves', async () => {
    // The object's coordinate and its one point are one move: the queue names
    // the point publishing the coordinate takes along (`coordinates_move_point_id`),
    // and the card asks about it once, on the coordinates row.
    const other: Point = { ...MOVED, id: 15623, latitude: 37.9406, longitude: 27.3394,
      replaces: { latitude: 37.9397, longitude: 27.3408 } };
    renderCard(ephesus([other, MOVED], { coordinates_move_point_id: 15624 }));

    expect(screen.getAllByRole('button', { name: 'see the move on the map' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'publish this' }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith(14724, { locationIds: [15623] }));
  });

  it('keeps a moved point apart from a new one on a card that holds both', () => {
    renderCard(ephesus(
      [MOVED, { id: 15700, name: 'Basilica of St. John', externalRef: 'Q1546', latitude: 37.9518, longitude: 27.3679 }],
      { pending_moved_locations: 1 },
    ));

    expect(screen.getByText('1 new point')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Basilica of St. John' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'see the move on the map' })).toHaveLength(1);
  });
});

describe('a card moving to the next object', () => {
  it('closes what a curator opened', () => {
    // `ReviewBench` mounts this card without a key on purpose — the object
    // preview staying open as a curator works down the queue is behaviour
    // `ObjectPreview` is written around — so the next waiting row reconciles
    // into this same instance. A work held open would then be paired with the
    // *new* card's id and name, and corrected under another museum's id, which
    // is what proves the caller may correct it at all.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = contents(
      { id: 7101, name: 'Amor Victorious', artists: ['Caravaggio'], artistsCurated: false,
        year: 1602, imageUrl: null, iconic: true, externalId: 'Q1052156' },
    );
    const { rerender } = render(cardFor(first, () => {}, client));
    fireEvent.click(screen.getByRole('button', { name: 'Amor Victorious' }));
    expect(screen.getByText('opened work 7101 of 6194 (Gemäldegalerie Berlin)')).toBeInTheDocument();

    // The next card holds contents of its own, or the table unmounts for want of
    // rows and the state would go with it — the assertion would then pass
    // without the guarantee it is about.
    const next = {
      ...contents(
        { id: 7202, name: 'The Three Graces', artists: ['Peter Paul Rubens'],
          artistsCurated: false, year: 1635, imageUrl: null, iconic: true, externalId: 'Q1138017' },
      ),
      id: 6185,
      name: 'Museo del Prado',
    };
    rerender(cardFor(next, () => {}, client));

    expect(screen.getByRole('button', { name: 'The Three Graces' })).toBeInTheDocument();
    expect(screen.queryByText(/opened work/)).toBeNull();
  });
});

/**
 * The run's own question, on the card where it is answered.
 *
 * A row the Archaeology rule could not settle by itself is held with the doubt
 * written down (ADR-0058): the Pushkin Museum's antiquities are one department
 * of an art museum, and whether the exposition is substantially archaeology is
 * a judgement no classes answer. On the preview alone the question sits behind
 * "Look at the object" — and the batch answer of #852 can dispose of the row
 * without the object ever being opened, so a curator could answer a question
 * they were never shown.
 */
describe('the question the run wrote down', () => {
  /** An arrival held for a curator, with or without a note from the run. */
  function arrival(admission_note: string | null): ReviewQueueItem {
    return {
      id: 7311, external_id: 'Q4238', name: 'Pushkin Museum',
      kind_id: 5, kind_name: 'Archaeology',
      missing_since: null, source_membership: 'present', existence: 'extant',
      kind: 'arrival', proposed: null,
      pending_locations: 0, pending_treasures: 0,
      pending_points: [], pending_works: [],
      admission_note,
    };
  }

  function renderArrival(item: ReviewQueueItem) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <GatedCard group={{ id: item.id, name: item.name, arrival: item }} onDone={() => {}} />
      </QueryClientProvider>,
    );
  }

  it('is on the card itself, beside the sentence saying what is being held', () => {
    renderArrival(arrival(
      'an antiquities department (category: Egyptological collections in Russia);'
      + ' is the exposition substantially archaeology?',
    ));

    expect(screen.getByText(/The run asks:/)).toBeInTheDocument();
    expect(screen.getByText(/is the exposition substantially archaeology\?/)).toBeInTheDocument();
  });

  it('says nothing on a row the rule admitted by itself', () => {
    renderArrival(arrival(null));

    expect(screen.queryByText(/The run asks:/)).toBeNull();
  });

  it('says nothing for a note of blanks, as the preview says nothing for one', () => {
    // A label drawn over nothing tells a curator a question was asked and then
    // withholds it. `ObjectPreview` trims the same note for the same reason.
    renderArrival(arrival('   '));

    expect(screen.queryByText(/The run asks:/)).toBeNull();
  });
});
