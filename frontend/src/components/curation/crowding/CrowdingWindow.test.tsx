/**
 * The crowded-city window (#2282, #2358, #2487) open on Schloßplatz, as the tab opens it from the place's card: the
 * place in its own circle within Berlin's squares, what it is compared with,
 * the way back to the region's list as Berlin's page shows it, each place's
 * picture, credit and article, the answers by standing, a hover's reason, the
 * map held in view, and answers staged and applied together with the Apply
 * bar's summary and the report by name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../api/crowdingAnswers', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/crowdingAnswers')>()),
  answerCrowding: vi.fn(),
  fetchCrowdingGroup: vi.fn(),
  fetchCrowdingPlace: vi.fn(),
}));
// The map needs WebGL; the list, the card and the answers are what is tested here.
vi.mock('./CrowdingMap', () => ({ CrowdingMap: () => <div data-testid="crowding-map" />, CrowdingLegend: () => null }));

import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingGroup, fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { CROWDING_LAYOUT, CrowdingWindow } from './CrowdingWindow';
import type { Staging } from './crowdingStaging';
import {
  ALEXANDERPLATZ_LOOK, berlinGroup, berlinSquares, NOLLENDORFPLATZ, ROSA_LUXEMBURG_PLATZ, SCHLOSSPLATZ, schlossplatzCircle,
} from './crowdingFixtures';

const mockedGroup = vi.mocked(fetchCrowdingGroup);
const mockedPlace = vi.mocked(fetchCrowdingPlace);
const mockedAnswer = vi.mocked(answerCrowding);
const TITLE = 'Berlin · Squares & streets · square';

/** The window as the tab frames it: the place open and the answers staged are the frame's to keep. */
function Framed({ onApplied }: { onApplied: (lines: string[]) => void }) {
  const [selected, setSelected] = useState<number | null>(SCHLOSSPLATZ);
  const [staging, setStaging] = useState<Staging>(new Map());
  return (
    <CrowdingWindow
      group={berlinGroup.group}
      selected={selected}
      onSelect={setSelected}
      titleId="crowded-city-title"
      staging={staging}
      onStaging={setStaging}
      onApplied={onApplied}
      frame={({ heading, body, outcome, actions }) => (
        <section aria-labelledby="crowded-city-title">{heading}{body}{outcome}<div>{actions}</div></section>
      )}
    />
  );
}

function renderWindow(onApplied = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Framed onApplied={onApplied} />
    </QueryClientProvider>,
  );
  return onApplied;
}

/** The window open on the region's list, from the card's place. */
async function inRegion() {
  fireEvent.click(await screen.findByRole('button', { name: `← ${TITLE}, the whole region` }));
  await screen.findByText(/^On the region page · /);
}

/** The circle's rows, by the names that head them: the open place's own among them at its rank. */
function circleNames() {
  const table = within(screen.getByRole('table', { name: 'Its figures and the places around it' }));
  // A row's name is its first button, or its text where it is the open place's own.
  return table.getAllByRole('rowheader').map(header => header.querySelector('button, p')?.textContent);
}

/** A place's row in the circle's table, by its name. */
function circleRow(name: string) {
  const around = within(screen.getByRole('region', { name: 'The places around it' }));
  return within(around.getByRole('button', { name }).closest('[role="row"]') as HTMLElement);
}

/** The open place's card, above its circle: its own answers, which the rows below do not repeat. */
function card() {
  return within(screen.getByRole('heading', { name: 'Schloßplatz', level: 3 }).closest('.MuiPaper-root') as HTMLElement);
}

/** The region list's row of one place, by its name. */
function rowOf(name: string) {
  const { membershipId } = berlinSquares.find(place => place.name === name)!;
  return within(screen.getByTestId(`crowding-place-${membershipId}`));
}

beforeEach(() => {
  mockedGroup.mockReset();
  mockedPlace.mockReset();
  mockedAnswer.mockReset();
  mockedGroup.mockResolvedValue(berlinGroup);
  mockedPlace.mockResolvedValue(schlossplatzCircle);
});

describe("the region list's numbers (#2400)", () => {
  it("shows on every row what the place's score is made of, and the score, in the headings' columns, a dash where nothing is read (#2454)", async () => {
    renderWindow();
    await inRegion();

    const list = within(screen.getByRole('region', { name: "The region's list" }));
    // One row of headings over the whole list, which sticks while it scrolls; the page's part and
    // the tail are dividers inside the same table, never a second heading row (#2487).
    const table = within(list.getByRole('table', { name: "The region's places and their figures" }));
    expect(table.getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Place', 'Readers a year', 'Editions', 'In Wikivoyage', 'Score', 'Venues']);
    expect(table.getByRole('heading', { name: /^On the region page/, level: 3 })).toBeInTheDocument();
    expect(table.getByRole('heading', { name: 'Shadowed · 3, in the list’s tail', level: 3 })).toBeInTheDocument();
    expect(list.queryAllByRole('rowgroup')).toHaveLength(0);
    const cells = (name: string) => rowOf(name).getAllByRole('cell').map(cell => cell.textContent);
    expect(cells('Alexanderplatz')).toEqual(['209,401', '47', 'yes', '0.95', '64']);
    expect(cells('Leipziger Platz')).toEqual(['—', '18', '—', '0.73', '—']);
  });
});

describe('the window open on a place, as a way in opens it', () => {
  it('opens the card’s place in its own circle, within its region’s group', async () => {
    renderWindow();

    expect(await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TITLE, level: 2 })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledWith(SCHLOSSPLATZ);
    expect(mockedGroup).toHaveBeenCalledWith(berlinGroup.group);
    expect(screen.getByText(/^The rule shadows it: 13 better-known squares stand within 10 km of it\./)).toBeInTheDocument();
    expect(screen.getByText('The answer is about Schloßplatz alone. Every other square keeps its own standing.')).toBeInTheDocument();

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('13 better-known squares within 10 km. One other is less known.')).toBeInTheDocument();
    // One list by fame (#2486): the thirteen it is compared with above it, the less known below, with no group headings.
    expect(circleNames()).toEqual([
      'Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt', 'Pariser Platz', 'Bebelplatz', 'Lustgarten', 'Breitscheidplatz',
      'Platz der Republik', 'Nollendorfplatz', 'Hackescher Markt', 'Frankfurter Tor', 'Leipziger Platz', 'Rosa-Luxemburg-Platz',
      'Schloßplatz', 'Kulturforum',
    ]);
    expect(around.queryAllByRole('rowgroup')).toHaveLength(0);
    expect(circleRow('Alexanderplatz').getByText('0.7 km')).toBeInTheDocument();
    // Its rank says what the rule does with each of them, so neither row needs a note.
    expect(circleRow('Alexanderplatz').queryByText(/counted|compared/)).toBeNull();
    expect(circleRow('Kulturforum').queryByText(/counted|compared/)).toBeNull();
    expect(around.getByText(/^For the rule to show it, fewer than 10 squares better known than it/)).toBeInTheDocument();
  });

  it('marks a better-known neighbour the rule leaves out in its row, with its reason (#2420, #2486)', async () => {
    // A square holding works a reader is shown, scored above Schloßplatz: ADR-0173 never counts it against another.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      around: [...schlossplatzCircle.around, {
        ...schlossplatzCircle.around[0], membershipId: 998, name: 'Museum Island square', score: 0.9, compared: false, holdsWorks: true,
      }],
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('13 better-known squares within 10 km. One more better known is not counted. One other is less known.'))
      .toBeInTheDocument();
    // Above the place by its fame, between Gendarmenmarkt and Pariser Platz, and said not to count.
    expect(circleNames().slice(2, 5)).toEqual(['Gendarmenmarkt', 'Museum Island square', 'Pariser Platz']);
    expect(circleRow('Museum Island square').getByText('Not counted against it. It holds works readers are shown.')).toBeInTheDocument();
  });

  it('says in its row that a neighbour a curator keeps on the list counts against a place not measured yet', async () => {
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      place: { ...schlossplatzCircle.place, score: null, outrankedBy: null, ruleCrowded: false },
      around: schlossplatzCircle.around.map((entry, i) => ({ ...entry, compared: i === 0, pin: i === 0 ? 'list' as const : null })),
      measuringRun: null,
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(circleRow('Alexanderplatz').getByText('Counted against it. A curator keeps it on the list.')).toBeInTheDocument();
    expect(circleRow('Potsdamer Platz').getByText('Not compared until Schloßplatz is measured.')).toBeInTheDocument();
    expect(around.getByText('Not measured yet: only the one a curator keeps on the list counts above it until the next sync run ends.'))
      .toBeInTheDocument();
    expect(around.queryByText(/nothing is compared/)).toBeNull();
  });

  it('lists the neighbours of a place not measured yet by their own figures, and never says nothing is above it (#2420)', async () => {
    // The Russian Church in Florence on 2026-11-10: arrived after fame was measured, while the next run went on.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      place: { ...schlossplatzCircle.place, score: null, outrankedBy: null, ruleCrowded: false },
      around: [
        ...schlossplatzCircle.around.map(entry => ({ ...entry, compared: false })),
        { ...schlossplatzCircle.around[0], membershipId: 999, name: 'Marx-Engels-Forum', score: null, readers: null, compared: false },
      ],
      measuringRun: 'Squares & streets',
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText('Not measured yet: nothing is compared with it until the run of Squares & streets in progress ends.'))
      .toBeInTheDocument();
    expect(around.queryByText(/better-known|best-known/)).toBeNull();
    // The measured ones first, each saying it is not compared; the place and the other one not measured yet last.
    expect(circleNames().slice(-3)).toEqual(['Kulturforum', 'Schloßplatz', 'Marx-Engels-Forum']);
    expect(circleRow('Alexanderplatz').getByText('Not compared until Schloßplatz is measured.')).toBeInTheDocument();
    expect(circleRow('Marx-Engels-Forum').getByText('Not measured yet.')).toBeInTheDocument();
  });

  it("shows the place's figures at its rank in a table, and each place around it in the same columns (#2400, #2454, #2486)", async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const table = within(screen.getByRole('table', { name: 'Its figures and the places around it' }));
    expect(table.getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Place', 'Readers a year', 'Editions', 'In Wikivoyage', 'Score', 'Venues', 'Distance']);
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map(cell => cell.textContent);
    // The place itself stands at its rank, 14th, marked, with no rule's count in it: the card's sentence says that once.
    const own = table.getByRole('row', { name: 'Schloßplatz, this place' });
    expect(cells(own)).toEqual(['20,000', '17', 'yes', '0.70', '3', '']);
    expect(own.firstChild).toHaveTextContent('14');
    expect(within(own).getByText('this place')).toBeInTheDocument();
    expect(table.getAllByRole('row').indexOf(own)).toBe(14);
    expect(screen.queryByText(/Better within/)).toBeNull();
    const rowOf = (name: string) => table.getByRole('button', { name }).closest('[role="row"]') as HTMLElement;
    // Each place's name heads its row, and its figures stand in the headings' columns before its distance.
    expect(within(rowOf('Alexanderplatz')).getByRole('rowheader')).toHaveTextContent('Alexanderplatz');
    expect(cells(rowOf('Alexanderplatz'))).toEqual(['209,401', '47', 'yes', '0.95', '64', '0.7 km']);
    // A place not read yet is a dash, never a zero, and its hint says so without a tab stop of its own.
    expect(cells(rowOf('Leipziger Platz')).slice(0, 5)).toEqual(['—', '18', '—', '0.73', '—']);
    expect(within(rowOf('Leipziger Platz')).getAllByLabelText('Not measured yet.')).toHaveLength(3);
    expect(within(rowOf('Leipziger Platz')).getAllByLabelText('Not measured yet.')[0]).not.toHaveAttribute('tabindex');
  });

  it('draws each place around it as the region’s list does: its picture and its answers where the group holds it (#2487)', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    expect(circleRow('Alexanderplatz').getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=120');
    expect(circleRow('Alexanderplatz').getByRole('link', { name: 'Wikipedia' })).toBeInTheDocument();
    // An answer in the circle is the same pin as in the region's list: one staging for both.
    fireEvent.click(circleRow('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    expect(screen.getByText(/^1 answer staged: shadow Nollendorfplatz\./)).toBeInTheDocument();
    await inRegion();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws a place around it the window holds no list for with its figures alone', async () => {
    // A square across the region's border: within 10 km, and in no list the window has read.
    const across = { ...schlossplatzCircle.around[0], membershipId: 990, experienceId: 1990, name: 'Volkspark Friedrichshain', score: 0.1 };
    mockedPlace.mockResolvedValue({ ...schlossplatzCircle, around: [...schlossplatzCircle.around, across] });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const row = circleRow('Volkspark Friedrichshain');
    expect(row.queryByRole('img')).toBeNull();
    expect(row.getAllByRole('button')).toHaveLength(1);
    expect(row.getAllByRole('cell').map(cell => cell.textContent).slice(0, 4)).toEqual(['209,401', '47', 'yes', '0.10']);
  });

  it('says what each heading counts, on hover and on keyboard focus (#2454)', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const score = screen.getByText('Score', { selector: '[tabindex="0"]' });
    score.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/from 0 to 1/);
  });

  it('answers the open place alone, with the answers its standing takes', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(card().getByRole('button', { name: 'Show anyway' }));
    expect(card().getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'true');
    expect(card().getByRole('button', { name: 'Keep shadowed' })).toBeInTheDocument();
    expect(screen.getByText(/^1 answer staged: show Schloßplatz anyway\. The region page will show 12 squares/)).toBeInTheDocument();
  });

  it('says how many of the places it is compared with it does not list', async () => {
    // Two of the thirteen above it are new arrivals of another curator's scope: counted, not named.
    mockedPlace.mockResolvedValue({
      ...schlossplatzCircle,
      around: schlossplatzCircle.around.filter(entry => entry.name !== 'Frankfurter Tor' && entry.name !== 'Rosa-Luxemburg-Platz'),
      comparedUnlisted: 2,
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    const around = within(screen.getByRole('region', { name: 'The places around it' }));
    expect(around.getByText(/^13 better-known squares within 10 km\./)).toBeInTheDocument();
    expect(around.queryByRole('button', { name: 'Frankfurter Tor' })).toBeNull();
    expect(around.getByText('2 more better known are not listed here: outside your scope, or no longer offered by their source.'))
      .toBeInTheDocument();
  });

  it('shows the place’s picture with its credit as a line, and opens it enlarged (ADR-0182)', async () => {
    mockedPlace.mockResolvedValue({ ...schlossplatzCircle, place: { ...schlossplatzCircle.place, ...ALEXANDERPLATZ_LOOK } });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    expect(card().getByRole('img', { name: 'Schloßplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=250');
    expect(card().getByRole('link', { name: 'Wladyslaw Sojka' })).toBeInTheDocument();

    fireEvent.click(card().getByRole('button', { name: 'Schloßplatz — enlarge the picture' }));
    const enlarged = await screen.findByRole('dialog', { name: 'Schloßplatz' });
    expect(within(enlarged).getByRole('img', { name: 'Schloßplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=960');
  });

  it('opens a place it is compared with in that place’s own circle', async () => {
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(within(screen.getByRole('region', { name: 'The places around it' })).getByRole('button', { name: 'Potsdamer Platz' }));
    await waitFor(() => expect(mockedPlace).toHaveBeenLastCalledWith(2));
  });

  it('returns to the region’s list as its page shows it: the page first, then the shadowed tail', async () => {
    renderWindow();
    await inRegion();

    expect(screen.getByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
    expect(screen.getByText('Shadowed · 3, in the list’s tail')).toBeInTheDocument();
    expect(rowOf('Alexanderplatz').getByText('the best known here')).toBeInTheDocument();
    expect(rowOf('Leipziger Platz').getByText('11 better known within 10 km')).toBeInTheDocument();
    expect(rowOf('Rosa-Luxemburg-Platz').getByText('New')).toBeInTheDocument();
  });

  it('offers each place the answers its standing takes', async () => {
    renderWindow();
    await inRegion();

    const buttons = (name: string) => rowOf(name).queryAllByRole('button').map(button => button.textContent).slice(1);
    expect(buttons('Nollendorfplatz')).toEqual(['Shadow']);
    expect(buttons('Leipziger Platz')).toEqual(['Show anyway', 'Keep shadowed']);
    expect(buttons('Rosa-Luxemburg-Platz')).toEqual(['Publish', 'Shadow', 'Don’t take']);
    expect(buttons('Schloßplatz')).toEqual(['Show anyway', 'Keep shadowed', 'Don’t take']);
    expect(buttons('Kulturforum')).toEqual([]);
    expect(rowOf('Kulturforum').getByText('Always shown: it holds works')).toBeInTheDocument();
  });

  it('says on a hover why a place stands where it stands', async () => {
    renderWindow();
    await inRegion();

    // The reason opens at the name it explains, inside the row, never away over the map (#2487).
    const why = screen.getByLabelText(
      'Shadowed: 11 better-known squares stand within 10 km of it: Alexanderplatz, Potsdamer Platz, Gendarmenmarkt, …',
    );
    expect(screen.getByTestId('crowding-place-12')).toContainElement(why);
    expect(within(why).getByRole('button', { name: 'Leipziger Platz' })).toBeInTheDocument();
  });

  it('shows what each place is: its picture with its credit, and its article; a place without them shows neither (#2345)', async () => {
    renderWindow();
    await inRegion();

    const alexanderplatz = rowOf('Alexanderplatz');
    expect(alexanderplatz.getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=120');
    // A dense row: the credit is the badge on the thumbnail, opening the full credit (ADR-0182).
    fireEvent.click(alexanderplatz.getByRole('button', { name: 'Picture credit: © Wladyslaw Sojka · FAL' }));
    const credit = await screen.findByRole('presentation');
    expect(within(credit).getByRole('link', { name: 'Wladyslaw Sojka' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Berlin_-_Alexanderplatz1.jpg');
    fireEvent.keyDown(credit, { key: 'Escape' });
    expect(alexanderplatz.getByRole('link', { name: 'Wikipedia' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Alexanderplatz');

    const potsdamerPlatz = rowOf('Potsdamer Platz');
    expect(potsdamerPlatz.queryByRole('img')).toBeNull();
    expect(potsdamerPlatz.queryByRole('link')).toBeNull();
  });

  it('takes the credit away with a picture that fails to load, and keeps the article', async () => {
    renderWindow();
    await inRegion();

    fireEvent.error(rowOf('Alexanderplatz').getByRole('img', { name: 'Alexanderplatz' }));

    expect(rowOf('Alexanderplatz').queryByRole('img')).toBeNull();
    expect(rowOf('Alexanderplatz').queryByRole('button', { name: /Picture credit/ })).toBeNull();
    expect(rowOf('Alexanderplatz').queryByRole('button', { name: /enlarge the picture/ })).toBeNull();
    expect(rowOf('Alexanderplatz').getByRole('link', { name: 'Wikipedia' })).toBeInTheDocument();
  });

  it('opens a row’s picture enlarged, with its full credit, without opening the place', async () => {
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Alexanderplatz').getByRole('button', { name: 'Alexanderplatz — enlarge the picture' }));

    const enlarged = await screen.findByRole('dialog', { name: 'Alexanderplatz' });
    expect(within(enlarged).getByRole('img', { name: 'Alexanderplatz' })).toHaveAttribute(
      'src', 'https://commons.wikimedia.org/wiki/Special:FilePath/Berlin%20-%20Alexanderplatz1.jpg?width=960');
    expect(within(enlarged).getByRole('link', { name: 'Wladyslaw Sojka' })).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalledWith(1);
  });

  it('keeps the map in view while the list scrolls, beside it on a wide screen (#2345)', async () => {
    renderWindow();
    await inRegion();

    expect(within(screen.getByTestId('crowding-map-pane')).getByTestId('crowding-map')).toBeInTheDocument();
    // From a laptop's width the map stands beside the list, held just below the screen's top (#2487).
    expect(CROWDING_LAYOUT.mapPane).toEqual({ p: 2, position: { lg: 'sticky' }, top: { lg: 16 } });
    expect(CROWDING_LAYOUT.mapColumn).toMatchObject({ width: { xs: '100%', lg: 320, xl: 400 } });
    // Below a laptop's width the list is the box the table's headings stick in.
    expect(CROWDING_LAYOUT.list).toMatchObject({ overflow: { sm: 'auto', lg: 'visible' }, maxHeight: { sm: '75vh', lg: 'none' } });
  });
});

describe('answers applied together', () => {
  it('sums the staged answers up with the count the region page will show, and reports each by name', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [
        { membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false },
        { membershipId: ROSA_LUXEMBURG_PLATZ, experienceId: 1013, name: 'Rosa-Luxemburg-Platz', answer: 'publish', pin: null, published: true, refused: false },
        { membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false },
      ],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    const onApplied = renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(card().getByRole('button', { name: 'Show anyway' }));
    await inRegion();
    fireEvent.click(rowOf('Rosa-Luxemburg-Platz').getByRole('button', { name: 'Publish' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(
      '3 answers staged: show Schloßplatz anyway, publish Rosa-Luxemburg-Platz, shadow Nollendorfplatz. '
        + 'The region page will show 12 squares, before the rule recounts their neighbours.',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply 3 answers' }));

    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([
      { membershipId: SCHLOSSPLATZ, answer: 'list' },
      { membershipId: ROSA_LUXEMBURG_PLATZ, answer: 'publish' },
      { membershipId: NOLLENDORFPLATZ, answer: 'shadow' },
    ]));
    expect(await screen.findByText('1 place shown anyway (1 new, published): Schloßplatz.')).toBeInTheDocument();
    expect(screen.getByText('1 place published and left to the rule: Rosa-Luxemburg-Platz.')).toBeInTheDocument();
    // The staging is cleared and the city read again.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await waitFor(() => expect(mockedGroup).toHaveBeenCalledTimes(2));
    // The tab is told what the answers did, to read the queue and the lists again.
    expect(onApplied).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('Schloßplatz')]));
  });

  it('returns to the region’s list once the open place is not taken', async () => {
    mockedAnswer.mockResolvedValue({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'refuse', pin: null, published: false, refused: true }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(card().getByRole('button', { name: 'Don’t take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
  });

  it('returns to the region’s list once a partly applied Apply refused the open place', async () => {
    // The first page refused Schloßplatz, and a later page failed.
    mockedAnswer.mockRejectedValue(new CrowdingPartlyApplied({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'refuse', pin: null, published: false, refused: true }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    }, new Error('The connection was lost')));
    renderWindow();
    await screen.findByRole('heading', { name: 'Schloßplatz', level: 3 });

    fireEvent.click(card().getByRole('button', { name: 'Don’t take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    expect(await screen.findByText('On the region page · 11, and 1 new that would be — best known first')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Schloßplatz', level: 3 })).toBeNull();
  });

  it('keeps the answers a failed later page never sent staged, and clears only the ones it settled', async () => {
    mockedAnswer.mockRejectedValue(new CrowdingPartlyApplied({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    }, new Error('The connection was lost')));
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 answers' }));

    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an answer staged while an Apply runs, which that Apply did not send', async () => {
    let finish: (value: Awaited<ReturnType<typeof answerCrowding>>) => void = () => {};
    mockedAnswer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith([{ membershipId: SCHLOSSPLATZ, answer: 'list' }]));
    // Staged while the first Apply's pages go.
    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    finish({
      answered: [{ membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false }],
      refused: [],
      outOfScope: 0,
      placementFailed: [],
    });
    expect(await screen.findByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    expect(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf('Schloßplatz').getByRole('button', { name: 'Show anyway' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('takes a staged answer back with a second press and with Reset', async () => {
    renderWindow();
    await inRegion();

    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Keep shadowed' }));
    expect(screen.getByRole('button', { name: 'Apply 1 answer' })).toBeEnabled();
    fireEvent.click(rowOf('Schloßplatz').getByRole('button', { name: 'Keep shadowed' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(rowOf('Nollendorfplatz').getByRole('button', { name: 'Shadow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(mockedAnswer).not.toHaveBeenCalled();
  });
});
