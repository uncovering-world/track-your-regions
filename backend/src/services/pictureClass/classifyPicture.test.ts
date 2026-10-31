/**
 * What a picture is, from what Commons states (#2192), on the cases the
 * 2026-10-31 walkthrough found: Banqiao Dam's map, Larsa's map of Hammurabi's
 * Babylonia, the Aztec sun stone's vector rendering, the Saqqara Tablet's 1865
 * engraving — and the photographs and paintings the rule must leave alone.
 */

import { describe, it, expect } from 'vitest';
import { categoriesOf, classifyPicture } from './classifyPicture.js';

describe('what a picture is, from what Commons states', () => {
  it('reads a map off its categories, whatever the file type', () => {
    expect(classifyPicture({ mime: 'image/png', categories: ['Banqiao Dam', 'Maps of dams in China'] }))
      .toEqual({ class: 'map', basis: 'Maps of dams in China' });
    expect(classifyPicture({ mime: 'image/svg+xml', categories: ['SVG maps of Mesopotamia', 'Larsa'] }))
      .toEqual({ class: 'map', basis: 'SVG maps of Mesopotamia' });
    // An engraved map is a map: the map category decides first.
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Engravings of Rome', 'Old maps of Rome'] }).class).toBe('map');
    // The head noun decides: Vermeer's Art of Painting shows a map and is no map.
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Paintings of people with maps', 'The Art of Painting'] }).class).toBe('photograph');
    expect(classifyPicture({ mime: 'image/png', categories: ['Georeferenced maps in Wikimaps Warper'] }).class).toBe('map');
  });

  it('reads a drawing or engraving off its categories, and a vector file as a drawing', () => {
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Saqqara Tablet', 'Engravings of Egypt (1865)'] }))
      .toEqual({ class: 'drawing', basis: 'Engravings of Egypt (1865)' });
    expect(classifyPicture({ mime: 'image/svg+xml', categories: ['Aztec sun stone'] }))
      .toEqual({ class: 'drawing', basis: 'image/svg+xml' });
    expect(classifyPicture({ mime: 'image/png', categories: ['Lithographs of Paris'] }).class).toBe('drawing');
  });

  it('reads a diagram off its categories, and a building\'s elevation as the photograph it is', () => {
    expect(classifyPicture({ mime: 'image/png', categories: ['Floor plans of cathedrals'] }))
      .toEqual({ class: 'diagram', basis: 'Floor plans of cathedrals' });
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Cross-sections of bridges'] }).class).toBe('diagram');
    // "Southern elevation of the British Museum" is a photograph of the facade (measured 2026-10-31).
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Southern elevation of the British Museum'] }).class).toBe('photograph');
  });

  it("reads a work's categories only where the work is an object a drawing can only depict", () => {
    // Dürer's Adam and Eve is an engraving, Goya's Boys playing soldiers a painting in "Sketches by
    // Francisco de Goya": the categories name the work's medium, and a photograph of each is right.
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Engravings by Albrecht Dürer'] }, { kind: 'work', type: 'engraving' }).class).toBe('photograph');
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Sketches by Francisco de Goya'] }, { kind: 'work', type: 'painting' }).class).toBe('photograph');
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Turin Papyrus Map'] }, { kind: 'work', type: 'papyrus' }).class).toBe('photograph');
    // The Saqqara Tablet is an inscription: an 1865 engraving of it is a drawing of the object.
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Engravings of Egypt (1865)'] }, { kind: 'work', type: 'inscription' }))
      .toEqual({ class: 'drawing', basis: 'Engravings of Egypt (1865)' });
    // A vector file is a drawing of anything: the Aztec sun stone's rendering.
    expect(classifyPicture({ mime: 'image/svg+xml', categories: ['Aztec sun stone'] }, { kind: 'work', type: 'sculpture' }).class).toBe('drawing');
    expect(classifyPicture({ mime: 'image/svg+xml', categories: [] }, { kind: 'work', type: 'painting series' }).class).toBe('drawing');
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Drawings of vases'] }, { kind: 'work', type: null }).class).toBe('photograph');
  });

  it('calls a raster file in no such category a photograph, and leaves paintings alone', () => {
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Hermitage Museum', 'Photographs of Saint Petersburg'] }))
      .toEqual({ class: 'photograph', basis: 'image/jpeg' });
    // A photograph of a painting is the right picture of a work that is a painting.
    expect(classifyPicture({ mime: 'image/jpeg', categories: ['Girl with a Pearl Earring', 'Paintings by Johannes Vermeer in the Mauritshuis'] }).class)
      .toBe('photograph');
    expect(classifyPicture({ mime: 'image/tiff', categories: ['Piedra del Sol'] }).class).toBe('photograph');
  });

  it('classes nothing it was told nothing about', () => {
    expect(classifyPicture({ mime: null, categories: [] })).toEqual({ class: null, basis: null });
    expect(classifyPicture({ mime: 'application/pdf', categories: [] })).toEqual({ class: null, basis: null });
  });

  it("splits Commons' category string on the bar and drops the empty parts", () => {
    expect(categoriesOf('Banqiao Dam|Maps of dams in China|')).toEqual(['Banqiao Dam', 'Maps of dams in China']);
    expect(categoriesOf(null)).toEqual([]);
  });
});
