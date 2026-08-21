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
import { ImageCreditLine } from './ImageCreditLine';

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
