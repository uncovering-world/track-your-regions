/**
 * Public art's type (#2279): which of its eight types a work is filed under,
 * read from its classes, its genre, what it depicts and, for a fountain or a
 * clock no class names, its label and description. Each case is a work Public
 * art admitted on the development catalogue on 2026-11-10, with the classes,
 * genres and depicted items the subset gave it.
 */

import { describe, expect, it } from 'vitest';
import { buildTrees } from './classes.js';
import { publicArtType, typeByDepicted, type KindFacts } from './kindRules.js';

const SCULPTURE = 'Q860861';
const STATUE = 'Q179700';
const FOUNTAIN = 'Q483453';
const HORSE = 'Q726';
const HUMAN = 'Q5';

const trees = buildTrees({ sculptural: [SCULPTURE, STATUE], fountain: [FOUNTAIN], commemorative: [], museum: [], worship: [], lost: [] });
const work = (over: Partial<KindFacts>): KindFacts => ({ classes: [SCULPTURE], commemorates: [], genres: [], subjects: [], ...over });

describe("Public art's type", () => {
  it('files a work under the eight types by its classes and genre', () => {
    // Christ the Redeemer: colossal statue of Jesus. The Statue of Bartolomeo Colleoni: equestrian statue.
    expect(publicArtType(work({ classes: ['Q29168169', 'Q1779653', STATUE] }), trees)).toBe('religious-statue');
    expect(publicArtType(work({ classes: ['Q659396'] }), trees)).toBe('equestrian-statue');
    // The Big Merino: big thing in Australia. The Big Nickel: oversized object.
    expect(publicArtType(work({ classes: [SCULPTURE, 'Q14915208', 'Q4823517'] }), trees)).toBe('roadside-giant');
    expect(publicArtType(work({ classes: ['Q811430', 'Q130478367'] }), trees)).toBe('roadside-giant');
    // The Spiral Jetty: earthworks, genre land art. Cadillac Ranch: installation artwork.
    expect(publicArtType(work({ classes: [SCULPTURE, 'Q11880367'], genres: ['Q326478'] }), trees)).toBe('installation');
    expect(publicArtType(work({ classes: [SCULPTURE, 'Q20437094'] }), trees)).toBe('installation');
    // Cloud Gate and the Little Mermaid stay sculptures.
    expect(publicArtType(work({}), trees)).toBe('sculpture');
  });

  it('files a statue of a rider on a horse as equestrian where no class says so', () => {
    // The Equestrian statue of Gattamelata depicts a horse and Erasmo of Narni.
    const rider = { classes: [HUMAN], worshipped: false };
    const horse = { classes: ['Q55983715'], worshipped: false };
    expect(publicArtType(work({ depicts: [HORSE, 'Q733404'], subjects: [horse, rider] }), trees)).toBe('equestrian-statue');
    // A horse alone is no rider's statue.
    expect(publicArtType(work({ depicts: [HORSE], subjects: [horse] }), trees)).toBe('sculpture');
  });

  it('files a clock and a fountain by a class beside the sculpture, or by the words of its label and description', () => {
    // The Corpus Clock: clock. The Lindwurmbrunnen: water well.
    expect(publicArtType(work({ classes: [SCULPTURE, 'Q376'] }), trees)).toBe('clock');
    expect(publicArtType(work({ classes: ['Q43483', 'Q2319498', STATUE] }), trees)).toBe('fountain');
    // The Brno astronomical clock is typed a movement and a sculpture; Manneken Pis a sculpture.
    expect(publicArtType(work({ classes: ['Q1149963', SCULPTURE], label: 'Brno astronomical clock', description: 'monument in Brno' }), trees))
      .toBe('clock');
    expect(publicArtType(work({ label: 'Manneken Pis', description: 'bronze sculpture and fountain by Jérôme Duquesnoy the Elder' }), trees))
      .toBe('fountain');
    // A maker's name or a neighbour after the description's head names nothing the work is.
    expect(publicArtType(work({ label: 'Concetto spaziale', description: 'sculpture by Lucio Fontana in Milan' }), trees)).toBe('sculpture');
    expect(publicArtType(work({ label: 'Mercury', description: 'statue beside the clock tower of the town hall' }), trees)).toBe('sculpture');
    // The Bucket Fountain is a kinetic sculpture, and a fountain first.
    expect(publicArtType(work({ classes: [SCULPTURE, 'Q29857932'], label: 'The Bucket Fountain' }), trees)).toBe('fountain');
  });

  it('reads the order that decides a work of two types', () => {
    // A public clock with a show is a clock before a fountain; a fountain before a religious statue.
    expect(publicArtType(work({ classes: ['Q5275', FOUNTAIN] }), trees)).toBe('clock');
    expect(publicArtType(work({ classes: [FOUNTAIN, 'Q29168168'] }), trees)).toBe('fountain');
    // A religious statue before an equestrian statue, an equestrian statue before an installation.
    expect(publicArtType(work({ classes: ['Q29168168', 'Q659396'] }), trees)).toBe('religious-statue');
    expect(publicArtType(work({ classes: ['Q659396', 'Q20437094'] }), trees)).toBe('equestrian-statue');
  });

  it('makes a plain sculpture a religious statue where its reading names a holy figure, and no other type', () => {
    // Our Lady of the Rockies depicts Mary; the Guishan Guanyin depicts Avalokiteśvara.
    expect(typeByDepicted('sculpture', true)).toBe('religious-statue');
    expect(typeByDepicted('sculpture', false)).toBe('sculpture');
    // The Monument to Stephen III of Moldavia is an equestrian statue of a canonised prince.
    expect(typeByDepicted('equestrian-statue', true)).toBe('equestrian-statue');
    expect(typeByDepicted('fountain', true)).toBe('fountain');
  });
});
