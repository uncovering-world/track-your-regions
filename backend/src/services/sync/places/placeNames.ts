/**
 * Which people a place's own name names (#2404): of a scene's figures, the
 * one a monument is named for, and of the people a war memorial's sources
 * name, the one a bust shows (#2412).
 */

import type { CommemoratedSubject } from '@tyr/shared/commemorates';

/** The words of a name a reader would know a person by: four letters or more, a capital first. */
function nameWords(name: string): string[] {
  return name.split(/[^\p{L}]+/u).filter((word) => word.length >= 4 && /^\p{Lu}/u.test(word));
}

/** Of a scene's people, those whose name the place's own name carries: "Luther monument Worms" → Martin Luther. */
export function namedInPlace(people: CommemoratedSubject[], placeName: string | undefined): CommemoratedSubject[] {
  const words = wordsOf(placeName);
  return people.filter((person) => nameWords(person.label).some((word) => words.has(word.toLowerCase())));
}

/**
 * Of the people, those whose every name word the place's own name carries:
 * the bust of Roman Shukhevych names him, and the town of Lindley does not
 * name the missionary Daniel Lindley it was named after (#2412).
 */
export function wholeNameInPlace(people: CommemoratedSubject[], placeName: string | undefined): CommemoratedSubject[] {
  const words = wordsOf(placeName);
  return people.filter((person) => {
    const name = nameWords(person.label);
    return name.length > 0 && name.every((word) => words.has(word.toLowerCase()));
  });
}

/** The name words of a place's name, lower-cased. */
function wordsOf(placeName: string | undefined): Set<string> {
  return new Set(nameWords(placeName ?? '').map((word) => word.toLowerCase()));
}
