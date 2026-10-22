import type { ExperienceSource } from '../../api/admin';

/**
 * The cards the panel draws, in the panel's order: a source that runs alone is
 * a card, and a pass is one card holding its sources in the order it runs them
 * (ADR-0132), placed where the first of them stands in the order.
 */
export function cardsOf(sources: ExperienceSource[]): ExperienceSource[][] {
  const placed = new Set<number>();
  const cards: ExperienceSource[][] = [];
  for (const source of sources) {
    if (placed.has(source.id)) continue;
    const members = source.pass.length > 0
      ? source.pass.map((id) => sources.find((other) => other.id === id)).filter((s): s is ExperienceSource => !!s)
      : [source];
    members.forEach((member) => placed.add(member.id));
    cards.push(members);
  }
  return cards;
}
