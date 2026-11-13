import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoPlaceShownNote } from './NoPlaceShownNote';

const WORDS = 'None of its places is on the map yet.';

describe('NoPlaceShownNote', () => {
  it('says so of a whole that shows no place, which the map cannot show (#2122)', () => {
    render(<NoPlaceShownNote place={{ longitude: null, latitude: null }} />);
    expect(screen.getByText(WORDS)).toBeTruthy();
  });

  it('says nothing of a whole the map frames by its places, or of a place at its own point', () => {
    const { container } = render(<>
      <NoPlaceShownNote place={{ longitude: null, latitude: null, focus: { bbox: [111, 32.4, 111.2, 32.5], anchorPoint: [111.1, 32.45] } }} />
      <NoPlaceShownNote place={{ longitude: -5.9931, latitude: 37.3858 }} />
    </>);
    expect(container.textContent).toBe('');
  });
});
