import { describe, expect, it } from 'vitest';
import { decodeOverlayImage } from './regionImageOverlay.js';
import { OVERLAY_IMAGE_MAX_BYTES } from '../../types/index.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const base64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

describe('decodeOverlayImage (#595)', () => {
  it('takes a raster image that is what its data URL says', () => {
    const { bytes, type } = decodeOverlayImage(`data:image/png;base64,${PNG}`);
    expect(type).toBe('image/png');
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(decodeOverlayImage(`data:image/jpeg;base64,${base64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])}`).type).toBe('image/jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    expect(decodeOverlayImage(`data:image/webp;base64,${webp.toString('base64')}`).type).toBe('image/webp');
  });

  it('refuses bytes that are not the type the data URL names', () => {
    // A JPEG sent as a PNG, and a GIF sent as a PNG.
    expect(() => decodeOverlayImage(`data:image/png;base64,${base64([0xff, 0xd8, 0xff, 0xe0])}`)).toThrow(/not the image\/png/);
    expect(() => decodeOverlayImage(`data:image/png;base64,${Buffer.from('GIF89a').toString('base64')}`)).toThrow(/not the image\/png/);
  });

  it('refuses an SVG, which can carry script, and any type the table does not take', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect(() => decodeOverlayImage(`data:image/svg+xml;base64,${svg}`)).toThrow(/PNG, JPEG or WebP/);
    expect(() => decodeOverlayImage(`data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`)).toThrow(/PNG, JPEG or WebP/);
  });

  it('refuses an empty image, and one over the cap', () => {
    expect(() => decodeOverlayImage('data:image/png;base64,')).toThrow(/PNG, JPEG or WebP/);
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const big = Buffer.concat([header, Buffer.alloc(OVERLAY_IMAGE_MAX_BYTES)]);
    expect(() => decodeOverlayImage(`data:image/png;base64,${big.toString('base64')}`)).toThrow(/at most/);
  });
});
