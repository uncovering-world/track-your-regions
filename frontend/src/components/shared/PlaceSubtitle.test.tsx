import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaceSubtitle, descriptionBeyondSubtitle } from './PlaceSubtitle';

// Ajanta Caves: Wikidata's line under the name, UNESCO's paragraph when opened (#1795).
const LINE = '2nd century BCE to 1st century CE Buddhist cave monuments located in Maharashtra, India';
const PARAGRAPH = 'The first Buddhist cave monuments at Ajanta date from the 2nd and 1st centuries B.C.';

describe('PlaceSubtitle', () => {
  it('draws the line, whole in its tooltip', () => {
    render(<PlaceSubtitle subtitle={`  ${LINE} `} />);
    expect(screen.getByText(LINE)).toHaveAttribute('title', LINE);
  });

  it('draws nothing for a place with no subtitle', () => {
    for (const none of [null, undefined, '', '   ']) {
      const { container } = render(<PlaceSubtitle subtitle={none} />);
      expect(container).toBeEmptyDOMElement();
    }
  });
});

describe('descriptionBeyondSubtitle', () => {
  it('shows the paragraph beside the subtitle', () => {
    expect(descriptionBeyondSubtitle({ subtitle: LINE, description: PARAGRAPH })).toBe(PARAGRAPH);
    expect(descriptionBeyondSubtitle({ subtitle: null, description: PARAGRAPH })).toBe(PARAGRAPH);
  });

  it('never repeats the subtitle as the description, and shows nothing where there is none', () => {
    expect(descriptionBeyondSubtitle({ subtitle: LINE, description: ` ${LINE}` })).toBeNull();
    expect(descriptionBeyondSubtitle({ subtitle: LINE, description: null })).toBeNull();
    expect(descriptionBeyondSubtitle({ subtitle: LINE, description: '' })).toBeNull();
  });
});
