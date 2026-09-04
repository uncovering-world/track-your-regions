/**
 * Tests for the line under a picture.
 *
 * What is being pinned is an obligation rather than a look: most of the
 * photographs this catalogue shows are CC BY or CC BY-SA, and the single
 * condition those licences impose is that the author is named wherever the work
 * appears. So the cases that matter are "there is a name, and it is on screen"
 * and "there is nothing, and nothing is claimed".
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { creditAddsBeyond, creditLabel, creditSentence, ImageCreditLine } from './ImageCreditLine';

/**
 * The same credit as words, for a place that renders text rather than a component.
 *
 * Two callers already: the tooltip on Discover's contents tile, and the line the
 * curation history prints when an edit replaced a picture — which used to read
 * `[object Object]` where the photographer's name belonged (#801). One sentence,
 * so a credit reads the same under the picture and in the record of its removal.
 */
describe('creditSentence', () => {
  // Bamiyan's picture on the development catalogue, as the sync stored its credit.
  const bamiyan = {
    author: 'Carl Montgomery',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg',
  };

  it('says what the line under the picture says', () => {
    const { container } = render(<ImageCreditLine credit={bamiyan} />);

    expect(creditSentence(bamiyan)).toBe('Carl Montgomery · CC BY 2.0');
    expect(creditSentence(bamiyan)).toBe(container.textContent);
  });

  it('names the half a source gave, without a separator hanging off it', () => {
    expect(creditSentence({ ...bamiyan, license: null })).toBe('Carl Montgomery');
    expect(creditSentence({ ...bamiyan, author: null })).toBe('CC BY 2.0');
  });

  it('is nothing where nobody is named, so a caller can say "(empty)" in its own words', () => {
    expect(creditSentence({ author: null, license: null, licenseUrl: null, detailsUrl: null })).toBeNull();
    expect(creditSentence(null)).toBeNull();
    expect(creditSentence(undefined)).toBeNull();
  });

  it('is what the tooltip fragment wraps', () => {
    expect(creditLabel(bamiyan)).toBe(' — image: Carl Montgomery · CC BY 2.0');
    expect(creditLabel(null)).toBe('');
  });
});

describe('ImageCreditLine', () => {
  it('names the photographer and the licence', () => {
    render(<ImageCreditLine credit={{
      author: 'Stefan Kühn',
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Stonehenge.jpg',
    }} />);

    expect(screen.getByText('Stefan Kühn')).toBeInTheDocument();
    expect(screen.getByText('CC BY-SA 3.0')).toBeInTheDocument();
  });

  it('points the licence at its own terms, and the name at where they are stated', () => {
    render(<ImageCreditLine credit={{
      author: 'Benoît Prieur',
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0',
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Little_Mermaid.jpg',
    }} />);

    expect(screen.getByRole('link', { name: 'Benoît Prieur' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Little_Mermaid.jpg');
    // The URL comes from an outside source, so the link is not one the
    // catalogue vouches for.
    expect(screen.getByRole('link', { name: 'CC0' }))
      .toHaveAttribute('rel', expect.stringContaining('nofollow'));
  });

  it('shows a name the source gave with no link to hang it on', () => {
    // UNESCO's shape: an author and a rights holder, often the same string and
    // never a URL. Read as one line, because that is what it renders as.
    const { container } = render(<ImageCreditLine credit={{
      author: 'Museum Mors', license: '© Museum Mors', licenseUrl: null, detailsUrl: null,
    }} />);

    expect(container.textContent).toBe('Museum Mors · © Museum Mors');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says nothing when the source named nobody', () => {
    // An empty credit line under a photograph would read as "nobody took this",
    // which is a claim, and a false one.
    const { container } = render(<ImageCreditLine credit={{
      author: null, license: null, licenseUrl: null, detailsUrl: null,
    }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names the photographer without linking a URL nobody should be sent to', () => {
    // `licenseUrl` originates in a wiki field anybody may edit. The server keeps
    // only http(s) now, and this checks again — the credit still has to name the
    // person, so the name stays and the link goes.
    const { container } = render(<ImageCreditLine credit={{
      author: 'Jane Doe',
      license: 'CC BY 4.0',
      // eslint-disable-next-line no-script-url -- the payload under test
      licenseUrl: 'javascript:alert(1)',
      detailsUrl: null,
    }} />);

    expect(container.textContent).toBe('Jane Doe · CC BY 4.0');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not link a relative URL back at this site', () => {
    // Resolving somebody else's metadata against our own origin would make the
    // credit point at us, which credits nobody.
    render(<ImageCreditLine credit={{
      author: 'Jane Doe', license: 'CC BY 4.0', licenseUrl: '/licences/by', detailsUrl: null,
    }} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not link a value that is not a URL at all', () => {
    render(<ImageCreditLine credit={{
      author: 'Jane Doe', license: 'CC BY 4.0', licenseUrl: 'not a url', detailsUrl: 'also not',
    }} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says nothing about a picture with no credit at all', () => {
    const { container } = render(<ImageCreditLine credit={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The rule the dense lists opt into.
 *
 * A row of works already names the artist, and Commons names the *painter* as
 * the author of a photograph of a painting — so on most of these files the
 * credit would repeat the line above it and add "Public domain", a licence that
 * asks for nothing. The obligation is the CC BY / CC BY-SA minority, and those
 * must never be suppressed.
 */
describe('a credit beside a row that already names the artist', () => {
  const credit = (over: Partial<Parameters<typeof creditAddsBeyond>[0] & object> = {}) => ({
    author: 'Rembrandt', license: 'Public domain', licenseUrl: null, detailsUrl: null, ...over,
  });

  it('is dropped when the photograph is free and the author is the artist', () => {
    expect(creditAddsBeyond(credit(), 'Rembrandt')).toBe(false);
  });

  it('reads two spellings of one name as one person', () => {
    expect(creditAddsBeyond(credit({ author: 'leonardo  da vinci' }), 'Leonardo da Vinci')).toBe(false);
  });

  it('is kept whenever the licence asks for the name', () => {
    // The Mesha Stele at the Louvre: a photograph of a 3D object, CC BY-SA 4.0,
    // taken by somebody who is not the maker of the thing photographed.
    expect(creditAddsBeyond(
      credit({ author: 'Mbzt', license: 'CC BY-SA 4.0' }), null,
    )).toBe(true);
  });

  it('is kept when a free photograph names somebody the row does not', () => {
    expect(creditAddsBeyond(credit({ author: 'Google Arts Project' }), 'Rembrandt')).toBe(true);
  });

  it('is kept when the licence is one this rule does not recognise', () => {
    // The default runs towards crediting: an unknown licence may well ask for a
    // name, and over-crediting costs a line where under-crediting breaks a term.
    expect(creditAddsBeyond(credit({ license: 'GFDL' }), 'Rembrandt')).toBe(true);
  });

  it('is dropped when a free photograph names nobody at all', () => {
    expect(creditAddsBeyond(credit({ author: null }), 'Rembrandt')).toBe(false);
  });

  it('is dropped when there is no credit', () => {
    expect(creditAddsBeyond(null, 'Rembrandt')).toBe(false);
    expect(creditAddsBeyond({
      author: null, license: null, licenseUrl: null, detailsUrl: null,
    }, 'Rembrandt')).toBe(false);
  });

  it('is dropped when the photographer is any of the makers, not just the first', () => {
    // The Baptism of Christ is Leonardo and Verrocchio, and Commons credits the
    // photograph of it to the second of them. A row already naming both gains
    // nothing (#720) — and reading only the first name would print the repetition
    // this rule exists to remove.
    expect(creditAddsBeyond(
      credit({ author: 'Andrea del Verrocchio' }),
      ['Leonardo da Vinci', 'Andrea del Verrocchio'],
    )).toBe(false);
  });

  it('is kept when a free photograph names nobody among the makers', () => {
    expect(creditAddsBeyond(
      credit({ author: 'Google Arts Project' }),
      ['Leonardo da Vinci', 'Andrea del Verrocchio'],
    )).toBe(true);
  });

  it('is kept on a work with no maker recorded, where the list is empty', () => {
    // An empty list is what "nobody recorded" now is, and it must read as the
    // old `null` did rather than as a name nothing can match.
    expect(creditAddsBeyond(credit(), [])).toBe(true);
  });

  it('is what the component honours when a row hands it the artist', () => {
    const { container, rerender } = render(
      <ImageCreditLine credit={credit()} redundantWith="Rembrandt" />,
    );
    expect(container).toBeEmptyDOMElement();

    // The same credit on a large view, which passes no artist, still shows.
    rerender(<ImageCreditLine credit={credit()} />);
    expect(container.textContent).toBe('Rembrandt · Public domain');
  });

  it('is opted into by passing the prop, not by the value it carries', () => {
    // A dense row whose artist field is `undefined` is still a dense row asking
    // for the rule. The two readings agree wherever an author is named — with no
    // artist to repeat, the photographer is new either way — and part company on a
    // credit that names nobody: under the rule "Public domain" alone says nothing
    // the row needs, and without it the row gains a line that carries no name.
    const { container } = render(<ImageCreditLine
      credit={{ author: null, license: 'Public domain', licenseUrl: null, detailsUrl: null }}
      redundantWith={undefined}
    />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows on a row whose work has no artist recorded', () => {
    // A stele has no named maker, so `redundantWith` is null — and the
    // photographer is then the only person the picture can name.
    //
    // A *free* licence deliberately: under CC BY-SA the rule answers true at the
    // licence check and never reaches the artist comparison, so the same
    // assertion would pass with the null-artist branch broken.
    const { container } = render(<ImageCreditLine credit={credit()} redundantWith={null} />);

    expect(container.textContent).toBe('Rembrandt · Public domain');
  });
});
