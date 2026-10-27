import { describe, expect, it } from 'vitest';
import { articleSections } from '../sections.js';

/** An article's sections read from its wikitext (#2089), as the Action API's `parse` listed them. */
describe('articleSections', () => {
  it('numbers the headings in order, and runs each to the next heading of its level or higher', () => {
    const wikitext = 'Lead text.\n== Understand ==\nIntro.\n== Regions ==\nList.\n=== North ===\nCold.\n== Cities ==\nParis.\n';
    const sections = articleSections(wikitext);

    expect(sections.map(({ index, line, level }) => ({ index, line, level }))).toEqual([
      { index: '1', line: 'Understand', level: 2 },
      { index: '2', line: 'Regions', level: 2 },
      { index: '3', line: 'North', level: 3 },
      { index: '4', line: 'Cities', level: 2 },
    ]);
    expect(sections[1].text).toBe('== Regions ==\nList.\n=== North ===\nCold.');
    expect(sections[3].text).toBe('== Cities ==\nParis.');
  });

  it('gives a heading the text the API shows: a link by its label, no bold or tags', () => {
    const [section] = articleSections("== [[Wikivoyage:Regions|Regions]] of '''France'''<span id=\"r\"></span> ==\nText.");
    expect(section.line).toBe('Regions of France');
  });

  it('takes no heading from a comment, and reads an unbalanced one at its shorter run, as MediaWiki does', () => {
    const sections = articleSections('<!--\n== Regions ==\n-->\n== Regions =\nText.');
    expect(sections.map(({ line, level }) => ({ line, level }))).toEqual([{ line: '= Regions', level: 1 }]);
  });

  it('finds none in an article with no heading', () => {
    expect(articleSections('Just a stub, with [[File:Map.svg]].')).toEqual([]);
  });
});
