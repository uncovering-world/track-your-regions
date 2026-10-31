/**
 * Jev's judgement of two near places with similar names (#1249, ADR-0087).
 * POST /api/experiences/:id/merge-proposal-suggestions
 *
 * For each open pair of the place the card is about, the stored judgement
 * where one was made for the pair as it stands, or a new one: the pairs not
 * yet judged go to Jev in one call, a `choice` question per pair — one place,
 * two places, or one part of the other — and each answer is stored with its
 * confidence and the pair it was about (`mergeProposalSuggestions.ts`). A
 * deployment without Jev answers that it has none. The judgement is shown
 * beside the pair and never applied: a curator decides. A POST because a call
 * may be made, and paid for.
 *
 * What Jev is sent is the catalogue's: both places' names, kinds, Wikidata
 * items and countries, the distance between them, how alike the names are
 * and whether they are the same name, and the reach the pair was found under.
 * Nothing about the curator or any traveller.
 */

import type { z } from 'zod/v4';
import type { MergeProposalSuggestions } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { askJevChoices, jevConfigured, type JevChoiceAsked } from '../../services/jev/jevClient.js';
import type { idParamSchema } from '../../types/index.js';
import { mergeProposalsScope } from './mergeProposalController.js';
import {
  askedPairSql, recordMergeSuggestions, type MergeSuggestion, type PairJudgement,
} from './mergeProposalSuggestions.js';
import { itemClaimedSql, itemSql, kindNamesSql, partOfSql } from './reviewQueueMergeProposals.js';
import { mergeProposalOpenSql } from './reviewQueuePredicates.js';

interface PairRow {
  proposalId: number;
  otherId: number;
  otherName: string;
  otherKinds: string[];
  /** The serial site the other place is a part of, where it is one (#1250). */
  otherPartOf: string | null;
  otherItem: string | null;
  /** Whether the other place claims that item as its own in the registry, or only refers to it (#2194). */
  otherItemClaimed: boolean;
  otherCountries: string[];
  distanceM: number;
  similarity: number;
  exact: boolean;
  foundBy: 'similar' | 'words';
  /** The words a containment stood on, for the words rule (#2194); null before they were recorded. */
  matchedWords: string[] | null;
  reachM: number;
  /** The pair as the question is built from it (`askedPairSql`), read with the pair: what its judgement is recorded for. */
  asked: Record<string, unknown>;
  stored: { judgement: PairJudgement | null; confidence: number } | null;
}

interface Anchor {
  name: string;
  kinds: string[];
  partOf: string | null;
  item: string | null;
  /** Whether the anchor claims that item as its own in the registry, or only refers to it (#2194). */
  itemClaimed: boolean;
  countries: string[];
  pairs: PairRow[];
}

/** The three things Jev can say of a pair, as the options it reads. */
const CRITERIA: Record<PairJudgement, string> = {
  one: 'The two are one place: the same building, monument, museum or site listed twice, once by each kind — a '
    + 'cathedral that is also an inscribed World Heritage site, a monument that is also an archaeological site — '
    + 'the one thing a traveller stands in front of, whatever each listing calls it',
  two: 'The two are two places: neighbours that stand apart, however close — a gallery beside a museum, two monuments '
    + 'on one square, two churches in one quarter, a site and the museum that shows its finds',
  part_of: 'One lies within the other and is part of it: a cathedral within an inscribed old town, a gate or tower '
    + 'of a fort, a chapel inside a palace, one temple of a group — two places, the smaller inside the larger, which a '
    + 'traveller visits by going into the other',
};

const words = (list: readonly string[], none: string): string => (list.length > 0 ? list.join(', ') : none);
/**
 * What a place is, as the question says it: the kinds it is in, and for a
 * serial site's part, which is in no kind of its own, the site it is a
 * component of (#1250), said as what the place is, never as where it lies.
 */
const whatItIs = (kinds: readonly string[], partOf: string | null): string => {
  if (partOf === null) return `is in ${words(kinds, 'no kind')}`;
  const component = `is a component of the World Heritage site "${partOf}"`;
  return kinds.length > 0 ? `${component} and is in ${kinds.join(', ')}` : component;
};
const itemWords = (item: string | null): string => (item ? `Wikidata item ${item}` : 'no Wikidata item');

/**
 * What the two places' items say. Different items tell apart two things more
 * often than they split one. One item on both is one place's own where only
 * that place claims it (#2194): the Saint Stepanos Monastery's item is carried
 * by each of the ensemble's three components, so the question is whether the
 * main church is the monastery, or a part of it. Claimed by both, it is the
 * strongest sign of one place a pair carries.
 */
function itemsWords(anchor: Anchor, pair: PairRow): string {
  if (!anchor.item || !pair.otherItem) return '';
  if (anchor.item !== pair.otherItem) {
    return 'The two carry different Wikidata items, which tells apart two things more often than it splits one. ';
  }
  if (anchor.itemClaimed && pair.otherItemClaimed) return `Both claim the Wikidata item ${anchor.item} as their own. `;
  if (!anchor.itemClaimed && !pair.otherItemClaimed) {
    return `Both carry the Wikidata item ${anchor.item}, neither as its own: several places carry it. `;
  }
  const [owner, carrier] = anchor.itemClaimed ? [anchor.name, pair.otherName] : [pair.otherName, anchor.name];
  return `The Wikidata item ${anchor.item} is "${owner}"'s own; "${carrier}" carries it too, as several places do, `
    + 'and only refers to it. ';
}

/**
 * Why the words rule asked: the words it stood on (#2194), since "every
 * significant word of one name stands in the other's" overstates a match on
 * a town's name alone. Said of the places' names, not of the two shown: the
 * rule reads every name a place is known by (`foldedNamesSql`), and the word
 * may stand in a source's or a local name the question does not print.
 */
function withinWords(matched: string[] | null): string {
  if (matched === null) return 'Every significant word of one of the places\' names stands in one of the other\'s. ';
  const quoted = matched.map(word => `"${word}"`).join(', ');
  return matched.length === 1
    ? `The one significant word the two places' names share is ${quoted}. `
    : `Every significant word of one of the places' names stands in one of the other's: ${quoted}. `;
}

/** The question for one pair: both places as data, how they stand to each other, and what to decide. */
export function questionFor(anchor: Anchor, pair: PairRow): JevChoiceAsked {
  const items = itemsWords(anchor, pair);
  const sameName = pair.exact ? 'They carry one and the same name and stand within fifty metres. ' : '';
  // A short name inside a long title reads as unlike by trigrams: say why the pair was asked (#1652).
  const within = pair.foundBy === 'words' ? withinWords(pair.matchedWords) : '';
  return {
    instructions: `The place "${anchor.name}" ${whatItIs(anchor.kinds, anchor.partOf)} and has ${itemWords(anchor.item)}. `
      + `Within ${pair.reachM} m of it, the place "${pair.otherName}" ${whatItIs(pair.otherKinds, pair.otherPartOf)}, in `
      + `${words(pair.otherCountries, 'no named country')}, and has ${itemWords(pair.otherItem)}; the two stand `
      + `${pair.distanceM} m apart and their names are `
      + `${Math.round(pair.similarity * 100)} % alike. ${sameName}${within}${items}Each kind lists what it covers under its own `
      + 'name, so one building can be a place of worship to one list and an archaeological site or a World Heritage '
      + 'site to another. Are the two one place, two places, or is one part of the other?',
    criteria: CRITERIA,
  };
}

async function openPairsOf(anchorId: number): Promise<Anchor | null> {
  const result = await pool.query<{
    name: string; kinds: string[]; part_of: string | null; item: string | null; item_claimed: boolean; countries: string[] | null;
    pairs: PairRow[] | null;
  }>(
    `SELECT a.name, ${kindNamesSql('a')} AS kinds, ${partOfSql('a')} AS part_of, ${itemSql('a')} AS item,
            ${itemClaimedSql('a')} AS item_claimed, a.country_names AS countries,
            (SELECT jsonb_agg(jsonb_build_object(
                      'proposalId', p.id, 'otherId', b.id, 'otherName', b.name, 'otherKinds', ${kindNamesSql('b')},
                      'otherPartOf', ${partOfSql('b')},
                      'otherItem', ${itemSql('b')}, 'otherItemClaimed', ${itemClaimedSql('b')},
                      'otherCountries', COALESCE(b.country_names, '{}'),
                      'distanceM', p.distance_m, 'similarity', p.name_similarity, 'exact', p.exact, 'reachM', p.reach_m, 'foundBy', p.found_by,
                      'matchedWords', p.matched_words,
                      'asked', ${askedPairSql('p', 'a', 'b')},
                      'stored', (SELECT jsonb_build_object('judgement', g.judgement, 'confidence', g.confidence)
                                   FROM experience_merge_suggestions g
                                  WHERE g.place_a = p.place_a AND g.place_b = p.place_b
                                    AND g.asked = ${askedPairSql('p', 'a', 'b')}
                                  ORDER BY g.asked_at DESC, g.id DESC LIMIT 1)) ORDER BY p.id)
               FROM experience_merge_proposals p
               JOIN experiences b ON b.id = p.place_b
              WHERE p.place_a = a.id AND ${mergeProposalOpenSql('p', 'a', 'b')}) AS pairs
       FROM experiences a WHERE a.id = $1`,
    [anchorId],
  );
  const row = result.rows[0];
  return row
    ? {
        name: row.name, kinds: row.kinds, partOf: row.part_of, item: row.item, itemClaimed: row.item_claimed,
        countries: row.countries ?? [], pairs: row.pairs ?? [],
      }
    : null;
}

/** Record one call's judgements under the anchor's lock. */
async function store(anchorId: number, model: string, suggestions: readonly MergeSuggestion[]): Promise<void> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await lockExperience(client, anchorId);
    if (locked) await recordMergeSuggestions(client, locked.lock, model, suggestions);
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

type Suggestion = MergeProposalSuggestions['suggestions'][number];

/** A stored judgement as the card shows it; none for an answer the client refused. */
function shown(pair: PairRow, judgement: PairJudgement | null, confidence: number): Suggestion | null {
  return judgement === null ? null : { proposalId: pair.proposalId, judgement, confidence: Number(confidence) };
}

/**
 * The call's input tokens shared out over its questions, whole tokens each,
 * the remainder on the first: the rows added up are what the call cost.
 */
function sharedOut(inputTokens: number, count: number): number[] {
  const each = Math.floor(inputTokens / count);
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? inputTokens - each * count : 0));
}

/**
 * Ask Jev about the pairs not yet judged as they stand, in one call, and
 * record every answer: a refused one with no judgement, so the same pair is
 * not paid for again. Answers what the card may show. A call that fails
 * leaves those pairs without a judgement; the next opening asks again.
 */
async function judge(anchorId: number, anchor: Anchor, pairs: readonly PairRow[]): Promise<Suggestion[]> {
  if (pairs.length === 0) return [];
  try {
    const questions = Object.fromEntries(pairs.map(pair => [`p${pair.proposalId}`, questionFor(anchor, pair)]));
    const { answers, model, inputTokens } = await askJevChoices(
      { place: anchor.name, kinds: anchor.kinds, countries: anchor.countries }, questions,
    );
    const shares = sharedOut(inputTokens, pairs.length);
    const judged = pairs.map((pair, i): MergeSuggestion => {
      const answer = answers[`p${pair.proposalId}`];
      const about = { proposalId: pair.proposalId, placeB: pair.otherId, asked: JSON.stringify(pair.asked) };
      return !answer || 'refused' in answer
        ? { ...about, judgement: null, confidence: 0, probabilities: {}, inputTokens: shares[i] }
        : {
          ...about, judgement: answer.choice as PairJudgement, confidence: answer.confidence,
          probabilities: answer.probabilities, inputTokens: shares[i],
        };
    });
    await store(anchorId, model, judged);
    return judged
      .map(s => shown(pairs.find(pair => pair.proposalId === s.proposalId)!, s.judgement, s.confidence))
      .filter((s): s is Suggestion => s !== null);
  } catch (error) {
    // No judgement for these pairs: the card shows them without one, exactly
    // as on a deployment without Jev.
    console.error('[jev] no judgement for the near places of experience %d:', anchorId, error);
    return [];
  }
}

export async function suggestMergeProposals(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<MergeProposalSuggestions> {
  const { permitted, found } = await mergeProposalsScope(caller.id, caller.role, id);
  if (!found) throw notFound('Experience not found');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (!jevConfigured()) return { configured: false, suggestions: [] };
  const anchor = await openPairsOf(id);
  if (!anchor) throw notFound('Experience not found');
  // Judged already for the pair as it stands: Jev's word, or none where its
  // answer was refused — either way not asked, nor paid for, again.
  const kept = anchor.pairs
    .filter(pair => pair.stored)
    .map(pair => shown(pair, pair.stored!.judgement, pair.stored!.confidence))
    .filter((s): s is Suggestion => s !== null);
  const fresh = await judge(id, anchor, anchor.pairs.filter(pair => !pair.stored));
  return { configured: true, suggestions: [...kept, ...fresh] };
}
