/**
 * A kind's rule in plain words (#2185, interface-writing rule 11): what a
 * curator reads behind ⓘ beside "<Kind> in the catalogue". Every word of it
 * comes from what the code states — the kind's types, its declaration's
 * refusals with the exceptions that lift them, and the lines of the admission
 * register its last run admitted by — so the rule a curator checks is the one
 * the run applies, never a summary that would lead them to refuse what it lets in.
 */

import type { KindRule } from '../../api/kindRule';
import { kindNoun, typeLabelFor, typeOptionsFor } from '../../utils/experienceTypes';

type KeptOut = NonNullable<KindRule['keptOut']>[number];
type World = NonNullable<KindRule['world']>;
type Near = NonNullable<KindRule['surroundings']>;

const count = (n: number) => n.toLocaleString('en');
/** The share of the pool a quantile lets in: 0.97 reads "3 %". */
const top = (quantile: number) => `${Math.round((1 - quantile) * 100)} %`;
/** A declaration's reason without the issue it cites: a curator reads the rule, not its ticket. */
const withoutTicket = (reason: string) => reason.replace(/ \(#\d+\)/g, '');
const withArticle = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "a", "a or b", "a, b or c". */
const either = (words: readonly string[]) =>
  (words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0] ?? '');

/** A readership year as a person says it: "2025-11 to 2026-10" reads "November 2025 to October 2026". */
function monthsOf(year: string): string {
  return year.replace(/(\d{4})-(\d{2})/g, (_, y: string, m: string) =>
    `${new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${y}`);
}

/** When a refusal does not hold, in words; empty where it always does. */
function unlessWords(refusal: KeptOut, kindId: number, kindName: string): string {
  const noun = kindNoun(kindId);
  switch (refusal.unless) {
    case 'types':
      return ` — unless it is also ${either(refusal.unlessTypes.map((t) => withArticle(typeLabelFor(kindId, t).toLowerCase())))}`;
    case 'anyType':
      return ' — unless it is also one of the types above';
    case 'ownClass':
      return ' — unless Wikidata also calls it ' + (noun ?? 'a place ' + kindName + ' holds');
    case 'anotherClass':
      return noun ? ` — unless Wikidata also calls it another kind of ${noun.replace(/^an? /, '')}` : ' — unless another class of the kind names it';
    default:
      return '';
  }
}

const MARKS: Record<World['marks'][number], string> = {
  wikivoyage: 'a travel guide',
  atlasObscura: 'Atlas Obscura',
  worldHeritageList: 'the World Heritage List',
};

function worldWords(world: World): string {
  const lines = [`• Wikipedia articles in ${count(world.editions)} languages or more (the top ${top(world.editionsQuantile)})`];
  if (world.readers !== null) lines.push(`• or ${count(world.readers)} readers a year or more (the top ${top(world.readersQuantile)})`);
  if (world.guidedReaders !== null) {
    lines.push(`• or ${count(world.guidedReaders)} readers a year when ${either(world.marks.map((m) => MARKS[m]))} names it`
      + ` (the top ${top(world.guidedQuantile)})`);
  }
  const after = [
    world.year && `Readers are counted from ${monthsOf(world.year)}.`,
    `A place already in stays while it reaches ${Math.round(world.stayShare * 100)} % of a line.`,
  ].filter(Boolean).join(' ');
  return [`A place gets in on its fame among the ${count(world.pool)} places the last run read:`, ...lines, after].join('\n');
}

/** A share of the median in words: 1 reads "that median", 0.25 "a quarter of that median". */
function ofTheMedian(share: number): string {
  if (share === 1) return 'that median';
  if (share === 0.5) return 'half that median';
  if (share === 0.25) return 'a quarter of that median';
  return `${share} times that median`;
}

function nearWords(near: Near, kindId: number): string {
  const tests = [
    `• travel guides that use it reach ${ofTheMedian(near.guideShare)}, among ${near.guideGroupFloor} places or more`,
    `• its Wikipedia languages reach ${ofTheMedian(near.editionsShare)}, among ${near.editionsGroupFloor} places or more`,
    `• its readers reach ${ofTheMedian(near.readersShare)}, among ${near.readersGroupFloor} places or more`,
  ];
  if (near.venues) {
    const share = ofTheMedian(near.venues.share).replace('that median', 'the median of the liveliest places around it');
    tests.push(`• the cafés, bars and restaurants within ${near.venues.radiusM} m reach ${share}, among ${near.venues.groupFloor} places or more`);
  }
  const words = [
    `Or on its fame nearby. It is measured against the median of the ${near.best} best places within ${near.radiusKm} km.`,
    `It needs Wikipedia articles in ${near.minLanguages} languages or more and about ${count(near.minReaders)} readers a year.`,
    'Then one of these must pass:',
    ...tests,
  ];
  const label = (t: string) => typeLabelFor(kindId, t).toLowerCase();
  if (near.guideOnlyTypes.length) {
    words.push(capital(`${withArticle(either(near.guideOnlyTypes.map(label)))} gets in only when a travel guide uses it.`));
  }
  if (near.heritageTypes.length) {
    words.push(capital(`${withArticle(either(near.heritageTypes.map(label)))} also gets in when a heritage designation still holds.`));
  }
  if (near.mapped) {
    const stands = [
      near.mapped.listedStands && 'the World Heritage List inscribes it',
      `a ruin under its name is mapped within ${count(near.mapped.namedRuinWithinM / 1000)} km`,
    ].filter(Boolean) as string[];
    words.push(`It also needs an OpenStreetMap object that marks it as the place, unless ${either(stands)}.`);
  }
  return words.join('\n');
}

/** The paragraphs of the kind's rule, joined for `HelpHint`; null where the code states nothing of it. */
export function kindRuleWords(rule: KindRule | undefined, kindId: number, kindName: string): string | null {
  const paragraphs: string[] = [];
  const types = typeOptionsFor(kindId).map((option) => option.label.toLowerCase());
  if (types.length) paragraphs.push(`${kindName} files a place as one of: ${types.join(', ')}.`);
  if (rule?.keptOut?.length) {
    const bullets = rule.keptOut.map((refusal) => '• ' + withoutTicket(refusal.reason) + unlessWords(refusal, kindId, kindName));
    paragraphs.push(['It keeps out:', ...bullets].join('\n'));
  }
  if (rule?.world) paragraphs.push(worldWords(rule.world));
  if (rule?.surroundings) paragraphs.push(nearWords(rule.surroundings, kindId));
  return paragraphs.length ? paragraphs.join('\n\n') : null;
}
