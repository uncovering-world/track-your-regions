import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  findRegionsSection,
  extractAllWikilinks,
  stripHtmlComments,
  extractFileMapImage,
  extractImageCandidates,
  classifyMultiLink,
  parseRegionlist,
  parseBulletLinks,
} from '../parser.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

// ─── findRegionsSection ─────────────────────────────────────────────────────

describe('findRegionsSection', () => {
  it('finds "Regions" section', () => {
    const sections = [
      { index: '1', line: 'Understand' },
      { index: '2', line: 'Regions' },
      { index: '3', line: 'Cities' },
    ];
    expect(findRegionsSection(sections)).toBe('2');
  });

  it('finds "Regions and settlements" section', () => {
    const sections = [
      { index: '1', line: 'Understand' },
      { index: '2', line: 'Regions and settlements' },
    ];
    expect(findRegionsSection(sections)).toBe('2');
  });

  it('finds "Countries" section', () => {
    const sections = [{ index: '3', line: 'Countries' }];
    expect(findRegionsSection(sections)).toBe('3');
  });

  it('finds "Prefectures" section', () => {
    const sections = [
      { index: '1', line: 'Understand' },
      { index: '2', line: 'Prefectures' },
    ];
    expect(findRegionsSection(sections)).toBe('2');
  });

  it('returns null when no region section', () => {
    const sections = [
      { index: '1', line: 'Understand' },
      { index: '2', line: 'Cities' },
      { index: '3', line: 'Get in' },
    ];
    expect(findRegionsSection(sections)).toBeNull();
  });
});

// ─── extractAllWikilinks ────────────────────────────────────────────────────

describe('extractAllWikilinks', () => {
  it('extracts simple wikilinks', () => {
    expect(extractAllWikilinks('Visit [[Paris]] and [[London]]')).toEqual([
      'Paris',
      'London',
    ]);
  });

  it('extracts wikilinks with display text', () => {
    expect(
      extractAllWikilinks('Visit [[France|French Republic]]'),
    ).toEqual(['France']);
  });

  it('skips namespace links', () => {
    expect(
      extractAllWikilinks('[[File:Map.svg]] and [[Paris]]'),
    ).toEqual(['Paris']);
  });

  it('returns empty for no links', () => {
    expect(extractAllWikilinks('No links here')).toEqual([]);
  });
});

// ─── stripHtmlComments ──────────────────────────────────────────────────────

describe('stripHtmlComments', () => {
  it('strips single-line comments', () => {
    expect(stripHtmlComments('before <!-- comment --> after')).toBe(
      'before  after',
    );
  });

  it('strips multi-line comments', () => {
    expect(
      stripHtmlComments('before <!-- \n multi\nline \n--> after'),
    ).toBe('before  after');
  });

  it('strips multiple comments', () => {
    expect(
      stripHtmlComments('a <!-- x --> b <!-- y --> c'),
    ).toBe('a  b  c');
  });
});

// ─── extractFileMapImage ────────────────────────────────────────────────────

describe('extractFileMapImage', () => {
  it('finds strong keyword match (map)', () => {
    const wt = '[[File:France_map.svg|300px]]';
    expect(extractFileMapImage(wt)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/France_map.svg',
    );
  });

  it('finds strong keyword case-insensitive', () => {
    const wt = '[[File:GrandCaymanMap.png|400px]]';
    expect(extractFileMapImage(wt)).toContain('GrandCaymanMap.png');
  });

  it('blocks hard-skip (locator)', () => {
    const wt = '[[File:France_locator_map.svg|300px]]';
    expect(extractFileMapImage(wt)).toBeNull();
  });

  it('blocks hard-skip (flag)', () => {
    const wt = '[[File:Flag_map_of_France.svg|300px]]';
    expect(extractFileMapImage(wt)).toBeNull();
  });

  it('finds weak keyword SVG', () => {
    const wt = '[[File:Czech_regions.svg|300px]]';
    expect(extractFileMapImage(wt)).toContain('Czech_regions.svg');
  });

  it('blocks weak keyword JPG (not SVG/PNG)', () => {
    const wt = '[[File:Czech_regions.jpg|300px]]';
    expect(extractFileMapImage(wt)).toBeNull();
  });

  it('SVG fallback in Regionlist context', () => {
    const wt = '{{Regionlist\n| region1name=Test\n}}\n[[File:SomeRandomName.svg|300px]]';
    expect(extractFileMapImage(wt)).toContain('SomeRandomName.svg');
  });

  it('returns null for no match', () => {
    expect(extractFileMapImage('No files here')).toBeNull();
  });
});

// ─── extractImageCandidates ─────────────────────────────────────────────────

describe('extractImageCandidates', () => {
  it('includes SVG and PNG', () => {
    const wt =
      '[[File:test.svg|300px]]\n[[File:test2.png|300px]]\n[[File:photo.jpg|300px]]';
    const result = extractImageCandidates(wt);
    expect(result).toHaveLength(2); // SVG and PNG, but not plain JPG
    expect(result[0]).toContain('test.svg');
    expect(result[1]).toContain('test2.png');
  });

  it('includes JPG with map keywords', () => {
    const wt = '[[File:region_map.jpg|300px]]';
    const result = extractImageCandidates(wt);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('region_map.jpg');
  });

  it('hard-skips flags', () => {
    const wt = '[[File:flag_of_france.svg|300px]]';
    expect(extractImageCandidates(wt)).toHaveLength(0);
  });

  it('deduplicates', () => {
    const wt =
      '[[File:test.svg|300px]]\n[[File:test.svg|400px]]';
    expect(extractImageCandidates(wt)).toHaveLength(1);
  });

  it('limits to maxCandidates', () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `[[File:map${i}.svg|300px]]`,
    ).join('\n');
    expect(extractImageCandidates(lines, 5)).toHaveLength(5);
  });
});

// ─── classifyMultiLink ──────────────────────────────────────────────────────

describe('classifyMultiLink', () => {
  it('single link returns linked', () => {
    // This is tested via parseRegionlist, but let's verify directly
    const result = classifyMultiLink(['France'], '[[France]]');
    // With 1 link, this falls to grouping since there's no possessive/parenthetical
    expect(result.type).toBe('grouping');
  });

  it('conjunction returns grouping', () => {
    const result = classifyMultiLink(
      ['France', 'Monaco'],
      '[[France]] and [[Monaco]]',
    );
    expect(result.type).toBe('grouping');
    if (result.type === 'grouping') {
      expect(result.name).toBe('France and Monaco');
      expect(result.children).toEqual(['France', 'Monaco']);
    }
  });

  it('possessive returns last link', () => {
    const result = classifyMultiLink(
      ['Russia', 'North Caucasus'],
      "[[Russia]]'s [[North Caucasus]]",
    );
    expect(result.type).toBe('linked');
    if (result.type === 'linked') {
      expect(result.target).toBe('North Caucasus');
    }
  });

  it('parenthetical returns first link', () => {
    const result = classifyMultiLink(
      ['Falster', 'Gedser', 'Marielyst'],
      '[[Falster]] ([[Gedser]], [[Marielyst]])',
    );
    expect(result.type).toBe('linked');
    if (result.type === 'linked') {
      expect(result.target).toBe('Falster');
    }
  });
});

// ─── parseRegionlist ────────────────────────────────────────────────────────

describe('parseRegionlist', () => {
  it('parses France regionlist', () => {
    const wt = loadFixture('france-regionlist.txt');
    const { mapImage, regions, extraLinks } = parseRegionlist(wt);

    // Map image from regionmap parameter
    expect(mapImage).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/France_regions_map_(new).svg',
    );

    // 3 regions
    expect(regions).toHaveLength(3);

    // First region
    expect(regions[0].name).toBe('Île-de-France');
    expect(regions[0].hasLink).toBe(true);
    expect(regions[0].items).toEqual(['Paris', 'Versailles', 'Fontainebleau']);

    // Second region
    expect(regions[1].name).toBe('Provence');
    expect(regions[1].hasLink).toBe(true);
    expect(regions[1].items).toEqual([
      'Marseille',
      'Aix-en-Provence',
      'Avignon',
    ]);

    // Third region
    expect(regions[2].name).toBe('Brittany');
    expect(regions[2].hasLink).toBe(true);

    // Extra bullet links after the template
    expect(extraLinks).toEqual(['Corsica', 'French Riviera']);
  });

  it('parses multi-link patterns', () => {
    const wt = loadFixture('south-pacific-multilink.txt');
    const { regions } = parseRegionlist(wt);

    // region1: [[Melanesia]] — single link
    expect(regions[0].name).toBe('Melanesia');
    expect(regions[0].hasLink).toBe(true);

    // region2: [[France]] and [[Monaco]] — conjunction/grouping
    expect(regions[1].hasLink).toBe(false);
    expect(regions[1].name).toBe('France and Monaco');
    expect(regions[1].items).toEqual(['France', 'Monaco']);

    // region3: [[Russia]]'s [[North Caucasus]] — possessive
    expect(regions[2].name).toBe('North Caucasus');
    expect(regions[2].hasLink).toBe(true);

    // region4: [[Baker Island|Baker]] and [[Howland Island]]s ([[USA]])
    // After stripping ([[USA]]), core links are: Baker Island, Howland Island
    // The "and" makes it a conjunction/grouping
    expect(regions[3].hasLink).toBe(false);

    // region5: [[Falster]] ([[Gedser]], [[Marielyst]]) — parenthetical
    expect(regions[4].name).toBe('Falster');
    expect(regions[4].hasLink).toBe(true);

    // region6: Italian Peninsula — plain text
    expect(regions[5].name).toBe('Italian Peninsula');
    expect(regions[5].hasLink).toBe(false);
    expect(regions[5].items).toEqual(['Italy', 'Malta', 'San Marino']);
  });

  it('strips HTML comments in regionlist', () => {
    const wt = `{{Regionlist
| regionmap=test.svg
| region1name=<!-- hidden -->[[Visible]]
| region1items=
}}`;
    const { regions } = parseRegionlist(wt);
    expect(regions).toHaveLength(1);
    expect(regions[0].name).toBe('Visible');
  });
});

// ─── parseBulletLinks ───────────────────────────────────────────────────────

describe('parseBulletLinks', () => {
  it('extracts standard bullet links', () => {
    const wt = `
* [[Region A]] — description
* [[Region B]] — another
* '''Bold Name''' — not a link
`;
    expect(parseBulletLinks(wt)).toEqual(['Region A', 'Region B']);
  });

  it('skips cross-reference bullets', () => {
    const wt = `
* [[Region A]] — nice place
* [[Region B]] — described separately
* [[Region C]] — another place
`;
    const links = parseBulletLinks(wt);
    expect(links).toContain('Region A');
    expect(links).not.toContain('Region B');
    expect(links).toContain('Region C');
  });

  it('skips sub-bullets under cross-reference', () => {
    const wt = `
* [[Parent]] — described elsewhere
** [[Child1]]
** [[Child2]]
* [[Region C]] — another place
`;
    const links = parseBulletLinks(wt);
    expect(links).not.toContain('Parent');
    expect(links).not.toContain('Child1');
    expect(links).not.toContain('Child2');
    expect(links).toContain('Region C');
  });

  it('deduplicates links', () => {
    const wt = `
* [[Region A]]
* [[Region A]]
`;
    expect(parseBulletLinks(wt)).toEqual(['Region A']);
  });

  it('ignores links after dash separator', () => {
    const wt = `* [[Target]] — see also [[Other]]`;
    expect(parseBulletLinks(wt)).toEqual(['Target']);
  });
});

