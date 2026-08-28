/**
 * What a stored link may become on screen.
 *
 * The values reaching `safeHref` are somebody else's: a licence url from a
 * Commons file's metadata, a region's source page from an admin's import tree.
 * The server holds each to an absolute http(s) url on the way in, and this
 * asks again where the value meets an `href` -- the rows already stored
 * predate the write-path rule, and a `javascript:` href runs on click.
 */

import { describe, it, expect } from 'vitest';
import { safeHref } from './safeHref';

const WIKIVOYAGE_PAGE = 'https://en.wikivoyage.org/wiki/Saharan_Atlas';

describe('safeHref', () => {
  it('refuses every spelling of a scheme that executes', () => {
    // A URL parser drops ASCII tab, LF and CR from anywhere in the value, and
    // leading whitespace from the front, before it decides what the scheme
    // is -- so the parser is asked, not the string.
    for (const value of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://evil.example/1234',
    ]) {
      expect(safeHref(value), value).toBeNull();
    }
  });

  it('refuses a relative value, which would otherwise resolve against this site', () => {
    expect(safeHref('/wiki/Saharan_Atlas')).toBeNull();
    expect(safeHref('//evil.example/x')).toBeNull();
    expect(safeHref('wiki/Saharan_Atlas')).toBeNull();
  });

  it('refuses a value that is not a url at all, and nothing', () => {
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('keeps an absolute http(s) url, in the form the parser read', () => {
    expect(safeHref(WIKIVOYAGE_PAGE)).toBe(WIKIVOYAGE_PAGE);
    // `http` as well as `https`: a licence url from old wiki metadata is one,
    // and neither scheme executes.
    expect(safeHref('HTTP://creativecommons.org/licenses/by-sa/4.0/'))
      .toBe('http://creativecommons.org/licenses/by-sa/4.0/');
    expect(safeHref(` https://en.wikivoyage.org/wiki/Saharan\t_Atlas `)).toBe(WIKIVOYAGE_PAGE);
  });
});
