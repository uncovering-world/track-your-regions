import { describe, expect, it } from 'vitest';
import { pointPicture } from './pointPicture';

const credit = { author: 'A photographer', license: 'CC BY-SA 4.0' } as never;
const site = { image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Pile_dwellings.jpg', image_credit: credit };

describe('the picture a point shows', () => {
  it('is its own where it has one, with its own credit', () => {
    const own = { image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Riesi.jpg', image_credit: null };
    expect(pointPicture(site, own)).toEqual({ imageUrl: own.image_url, imageCredit: null, pictureOfObject: false });
  });

  it("is the object's otherwise, and says so", () => {
    expect(pointPicture(site, { image_url: null, image_credit: null }))
      .toEqual({ imageUrl: site.image_url, imageCredit: credit, pictureOfObject: true });
  });

  it("is the object's, unflagged, where no point is named", () => {
    expect(pointPicture(site, null).pictureOfObject).toBe(false);
  });
});
