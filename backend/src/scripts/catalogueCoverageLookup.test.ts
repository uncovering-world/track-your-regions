/**
 * The lookup's own reading of what the web returns: which names a Wikivoyage
 * article lists under which heading, what a survey keeps of a Wikidata item, and
 * how far an item lies from a region's centre. The calls themselves are not
 * made here.
 */

import { describe, expect, it } from 'vitest';
import { factsOf, kmBetween, readArticle, refusalOf } from './catalogueCoverageLookup.js';

const ARTICLE = `Yerevan is the capital of Armenia.

==Districts==
* [[Yerevan/Kentron|Kentron]] is the centre.
* [[Yerevan/Arabkir]]
[[File:Yerevan map.png|thumb]]

==Understand==
Nothing a survey reads.

==See==
* {{see
| name=Erebuni Fortress | alt= | url=
| wikidata=Q1065032
| content=Founded in 782 BC.
}}
* {{see | name=[[Republic Square (Yerevan)|Republic Square]] | lat=40.1777 }}
* {{see | name= | content=a listing nobody named }}

==Do==
* {{do | name=Climb the Cascades | wikidata=Q2596590 }}

==Eat==
Try khorovats.

==Sleep==
* {{sleep | name=Grand Hotel Yerevan }}

==Go next==
* [[Garni]] and [[Geghard]] make a day trip.
`;

describe('reading a Wikivoyage article', () => {
  const sections = readArticle(ARTICLE);
  const section = (heading: string) => sections.find(found => found.heading === heading);

  it('reads the sections a survey uses and no other', () => {
    expect(sections.map(found => found.heading)).toEqual(['Districts', 'See', 'Do', 'Eat', 'Sleep', 'Go next']);
  });

  it('names each listing once, without link markup, and leaves out a listing with no name', () => {
    expect(section('See')?.listings).toEqual(['Erebuni Fortress', 'Republic Square']);
    expect(section('Do')?.listings).toEqual(['Climb the Cascades']);
  });

  it('counts the listings that carry a Wikidata id, which is a hint and not an answer', () => {
    expect(section('See')?.withWikidata).toBe(1);
  });

  it('names the articles a navigation section links, and not its pictures', () => {
    expect(section('Districts')?.linked).toEqual(['Yerevan/Arabkir', 'Yerevan/Kentron']);
    expect(section('See')?.linked).toEqual([]);
    // Day trips are named under Go next, in prose rather than as listings.
    expect(section('Go next')).toMatchObject({ listings: [], linked: ['Garni', 'Geghard'] });
  });

  it('keeps a section whose recommendations are prose: the caller reads the saved text', () => {
    expect(section('Eat')).toMatchObject({ listings: [], withWikidata: 0 });
  });
});

describe('an answer the API refuses', () => {
  it('is told from a missing page, which is an answer', () => {
    expect(refusalOf({ parse: { title: 'Yerevan' } })).toBeNull();
    expect(refusalOf({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } })).toBeNull();
  });

  it('is asked again when it passes on its own, and is final otherwise', () => {
    expect(refusalOf({ error: { code: 'ratelimited' } })).toEqual({ code: 'ratelimited', transient: true });
    expect(refusalOf({ error: { code: 'maxlag' } })).toEqual({ code: 'maxlag', transient: true });
    expect(refusalOf({ error: { code: 'invalidtitle' } })).toEqual({ code: 'invalidtitle', transient: false });
  });
});

describe('what a survey keeps of a Wikidata item', () => {
  it('reads the label, every sitelink, the point and the classes', () => {
    expect(factsOf('Q2876258', {
      labels: { en: { value: "Raqch'i" } },
      sitelinks: { enwiki: {}, eswiki: {}, commonswiki: {} },
      claims: {
        P625: [{ mainsnak: { datavalue: { value: { latitude: -14.175, longitude: -71.366666667 } } } }],
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q486972' } } } }, { mainsnak: { datavalue: { value: { id: 'Q839954' } } } }],
      },
    })).toEqual({ id: 'Q2876258', label: "Raqch'i", sitelinks: 3, lat: -14.175, lon: -71.36667, classes: ['Q486972', 'Q839954'] });
  });

  it('says so when the item has no point, no label and no class, or does not exist', () => {
    const bare = { id: 'Q1', label: '(no English label)', sitelinks: 0, lat: null, lon: null, classes: [] };
    expect(factsOf('Q1', {})).toEqual(bare);
    expect(factsOf('Q1', undefined)).toEqual(bare);
  });

  it('skips a statement with no value', () => {
    expect(factsOf('Q1', { claims: { P31: [{ mainsnak: {} }] } }).classes).toEqual([]);
  });
});

describe('the distance from a centre', () => {
  it('puts Manu National Park about 158 km from Cusco, outside a reach of 110', () => {
    const km = kmBetween({ lat: -13.532, lon: -71.967 }, { lat: -12.14, lon: -71.66 });
    expect(Math.round(km)).toBe(158);
  });

  it('is zero from a point to itself', () => {
    expect(kmBetween({ lat: 40.18, lon: 44.51 }, { lat: 40.18, lon: 44.51 })).toBe(0);
  });
});
