/**
 * Tests for the works a refusal counted, shown rather than counted at.
 *
 * The preview exists to make a number checkable, so its one real failure mode is showing a
 * set that does not match the sentence above it. Both mismatches below happened on the live
 * page: a line naming one work opened a list of three, and a line claiming eleven opened a
 * list that stopped at the cap without saying so.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorksPreview, type CountedWork } from './WorksPreview';

/** Onze-Lieve-Vrouwekathedraal's three, as the catalogue holds them. */
const CATHEDRAL: CountedWork[] = [
  { name: 'The Elevation of the Cross', type: 'painting', artist: 'Peter Paul Rubens', imageUrl: null, year: 1610 },
  { name: 'The Descent from the Cross', type: 'painting', artist: 'Peter Paul Rubens', imageUrl: null, year: 1612 },
  { name: 'The Assumption of the Virgin', type: 'painting', artist: 'Peter Paul Rubens', imageUrl: null, year: 1626 },
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
      <WorksPreview works={[{ name: 'Doryphoros', type: 'statue', artist: 'Polykleitos', imageUrl: null, year: -450 }]}>
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
        { name: 'Antinous Farnese', type: 'statue', artist: null, imageUrl: null, year: 200 },
        { name: 'The Night Watch', type: 'painting', artist: null, imageUrl: null, year: 1642 },
      ]}
      >
        {phrase}
      </WorksPreview>,
    );

    expect(screen.getByText('statue · AD 200')).toBeInTheDocument();
    expect(screen.getByText('painting · 1642')).toBeInTheDocument();
  });
});
