/**
 * Tests for the works a refusal counted, shown rather than counted at.
 *
 * The preview exists to make a number checkable, so its one real failure mode is showing a
 * set that does not match the sentence above it. Both mismatches below happened on the live
 * page: a line naming one work opened a list of three, and a line claiming eleven opened a
 * list that stopped at the cap without saying so.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorksPreview, type CountedWork } from './WorksPreview';

/** Onze-Lieve-Vrouwekathedraal's three, as the catalogue holds them. */
const CATHEDRAL: CountedWork[] = [
  { name: 'The Elevation of the Cross', type: 'painting', artists: ['Peter Paul Rubens'], artistsCurated: false, imageUrl: null, year: 1610, externalId: 'Q901' },
  { name: 'The Descent from the Cross', type: 'painting', artists: ['Peter Paul Rubens'], artistsCurated: false, imageUrl: null, year: 1612, externalId: 'Q902' },
  { name: 'The Assumption of the Virgin', type: 'painting', artists: ['Peter Paul Rubens'], artistsCurated: false, imageUrl: null, year: 1626, externalId: 'Q903' },
];

function open(node: React.ReactElement) {
  render(node);
  fireEvent.mouseOver(screen.getByText('hover me'));
  return screen.findByRole('tooltip');
}

const phrase = <span>hover me</span>;

describe('WorksPreview', () => {
  it('says which work the sentence meant when the sentence named one', async () => {
    // The card reads "…because The Elevation of the Cross is kept there". Three unlabelled
    // rows under that phrase read as the card contradicting itself.
    await open(
      <WorksPreview works={CATHEDRAL} only="The Elevation of the Cross">{phrase}</WorksPreview>,
    );

    expect(screen.getByText('Also kept here, less widely known:')).toBeInTheDocument();
    const tip = screen.getByRole('tooltip').textContent ?? '';
    expect(tip.indexOf('The Elevation of the Cross'))
      .toBeLessThan(tip.indexOf('Also kept here'));
    expect(tip.indexOf('Also kept here'))
      .toBeLessThan(tip.indexOf('The Descent from the Cross'));
  });

  it('accounts for the works it is not showing when the sentence claims a number', async () => {
    // Naples: the rule weighed eleven, the card carries twelve at most — but a card that
    // showed three under a sentence claiming eleven would look like a miscount.
    await open(<WorksPreview works={CATHEDRAL} total={11}>{phrase}</WorksPreview>);

    expect(screen.getByText('…and 8 more, the least widely known.')).toBeInTheDocument();
  });

  it('notices the cap where the sentence claims no number of its own', async () => {
    // A cathedral's line names one work and counts nothing, so `total` is absent — and the
    // capped array on its own cannot tell a holding of three from the first three of ten.
    await open(
      <WorksPreview works={CATHEDRAL} held={10} only="The Elevation of the Cross">{phrase}</WorksPreview>,
    );

    expect(screen.getByText('…and 7 more, the least widely known.')).toBeInTheDocument();
  });

  it('counts against the sentence, not the catalogue, where the sentence claims a number', async () => {
    // The rule weighed eleven when it ran; the catalogue holds ten now. The curator is
    // reading the sentence, so eleven is the number this list has to add up to.
    await open(<WorksPreview works={CATHEDRAL} total={11} held={10}>{phrase}</WorksPreview>);

    expect(screen.getByText('…and 8 more, the least widely known.')).toBeInTheDocument();
  });

  it('stays silent about a remainder there is none of', async () => {
    await open(<WorksPreview works={CATHEDRAL} total={3}>{phrase}</WorksPreview>);

    expect(screen.queryByText(/more, the least widely known/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Also kept here/)).not.toBeInTheDocument();
  });

  it('leaves the phrase plain when there is nothing to show', () => {
    // An underline promising a list that never arrives is worse than no underline.
    render(<WorksPreview works={[]}>{phrase}</WorksPreview>);
    fireEvent.mouseOver(screen.getByText('hover me'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('names each work by what it is, who made it and when', async () => {
    await open(
      <WorksPreview works={[{ name: 'Doryphoros', type: 'statue', artists: ['Polykleitos'], artistsCurated: false, imageUrl: null, year: -450, externalId: 'Q910' }]}>
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByText('statue · Polykleitos · 450 BC')).toBeInTheDocument();
  });

  it('writes the era on both sides of zero, since these lists are mostly antiquities', async () => {
    // Naples holds the Antinous Farnese (AD 200) next to the Capuan Venus (200 BC). Bare
    // "200" beside "200 BC" reads as a typo rather than as four centuries.
    await open(
      <WorksPreview works={[
        { name: 'Antinous Farnese', type: 'statue', artists: [], artistsCurated: false, imageUrl: null, year: 200, externalId: 'Q904' },
        { name: 'The Night Watch', type: 'painting', artists: [], artistsCurated: false, imageUrl: null, year: 1642, externalId: 'Q905' },
      ]}
      >
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByText('statue · AD 200')).toBeInTheDocument();
    expect(screen.getByText('painting · 1642')).toBeInTheDocument();
  });

  it('names whoever took the photograph beside the work it shows', async () => {
    // A picture drawn on a curator's screen is a picture being shown, and a
    // minority of these are CC BY or CC BY-SA — which ask for the name.
    await open(
      <WorksPreview works={[{
        name: 'Mesha Stele',
        externalId: 'Q724954',
        type: 'stele',
        artists: [], artistsCurated: false,
        imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
        year: -840,
        imageCredit: {
          author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null,
        },
      }]}
      >
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByRole('tooltip').textContent).toContain('Mbzt · CC BY-SA 4.0');
  });

  it('credits nobody for a work it draws no picture of', async () => {
    // Most of these rows carry no image at all — the cathedral's three do not — and a
    // photographer named under nothing is credited for nothing.
    await open(
      <WorksPreview works={[{
        ...CATHEDRAL[0],
        imageCredit: {
          author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null,
        },
      }]}
      >
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByRole('tooltip').textContent).not.toContain('Mbzt');
  });

  it('does not let one work of a repeated name take another\'s failure', async () => {
    const warned = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Real case: the Getty holds two works called `Spring` inside the twelve this
    // preview shows. Keyed by name, React would match the second render of one to
    // the other's fiber, and the refusal would land on the wrong row — a picture
    // that loaded, credited under a frame that did not.
    const credit = {
      author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null,
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Spring.jpg',
    };
    await open(
      <WorksPreview works={[
        { name: 'Spring', type: 'painting', artists: [], artistsCurated: false, year: 1573, externalId: 'Q1',
          imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Spring%20one.jpg',
          imageCredit: credit },
        { name: 'Spring', type: 'painting', artists: [], artistsCurated: false, year: 1894, externalId: 'Q2',
          imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Spring%20two.jpg',
          imageCredit: credit },
      ]}
      >
        {phrase}
      </WorksPreview>,
    );

    // The distinguishing assertion is the key itself, not the rendering: with
    // duplicate keys React still draws both rows here, and only warns — so an
    // assertion about which picture disappears passes either way, and did when
    // this test was first written. What does not pass either way is the warning.
    expect(warned.mock.calls.flat().join(' ')).not.toMatch(/same key/i);

    // The thumbnails are decorative (`alt=""`), so they carry no `img` role —
    // reached through the tooltip's own node instead.
    const tip = screen.getByRole('tooltip');
    const shown = () => Array.from(tip.querySelectorAll('img'));
    const [first, second] = shown();
    expect(shown()).toHaveLength(2);

    fireEvent.error(first);

    // One credit gone with its picture, one still standing beside a picture that
    // is there — rather than both, or the wrong one.
    expect(shown()).toEqual([second]);
    expect(screen.getAllByText(/Mbzt/)).toHaveLength(1);
    warned.mockRestore();
  });

  it('opens each work at its item and at its article, in a new tab', async () => {
    // The works writer never stores an article, and 50 of 50 sampled works have an
    // English one — so the article is resolved by Wikidata at the click (#806).
    await open(
      <WorksPreview works={[{ name: 'Doryphoros', type: 'statue', artists: ['Polykleitos'], artistsCurated: false, imageUrl: null, year: -450, externalId: 'Q910' }]}>
        {phrase}
      </WorksPreview>,
    );

    const item = screen.getByRole('link', { name: 'Doryphoros' });
    expect(item).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q910');
    // Named for the work: a preview holds up to twelve of these, and a screen reader's
    // link list of twelve bare "Wikipedia"s would say nothing about which opens what.
    const article = screen.getByRole('link', { name: 'Wikipedia article for Doryphoros' });
    expect(article).toHaveTextContent('Wikipedia');
    expect(article).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q910');
    for (const link of [item, article]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('links a work nowhere when its id is not a Wikidata item', async () => {
    // Nothing in the catalogue today, but the id is `NOT NULL` and not a QID by type: a
    // link built by template literal would point at a page that does not exist.
    await open(
      <WorksPreview works={[{ name: 'Untitled', type: null, artists: [], artistsCurated: false, imageUrl: null, year: null, externalId: 'manual-7' }]}>
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
