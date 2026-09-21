import { describe, it, expect } from 'vitest';
import {
  PICTURE_HOSTS, isPictureHost, namesAPictureFile, isCommonsPath, isUploadHost, isDescriptionPage,
} from './pictures.js';

describe('the picture hosts', () => {
  it('admit a host and its subdomains, and nothing that merely ends in one', () => {
    for (const host of PICTURE_HOSTS) {
      expect(isPictureHost(host)).toBe(true);
      expect(isPictureHost(`en.${host}`)).toBe(true);
      expect(isPictureHost(`evil-${host}`)).toBe(false);
    }
    // The World Heritage Centre's own pictures (#557): linked to, never drawn.
    expect(isPictureHost('whc.unesco.org')).toBe(false);
  });

  it('read a Commons file off the upload host by its path, not its host', () => {
    expect(isUploadHost('upload.wikimedia.org')).toBe(true);
    expect(isCommonsPath('upload.wikimedia.org', '/wikipedia/commons/a/ab/Louvre.jpg')).toBe(true);
    // The English Wikipedia's own uploads include fair-use files.
    expect(isCommonsPath('upload.wikimedia.org', '/wikipedia/en/a/ab/Poster.jpg')).toBe(false);
    // Any other host names no wiki's uploads, so the path says nothing.
    expect(isCommonsPath('commons.wikimedia.org', '/wiki/Special:FilePath/Louvre.jpg')).toBe(true);
  });
});

describe('what names a picture file', () => {
  it('is the extension of the decoded name, in any case', () => {
    expect(namesAPictureFile('/wiki/Special:FilePath/Louvre.JPG')).toBe(true);
    expect(namesAPictureFile('/wiki/Special:FilePath/Mus%C3%A9e%20du%20Louvre.jpg')).toBe(true);
    expect(namesAPictureFile('/wiki/Special:FilePath/Louvre%2Ejpg')).toBe(true);
    // Commons serves these under the same shape, and none is a picture.
    expect(namesAPictureFile('/wiki/Special:FilePath/Nomination.pdf')).toBe(false);
    expect(namesAPictureFile('/wiki/Special:FilePath/Tour.webm')).toBe(false);
    // A path that does not decode names no file this rule admits.
    expect(namesAPictureFile('/wiki/Special:FilePath/%E0%A4%A.jpg')).toBe(false);
  });

  it('tells the page about a file from the file', () => {
    expect(isDescriptionPage('/wiki/File:Louvre.jpg')).toBe(true);
    expect(isDescriptionPage('/wiki/file:Louvre.jpg')).toBe(true);
    expect(isDescriptionPage('/wiki/Special:FilePath/Louvre.jpg')).toBe(false);
    expect(isDescriptionPage('/wikipedia/commons/a/ab/Louvre.jpg')).toBe(false);
    expect(isDescriptionPage('/wiki/%E0%A4%A')).toBe(true);
  });
});
