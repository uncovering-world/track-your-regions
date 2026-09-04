/**
 * Tests for the picture a form previews, and for what it refuses.
 *
 * The cases are the read path's own: a stored value is normalised the way every
 * card reads it before it is sized, an address the product may not draw from is
 * no frame rather than a broken one, and a picture that does not arrive takes
 * its credit with it — a photographer named under an empty frame is a claim
 * about a person made where the thing that would justify it is not.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PictureWithCredit } from './PictureWithCredit';

// Bamiyan's picture on the development catalogue, and its credit.
const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan%20Valley2.jpg';
const THUMBNAIL = 'https://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan%20Valley2.jpg?width=250';
const CREDIT = {
  author: 'Carl Montgomery',
  license: 'CC BY 2.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg',
};

describe('PictureWithCredit', () => {
  it('draws the picture at a size the CDN holds, with its credit', () => {
    render(<PictureWithCredit url={PICTURE} credit={CREDIT} alt="Picture preview" />);

    expect(screen.getByRole('img', { name: 'Picture preview' })).toHaveAttribute('src', THUMBNAIL);
    expect(screen.getByRole('link', { name: 'Carl Montgomery' })).toBeInTheDocument();
  });

  it('reads a stored value in its legacy JSON-encoded shape, as the card does', () => {
    // `image_url` once held `{"url": …}`; `extractImageUrl` still reads it and the
    // expanded card draws it, so a preview that refused it would show a curator
    // nothing for a picture readers see.
    render(<PictureWithCredit url={JSON.stringify({ url: PICTURE })} credit={CREDIT} alt="Picture preview" />);

    expect(screen.getByRole('img', { name: 'Picture preview' })).toHaveAttribute('src', THUMBNAIL);
  });

  it('draws no frame and no credit for an address the product may not draw from', () => {
    // A row still pointing at the World Heritage portal (ADR-0043).
    const { container } = render(
      <PictureWithCredit url="https://whc.unesco.org/document/109141" credit={CREDIT} alt="Picture preview" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('takes the credit away with a picture that fails to load', () => {
    render(<PictureWithCredit url={PICTURE} credit={CREDIT} alt="Picture preview" />);

    fireEvent.error(screen.getByRole('img', { name: 'Picture preview' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Carl Montgomery')).not.toBeInTheDocument();
  });
});
