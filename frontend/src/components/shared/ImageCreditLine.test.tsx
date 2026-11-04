/**
 * Tests for a picture's credit on the three surfaces it is drawn on (ADR-0182).
 *
 * What is pinned is an obligation rather than a look: most of the photographs
 * this catalogue shows are CC BY or CC BY-SA, whose one condition is that the
 * author is credited, and public domain and CC0 ask nothing. So the cases that
 * matter are "a credit is owed, and it is reachable", "none is owed, and none
 * is drawn", and "there is nothing, and nothing is claimed".
 */

import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { creditSentence, ImageCreditLine, needsCredit } from './ImageCreditLine';
import { DenseThumbnail } from './DenseThumbnail';

// Bamiyan's picture on the development catalogue, as the sync stored its credit.
const BAMIYAN = {
  author: 'Carl Montgomery',
  license: 'CC BY 2.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg',
  attributionRequired: true,
};

// Mount Fuji's, which Commons releases into the public domain.
const FUJI = {
  author: null,
  license: 'Public domain',
  licenseUrl: null,
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:FujiSunriseKawaguchiko2025WP.jpg',
  attributionRequired: false,
};

describe('creditSentence', () => {
  it('says the credit as the history line records it', () => {
    expect(creditSentence(BAMIYAN)).toBe('Carl Montgomery · CC BY 2.0');
    expect(creditSentence({ ...BAMIYAN, license: null })).toBe('Carl Montgomery');
    expect(creditSentence({ ...BAMIYAN, author: null })).toBe('CC BY 2.0');
  });

  it('is nothing where nobody is named, so a caller can say "(empty)" in its own words', () => {
    expect(creditSentence({ author: null, license: null, licenseUrl: null, detailsUrl: null })).toBeNull();
    expect(creditSentence(null)).toBeNull();
  });
});

describe('whether a credit is owed', () => {
  it('is what Commons says of the file', () => {
    expect(needsCredit(BAMIYAN)).toBe(true);
    expect(needsCredit(FUJI)).toBe(false);
    // CC0 under a name the old list did not know: Commons' answer decides.
    expect(needsCredit({ ...BAMIYAN, license: 'CC0 1.0', attributionRequired: false })).toBe(false);
  });

  it('reads the licence name on a credit stored before Commons was asked', () => {
    const stored = { author: 'Benoît Prieur', license: 'CC0', licenseUrl: null, detailsUrl: null };
    expect(needsCredit(stored)).toBe(false);
    expect(needsCredit({ ...stored, license: 'Public domain' })).toBe(false);
    expect(needsCredit({ ...stored, license: 'CC BY-SA 3.0' })).toBe(true);
    // An unrecognised licence may well ask for a name: over-crediting costs a line.
    expect(needsCredit({ ...stored, license: 'GFDL' })).toBe(true);
    expect(needsCredit({ ...stored, license: null })).toBe(true);
  });

  it('is not owed where the credit names nobody and no licence', () => {
    expect(needsCredit({ author: null, license: null, licenseUrl: null, detailsUrl: null })).toBe(false);
    expect(needsCredit(undefined)).toBe(false);
  });
});

describe('a public-domain or CC0 picture', () => {
  it('shows no credit on any surface', () => {
    for (const surface of ['badge', 'line', 'full'] as const) {
      const { container, unmount } = render(<ImageCreditLine credit={FUJI} surface={surface} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    const legacy = { author: 'Rembrandt', license: 'Public domain', licenseUrl: null, detailsUrl: null };
    const { container } = render(<ImageCreditLine credit={legacy} surface="line" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the line on a card', () => {
  it('reads "© Author · Licence", the author linked to the file page and the licence to its terms', () => {
    const { container } = render(<ImageCreditLine credit={BAMIYAN} surface="line" />);

    expect(container.textContent).toBe('© Carl Montgomery · CC BY 2.0');
    expect(screen.getByRole('link', { name: 'Carl Montgomery' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg');
    // The URL comes from an outside source, so the link is not one the catalogue vouches for.
    expect(screen.getByRole('link', { name: 'CC BY 2.0' })).toHaveAttribute('rel', expect.stringContaining('nofollow'));
  });

  it('is one line, cut with an ellipsis, and whole on focus', async () => {
    const { container } = render(<ImageCreditLine credit={BAMIYAN} surface="line" />);
    const line = container.firstElementChild;

    expect(line).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
    // A scripted focus is a keyboard's: MUI opens on focus only for `:focus-visible`.
    act(() => screen.getByRole('link', { name: 'Carl Montgomery' }).focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('© Carl Montgomery · CC BY 2.0');
  });

  it('takes the focus itself where it holds no link, so the whole text is reachable', () => {
    const { container } = render(<ImageCreditLine
      credit={{ author: 'Museum Mors', license: '© Museum Mors', licenseUrl: null, detailsUrl: null }}
      surface="line"
    />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('tabindex', '0');
  });

  it('points at the file page where the credit read no author', () => {
    // A field that was a template the cleaning could not read a name out of:
    // the file page states the author, and the link is the credit CC 4.0 accepts.
    render(<ImageCreditLine credit={{ ...BAMIYAN, author: null }} surface="line" />);

    expect(screen.getByRole('link', { name: 'Author on the file page' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg');
  });
});

describe('the full credit under a full-size view', () => {
  it('names the photographer and the licence, wrapping', () => {
    const { container } = render(<ImageCreditLine credit={BAMIYAN} surface="full" />);

    expect(container.textContent).toBe('© Carl Montgomery · CC BY 2.0');
    expect(container.firstElementChild).toHaveStyle({ wordBreak: 'break-word' });
  });

  it('names the photographer without linking a URL nobody should be sent to', () => {
    // `licenseUrl` originates in a wiki field anybody may edit.
    const { container } = render(<ImageCreditLine credit={{
      author: 'Jane Doe',
      license: 'CC BY 4.0',
      // eslint-disable-next-line no-script-url -- the payload under test
      licenseUrl: 'javascript:alert(1)',
      detailsUrl: '/licences/by',
    }} surface="full" />);

    expect(container.textContent).toBe('© Jane Doe · CC BY 4.0');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says nothing about a picture with no credit at all', () => {
    const { container } = render(<ImageCreditLine credit={undefined} surface="full" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the badge on a dense row', () => {
  it('is a © the keyboard reaches, which opens the full credit and the file page', async () => {
    render(<ImageCreditLine credit={BAMIYAN} surface="badge" />);
    const badge = screen.getByRole('button', { name: 'Picture credit: © Carl Montgomery · CC BY 2.0' });

    expect(badge).toHaveTextContent('©');
    // A native button in the tab order, so Enter and Space press it and a touch
    // taps it: the press is the click the browser dispatches for either.
    expect(badge.tagName).toBe('BUTTON');
    expect(badge).toHaveAttribute('tabindex', '0');
    badge.focus();
    expect(badge).toHaveFocus();
    fireEvent.click(badge);

    const credit = await screen.findByRole('presentation');
    expect(within(credit).getByRole('link', { name: 'Carl Montgomery' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg');
    expect(within(credit).getByRole('link', { name: 'The file on Wikimedia Commons' }))
      .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg');
    expect(badge).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(credit, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument());
  });

  it('does not pass its press on to the row it sits on', () => {
    let rowPressed = false;
    render(
      <div onClick={() => { rowPressed = true; }}>
        <ImageCreditLine credit={BAMIYAN} surface="badge" />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Picture credit/ }));
    expect(rowPressed).toBe(false);
  });
});

describe('a dense row’s thumbnail', () => {
  const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan_Valley2.jpg';

  it('carries the badge and opens the picture enlarged, at 960, with the full credit', async () => {
    render(<DenseThumbnail imageUrl={PICTURE} title="Bamiyan Valley" credit={BAMIYAN} />);

    expect(screen.getByRole('button', { name: /Picture credit/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bamiyan Valley — enlarge the picture' }));

    const enlarged = await screen.findByRole('dialog', { name: 'Bamiyan Valley' });
    expect(within(enlarged).getByRole('img', { name: 'Bamiyan Valley' }))
      .toHaveAttribute('src', expect.stringContaining('width=960'));
    expect(enlarged).toHaveTextContent('© Carl Montgomery · CC BY 2.0');

    fireEvent.keyDown(enlarged, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('takes the badge and the enlargement away with a picture that failed to load', () => {
    render(<DenseThumbnail imageUrl={PICTURE} title="Bamiyan Valley" credit={BAMIYAN} />);

    fireEvent.error(screen.getByRole('img', { name: 'Bamiyan Valley' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('draws a public-domain picture with no badge, and still opens it', () => {
    render(<DenseThumbnail imageUrl={PICTURE} title="Mount Fuji" credit={FUJI} />);

    expect(screen.queryByRole('button', { name: /Picture credit/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mount Fuji — enlarge the picture' })).toBeInTheDocument();
  });
});
