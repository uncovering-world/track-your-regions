/**
 * The URL rule a curator's write asks again where the value is stored (#693),
 * shared by the edit and the manual creation of a place.
 */

/**
 * The same rule the request schema applied, asked again where the value is
 * written. Both routes that call it parse their body with that schema first, so this
 * is a second layer and not the only one — but it is the layer a direct call
 * to the handler still passes through, and it reads the rule and its wording from
 * `urlSafety.ts` rather than restating either: a second spelling here can
 * disagree with the schema's about whitespace, which is how a scheme behind
 * one space gets stored (#693).
 *
 * It covers the picture as well as the two links: leaving the picture out
 * leaves the second layer absent from the one field #693 was actually about.
 */
export function refusalFor(value: unknown, isStorable: (url: string) => boolean, message: string): string | null {
  return typeof value === 'string' && value && !isStorable(value) ? message : null;
}

