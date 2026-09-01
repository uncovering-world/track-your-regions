/**
 * Tests for what each curated fact means to a person.
 *
 * Every case is a row this catalogue holds, because the vocabulary is a set of claims
 * about what the data means on the ground: a negative year is a BC date, a listing string
 * is a year, an area is an afternoon or an expedition, a moved pin is a distance and a
 * direction. A rendering that got one of those wrong would be a false statement to the
 * person whose job is to catch false statements.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  fieldLabel, keyMeaningOf, languageName, meaningOf, tagLabel, type ChangeContext,
} from './fieldMeaning';

const NO_CONTEXT: ChangeContext = { proposed: [] };

/** A render as text, for values the vocabulary says in words. */
function said(field: string, value: unknown, context = NO_CONTEXT): string {
  const rendered = meaningOf(field).render?.(value, context);
  if (typeof rendered === 'string') return rendered;
  render(<>{rendered}</>);
  return document.body.textContent ?? '';
}

function change(field: string, before: unknown, after: unknown, context = NO_CONTEXT): string | null {
  return meaningOf(field).describeChange?.(before, after, context) ?? null;
}

describe('the label', () => {
  it('says what the field is, not what the column is called', () => {
    expect(fieldLabel('shortDescription')).toBe('short description');
    expect(fieldLabel('imageUrl')).toBe('picture');
    expect(fieldLabel('nameLocal')).toBe('name in other languages');
    expect(fieldLabel('location')).toBe('coordinates');
    expect(fieldLabel('metadata.totalArtworkSitelinks')).toBe('fame total');
  });

  it('names a key inside the source data exactly as the changeset’s own row for it', () => {
    expect(keyMeaningOf('metadata', 'dateInscribed')).toBe(meaningOf('metadata.dateInscribed'));
    expect(keyMeaningOf('metadata', 'dateInscribed').label).toBe('inscribed');
  });

  it('names a language the same whichever way its row arrived', () => {
    // A run files `nameLocal.ko` on its own since #728; a card filed before that
    // carries the whole map for `changedKeys` to split. Both make a row, and a
    // row that read "extra data from the source, stored under this name" would
    // say a corrected Korean name is a fact nobody sees.
    expect(meaningOf('nameLocal.ko')).toEqual(keyMeaningOf('nameLocal', 'ko'));
    expect(fieldLabel('nameLocal.ko')).toBe('name in Korean');
    expect(meaningOf('nameLocal.ko').unseen).toBeUndefined();
    // A code no one has described is still a language and not "extra data": the
    // language arm is decided by the field's family, never by whether the
    // vocabulary happens to have heard of the code.
    expect(fieldLabel('nameLocal.zz-quux')).toMatch(/^name in /);
  });

  it('falls back to spaced words for a field nobody has described yet, and says so', () => {
    const unknown = meaningOf('metadata.someNewField');
    expect(unknown.label).toBe('some new field');
    expect(unknown.what).toContain('Nothing on the site reads it by name today');
  });

  it('leaves a key alone when there is no camelCase in it to open up', () => {
    expect(meaningOf('metadata.criteria').label).toBe('inscription criteria');
    expect(meaningOf('metadata.zh-Hans').label).toBe('zh-Hans');
  });

  it('names a work’s fields, which arrive without a prefix from one level down', () => {
    expect(fieldLabel('artists')).toBe('attribution');
    expect(fieldLabel('image_url')).toBe('picture');
  });
});

describe('tag and language names', () => {
  it('says a criterion tag as the criterion', () => {
    expect(tagLabel('criterion_ii')).toBe('criterion (ii)');
    expect(tagLabel('in_danger')).toBe('in danger');
    expect(tagLabel('outdoor')).toBe('outdoor');
  });

  it('names the six languages UNESCO publishes in, and whatever else arrives', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('zh')).toBe('Chinese');
    expect(keyMeaningOf('nameLocal', 'ar').label).toBe('name in Arabic');
    expect(languageName('de')).toBe('German');
  });
});

describe('values as readers see them', () => {
  it('reads a negative year as BC, grouped when it is Palaeolithic', () => {
    expect(said('metadata.year', 1967)).toBe('1967');
    expect(said('metadata.year', -1000)).toBe('1,000 BC');
    expect(said('metadata.year', -400000)).toBe('400,000 BC');
  });

  it('puts the unit a traveller thinks in beside the hectares', () => {
    // Rietveld Schröder House, and the French Austral Lands and Seas.
    expect(said('metadata.areaHectares', 0.0075)).toBe('0.01 ha (75 m²)');
    expect(said('metadata.areaHectares', 158.9265)).toBe('158.93 ha (1.59 km²)');
    expect(said('metadata.areaHectares', 166267100)).toBe('166,267,100 ha (1,662,671 km²)');
    expect(said('metadata.areaHectares', 3.04)).toBe('3.04 ha');
  });

  it('reads the danger listing as a year', () => {
    expect(said('metadata.dangerList', 'Y 2003')).toBe('listed since 2003');
    expect(said('metadata.dangerList', 'Y')).toBe('listed');
    expect(said('metadata.dangerList', null)).toBe('not listed');
  });

  it('shows the In Danger badge as the badge readers see, with its year', () => {
    expect(said('metadata.inDanger', true, { proposed: [], dangerSince: 2003 })).toBe('In Danger since 2003');
    expect(said('metadata.inDanger', false)).toBe('no badge');
  });

  it('says a boolean as the fact it stands for', () => {
    expect(said('metadata.transboundary', false)).toBe('no — within one country');
  });

  it('names the photographer and links the terms', () => {
    render(<>{meaningOf('metadata.imageCredit').render?.({
      author: 'Graciela Gonzalez Brigas', license: '© UNESCO',
      detailsUrl: 'https://whc.unesco.org/en/list/208', licenseUrl: null,
    }, NO_CONTEXT)}</>);
    expect(screen.getByText(/Graciela Gonzalez Brigas · © UNESCO/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'terms' })).toHaveAttribute('href', 'https://whc.unesco.org/en/list/208');
  });

  it('names the work a museum was admitted for, linked, without a bare Q-number', () => {
    render(<>{meaningOf('metadata.admittedFor').render?.({ qid: 'Q45130', label: 'The Geographer' }, NO_CONTEXT)}</>);
    const link = screen.getByRole('link', { name: 'The Geographer' });
    expect(link).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q45130');
  });

  it('glosses a Wikidata identifier and refuses to link one that is not one', () => {
    render(<>{meaningOf('metadata.wikidataQid').render?.('Q19675', NO_CONTEXT)}</>);
    expect(screen.getByRole('link', { name: 'Q19675 (Wikidata)' })).toBeInTheDocument();
    expect(said('metadata.wikidataQid', 'javascript:alert(1)')).toBe('javascript:alert(1)');
  });

  it('says tags and countries as lists of words', () => {
    expect(said('tags', ['criterion_ii', 'in_danger'])).toBe('criterion (ii), in danger');
    expect(said('countryNames', ['France', 'Belgium'])).toBe('France, Belgium');
  });
});

describe('what a change means, in one line', () => {
  /**
   * The contexts the queue can actually produce. `withDangerFields` dates a listing only
   * on a row whose flag is true, so a card about a site the Committee has just listed —
   * flag false, about to be true — carries the year in its own proposal, not on the object.
   */
  const justListed: ChangeContext = {
    proposed: [
      { field: 'metadata.inDanger', old: false, new: true },
      { field: 'metadata', old: { website: 'https://whc.unesco.org/en/list/208' },
        new: { website: 'https://whc.unesco.org/en/list/208', dangerList: 'Y 2026' } },
    ],
    inDanger: false,
    dangerSince: null,
  };
  const repaired: ChangeContext = { proposed: [{ field: 'metadata.inDanger', old: false, new: true }], inDanger: true, dangerSince: 2003 };

  it('reads a site entering the danger list against what readers see, dated from the card', () => {
    expect(change('metadata.inDanger', false, true, justListed))
      .toBe('Listed since 2026 — readers see no badge today; publishing adds it.');
    // The badge in "the run proposes" carries the same year.
    expect(said('metadata.inDanger', true, justListed)).toBe('In Danger since 2026');
    // A listing row of its own dates it too.
    expect(change('metadata.inDanger', false, true, {
      proposed: [{ field: 'metadata.dangerList', old: null, new: 'Y 2026' }], inDanger: false, dangerSince: null,
    })).toBe('Listed since 2026 — readers see no badge today; publishing adds it.');
    // And a card carrying no year says so by leaving it out, never by inventing one.
    expect(change('metadata.inDanger', false, true, { proposed: [], inDanger: false, dangerSince: null }))
      .toBe('Readers see no badge today; publishing adds it.');
  });

  it('reads the #600 repair as what it is: readers already see the badge', () => {
    expect(change('metadata.inDanger', false, true, repaired))
      .toBe('Readers already see this badge — the flag was repaired after the card was filed; publishing changes nothing here.');
    expect(change('metadata.inDanger', true, false)).toBe('Taken off the danger list — publishing removes the badge.');
  });

  it('does not turn an unknown badge status into "no badge"', () => {
    // A context built without the object's own status must not claim what readers see.
    expect(change('metadata.inDanger', false, true, { proposed: [] }))
      .toBe('The source now lists this site as in danger.');
    expect(change('metadata.inDanger', false, true, { proposed: justListed.proposed })).toBe('Listed since 2026.');
  });

  it('reads the listing string as an event: listed, listed again, no longer listed', () => {
    expect(change('metadata.dangerList', null, 'Y 2026')).toBe('Listed in 2026.');
    // The Everglades: listed 1993, removed 2007, listed again 2010.
    expect(change('metadata.dangerList', 'Y 1993', 'Y 2010')).toBe('Listed again in 2010, after 1993 — the emergency is current.');
    expect(change('metadata.dangerList', 'Y 2018', null)).toBe('No longer listed.');
  });

  it('warns that an inscription year does not change', () => {
    // Garamba National Park: inscribed 1980; a card proposed 2026.
    expect(change('metadata.dateInscribed', '1980', '2026')).toBe('Inscription years do not change — check the source page.');
    expect(meaningOf('metadata.dateInscribed').event).toBe(true);
  });

  it('says how far and which way a pin moved, and warns past the server’s kilometre', () => {
    expect(change('location', { lon: 4.0, lat: 49.0 }, { lon: 4.0, lat: 49.3 }))
      .toBe('Moved 33.4 km north — may fall in a different region; check the pin.');
    // 500 m east: minor to the server, and no warning here.
    expect(change('location', { lon: 34.8333, lat: -2.3333 }, { lon: 34.8378, lat: -2.3333 }))
      .toBe('Moved 500 m east.');
  });

  it('tells a spelling change of a country from a change of country', () => {
    const names = { field: 'countryNames', old: ['United States of America'], new: ['United States'] };
    expect(change('countryNames', names.old, names.new, { proposed: [names] }))
      .toBe('Spelling only — the country is the same.');
    const codes = { field: 'countryCodes', old: ['US'], new: ['CA'] };
    expect(change('countryNames', ['United States'], ['Canada'], { proposed: [names, codes] }))
      .toBe('The country changed — see the country codes row.');
  });

  it('reads a boundary change as a factor, and a small move as a re-measurement', () => {
    expect(change('metadata.areaHectares', 100, 250)).toBe('Boundary grew ×2.5 — an extension, or a correction.');
    expect(change('metadata.areaHectares', 250, 100)).toBe('Boundary shrank ×2.5 — an extension, or a correction.');
    expect(change('metadata.areaHectares', 1476300, 1476999)).toBe('Re-measured; same boundary.');
    // Arriving: the row already says "new", and a sentence would repeat it.
    expect(change('metadata.areaHectares', null, 3.04)).toBeNull();
  });

  it('reads a credit arriving as readers seeing the picture uncredited, and a new author as a new picture', () => {
    const brigas = { author: 'Graciela Gonzalez Brigas', license: '© UNESCO' };
    expect(change('metadata.imageCredit', null, brigas)).toBe('Readers see the picture uncredited today.');
    expect(change('metadata.imageCredit', brigas, { ...brigas, author: 'Someone Else' }))
      .toBe('A different photographer — check the picture is the one this credit is for.');
    expect(change('metadata.imageCredit', brigas, { ...brigas, license: 'CC BY 4.0' })).toBeNull();
  });

  it('says criteria arriving as what readers see, and a change as a likely correction', () => {
    expect(change('metadata.criteria', null, '(i)(ii)')).toBe('Readers see no criteria for this site today.');
    expect(change('metadata.criteria', '(i)', '(i)(ii)')).toBe('Criteria change only on extension or renomination — likely a correction.');
  });

  it('flags a change of centuries on a work’s year, and lets a few years pass', () => {
    expect(change('metadata.year', 1967, 1968)).toBeNull();
    expect(change('metadata.year', -1000, 710)).toBe('Centuries apart — check it is the same object.');
  });

  it('has no sentence for a text a person simply rewrote', () => {
    expect(change('shortDescription', 'a', 'b')).toBeNull();
    expect(change('name', 'a', 'b')).toBeNull();
  });

  it('knows which facts no reader surface shows, so a card can say what publishing changes', () => {
    // Measured against the expanded row, Discover's card and its detail panel: they read
    // the date, the badge, the two links, the picture and its credit — and nothing else.
    ['metadata.criteria', 'metadata.region', 'metadata.areaHectares', 'metadata.sitelinksCount', 'tags', 'metadata.someNewField']
      .forEach(field => expect(meaningOf(field).unseen, field).toBe(true));
    ['imageUrl', 'shortDescription', 'metadata.imageCredit', 'metadata.inDanger', 'metadata.dateInscribed', 'metadata.website']
      .forEach(field => expect(meaningOf(field).unseen, field).toBeUndefined());
  });

  it('marks the facts whose change is an event in the world, and only those', () => {
    const events = ['metadata.inDanger', 'metadata.dangerList', 'location', 'countryCodes', 'metadata.wikidataQid', 'metadata.region'];
    events.forEach(field => expect(meaningOf(field).event, field).toBe(true));
    ['name', 'shortDescription', 'metadata.criteria', 'metadata.imageCredit'].forEach(field => expect(meaningOf(field).event, field).toBeUndefined());
  });
});
