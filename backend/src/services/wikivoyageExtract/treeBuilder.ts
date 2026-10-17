/**
 * Recursive tree builder — uses fetcher + parser to build region hierarchy
 *
 * Ported from Python build_tree() + get_page_data().
 * Per-branch ancestor tracking (not global visited set) so the same region
 * can appear under multiple parents (e.g. Caucasus under both Asia and Europe).
 */

import type { TreeNode, PageData, ExtractionProgress, WikiSection, RegionPreview, PendingAIQuestion, InterviewQuestion, CountryContext } from './types.js';
import type { WikivoyageFetcher } from './fetcher.js';
import {
  findRegionsSection,
  parseRegionlist,
  parseBulletLinks,
  extractFileMapImage,
  extractImageCandidates,
} from './parser.js';
import OpenAI from 'openai';
import { extractRegionsWithAI, type AIExtractionAccumulator } from './aiRegionParser.js';
import { isOpenAIAvailable } from '../ai/openaiService.js';
import { formulateQuestion, processAnswer as processInterviewAnswer } from './aiInterviewer.js';
import { classifyEntity, computeMaxSubDepth, type ClassificationCache } from './aiClassifier.js';

export const CONTINENTS = [
  'Africa', 'Antarctica', 'Asia', 'Europe',
  'North America', 'Oceania', 'South America',
];

/** Build a Wikivoyage page URL from a title */
function wikivoyageUrl(title: string): string {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// ─── Page data fetching ─────────────────────────────────────────────────────

/** Fill regions from a parsed Regionlist section. */
function applyRegionlistResult(result: PageData, wikitext: string): void {
  const { mapImage, regions } = parseRegionlist(wikitext);
  result.mapImage = mapImage;
  result.mapImageCandidates = extractImageCandidates(wikitext);
  if (regions.length > 0) {
    result.regions = regions;
    // Flag pages with ambiguous regions for AI resolution.
    // Plain-text names with a single linked item (e.g., "Bechar Province" → items: ["Béchar"])
    // are standard grouping nodes — NOT ambiguous. Only flag when there's genuine ambiguity:
    // unlinked dead-ends (no items) OR multi-link plain-text names needing interpretation.
    const hasAmbiguity = regions.some(r => !r.hasLink && (r.items.length === 0 || r.items.length > 1));
    if (hasAmbiguity) {
      result.needsAI = true;
      result.rawWikitext = wikitext;
    }
  }
}

/** Parse wikitext from the Regions section and populate the page result. */
function populateFromRegionSection(result: PageData, wikitext: string): void {
  if (!wikitext) return;
  if (wikitext.includes('{{Regionlist') || wikitext.includes('{{regionlist')) {
    applyRegionlistResult(result, wikitext);
    return;
  }
  // No Regionlist — try plain bullet links
  const links = parseBulletLinks(wikitext);
  result.regions = links.map((link) => ({
    name: link, items: [], hasLink: true,
  }));
}

/** Fetch the Regions section wikitext for a page and return the string (empty when missing). */
async function fetchRegionSectionWikitext(
  fetcher: WikivoyageFetcher,
  resolved: string,
  sectionIdx: string,
): Promise<string> {
  const data = await fetcher.apiGet({
    action: 'parse', page: resolved, prop: 'wikitext',
    section: sectionIdx,
  }) as Record<string, unknown>;
  if ('error' in data) return '';
  const parse = data['parse'] as Record<string, unknown>;
  return (parse['wikitext'] as Record<string, string>)?.['*'] ?? '';
}

/** Merge image candidate URLs into result, preserving order and skipping duplicates. */
function mergeImageCandidates(result: PageData, additional: string[]): void {
  const existing = new Set(result.mapImageCandidates);
  for (const url of additional) {
    if (!existing.has(url)) {
      result.mapImageCandidates.push(url);
      existing.add(url);
    }
  }
}

/**
 * Apply fallback full-page wikitext: handles disambiguation skipping and map image fallback.
 * Returns true if disambiguation detected (result should be returned early).
 */
function applyFullPageFallback(result: PageData, fullWt: string): boolean {
  if (!fullWt) return false;
  if (fullWt.includes('Disambiguation banner') || fullWt.includes('{{disamb')) {
    result.regions = [];
    result.needsAI = false;
    return true;
  }
  if (!result.mapImage) {
    result.mapImage = extractFileMapImage(fullWt);
  }
  mergeImageCandidates(result, extractImageCandidates(fullWt));
  return false;
}

/** Fetch full-page wikitext (used as map-image fallback source). Returns '' if unavailable. */
async function fetchFullPageWikitext(fetcher: WikivoyageFetcher, resolved: string): Promise<string> {
  const data = await fetcher.apiGet({
    action: 'parse', page: resolved, prop: 'wikitext',
  }) as Record<string, unknown>;
  if ('error' in data) return '';
  const parse = data['parse'] as Record<string, unknown>;
  return (parse['wikitext'] as Record<string, string>)?.['*'] ?? '';
}

/**
 * Fetch and parse a single Wikivoyage page.
 * Returns structured page data including regions and map images.
 */
export async function getPageData(
  fetcher: WikivoyageFetcher,
  title: string,
): Promise<PageData> {
  // Step 1: Get sections
  const data = await fetcher.apiGet({
    action: 'parse', page: title, prop: 'sections', redirects: '1',
  }) as Record<string, unknown>;

  if ('error' in data) {
    return {
      resolved: title, exists: false, mapImage: null,
      mapImageCandidates: [], regions: [],
    };
  }

  const parseResult = data['parse'] as Record<string, unknown>;
  const resolved = (parseResult['title'] as string) ?? title;
  const sections = (parseResult['sections'] as WikiSection[]) ?? [];

  const result: PageData = {
    resolved,
    exists: true,
    mapImage: null,
    mapImageCandidates: [],
    regions: [],
  };

  if (sections.length === 0) return result;

  // Step 2: Parse Regions section
  const sectionIdx = findRegionsSection(sections);
  if (sectionIdx !== null) {
    const wikitext = await fetchRegionSectionWikitext(fetcher, resolved, sectionIdx);
    populateFromRegionSection(result, wikitext);
  }

  // Step 3: Fallback map image from full page wikitext
  if (!result.mapImage || result.mapImageCandidates.length === 0) {
    const fullWt = await fetchFullPageWikitext(fetcher, resolved);
    const earlyExit = applyFullPageFallback(result, fullWt);
    if (earlyExit) return result;
  }

  return result;
}

// ─── Tree building ──────────────────────────────────────────────────────────

type AIContext = { openai: OpenAI; accumulator: AIExtractionAccumulator };

/** Emit periodic progress log lines. */
function logProgressTick(progress: ExtractionProgress): void {
  progress.regionsFetched++;
  if (progress.regionsFetched % 100 !== 0) return;
  const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
  const rate = progress.regionsFetched / (Date.now() - progress.startedAt) * 1000;
  console.log(
    `[WV Extract] Progress: ${progress.regionsFetched} regions, ` +
    `${rate.toFixed(1)} regions/s, ${elapsed}s elapsed, ` +
    `API=${progress.apiRequests}, cache=${progress.cacheHits}`,
  );
}

/** Shortcut: city district pages (e.g., "Hong Kong/Central") → treat as leaf. */
function applyDistrictShortcut(page: PageData, resolved: string, progress: ExtractionProgress): void {
  const hasDistrictSubpages = page.regions.some(r =>
    (r.hasLink && r.name.startsWith(resolved + '/')) ||
    r.items.some(item => item.startsWith(resolved + '/')),
  );
  if (!hasDistrictSubpages) return;

  console.log(`[WV Extract] "${resolved}" has district subpages — treating as city leaf`);
  const districtNames = page.regions.filter(r => r.name.startsWith(resolved + '/')).map(r => r.name).join(', ');
  progress.decisions.push({
    page: resolved,
    decision: 'leaf',
    decidedBy: 'city_districts',
    detail: `Has district subpages (${districtNames})`,
  });
  page.regions = [];
  page.needsAI = false;
}

/** Drop plain-text, item-less entries that don't have a real Wikivoyage page. */
function dropDeadEnds(
  page: PageData,
  resolved: string,
  pageExistence: Map<string, boolean>,
  progress: ExtractionProgress,
): void {
  const ambiguousEntries = page.regions.filter(r => !r.hasLink && r.items.length === 0);
  const deadEndNames = new Set(
    ambiguousEntries.filter(r => pageExistence.get(r.name) !== true).map(r => r.name),
  );
  if (deadEndNames.size === 0) return;

  console.log(`[WV Extract] Dropping dead-ends for "${resolved}": ${[...deadEndNames].join(', ')}`);
  page.regions = page.regions.filter(r => !deadEndNames.has(r.name));
  const stillAmbiguous = page.regions.some(r => !r.hasLink && r.items.length === 0);
  if (!stillAmbiguous) {
    page.needsAI = false;
    progress.decisions.push({
      page: resolved,
      decision: 'split',
      decidedBy: 'dead_end_filter',
      detail: `Dropped dead-ends: ${[...deadEndNames].join(', ')}; remaining regions linked`,
    });
  }
}

/** Promote plain-text-only region lists whose entries all have pages to "linked". */
function promotePlainTextLinked(
  page: PageData,
  resolved: string,
  pageExistence: Map<string, boolean>,
  progress: ExtractionProgress,
): void {
  const hasLinkedContent = page.regions.some(r => r.hasLink || r.items.length > 0);
  const remainingAmbiguous = page.regions.filter(r => !r.hasLink && r.items.length === 0);
  const allHavePages = remainingAmbiguous.length > 0 &&
    remainingAmbiguous.every(r => pageExistence.get(r.name) === true);
  if (!allHavePages || hasLinkedContent) return;

  console.log(`[WV Extract] All plain-text regions for "${resolved}" have pages — treating as linked`);
  progress.decisions.push({
    page: resolved,
    decision: 'split',
    decidedBy: 'plain_text_linked',
    detail: `All ${remainingAmbiguous.length} plain-text entries have real pages`,
  });
  for (const r of page.regions) {
    if (!r.hasLink && r.items.length === 0 && pageExistence.get(r.name) === true) {
      r.hasLink = true;
    }
  }
  page.needsAI = false;
}

/** Sync AI cost accumulators into progress counters. */
function syncAiAccumulatorToProgress(progress: ExtractionProgress, accumulator: AIExtractionAccumulator): void {
  progress.aiApiCalls = accumulator.apiCalls;
  progress.aiPromptTokens = accumulator.promptTokens;
  progress.aiCompletionTokens = accumulator.completionTokens;
  progress.aiTotalCost = accumulator.totalCost;
}

/** Push an AI decision log line into progress. */
function logAiDecision(
  progress: ExtractionProgress,
  resolved: string,
  regionCount: number,
  aiQuestionCount: number,
): void {
  if (regionCount === 0) {
    progress.decisions.push({
      page: resolved,
      decision: 'leaf',
      decidedBy: 'ai_empty',
      detail: 'AI returned no regions',
    });
  } else if (aiQuestionCount === 0) {
    progress.decisions.push({
      page: resolved,
      decision: 'split',
      decidedBy: 'ai_confident',
      detail: `AI extracted ${regionCount} regions with no questions`,
    });
  }
}

/** Backfill page existence for AI-suggested names we haven't checked yet. */
async function backfillPageExistence(
  fetcher: WikivoyageFetcher,
  resolved: string,
  page: PageData,
  pageExistence: Map<string, boolean>,
): Promise<void> {
  const aiNames = page.regions.flatMap(r => r.hasLink ? [r.name] : r.items);
  const newNames = aiNames.filter(n => !pageExistence.has(n));
  if (newNames.length === 0) return;
  const extra = await fetcher.checkPagesExist(newNames, resolved);
  for (const [k, v] of extra) pageExistence.set(k, v);
}

/** Apply the low-coverage gate: kill splits with <50% subregion coverage. */
function maybeApplyCoverageGate(
  page: PageData,
  resolved: string,
  pageExistence: Map<string, boolean>,
  aiQuestions: string[],
  progress: ExtractionProgress,
): string[] {
  if (aiQuestions.length === 0) return aiQuestions;
  const totalSubs = page.regions.length;
  let withPages = 0;
  for (const r of page.regions) {
    if (r.hasLink && pageExistence.get(r.name) === true) withPages++;
  }
  if (totalSubs === 0 || withPages / totalSubs >= 0.5) return aiQuestions;

  console.log(`[WV Extract] Auto-resolved "${resolved}": only ${withPages}/${totalSubs} subregions have pages — treating as leaf`);
  progress.decisions.push({
    page: resolved,
    decision: 'leaf',
    decidedBy: 'coverage_gate',
    detail: `${withPages}/${totalSubs} subregions have pages (${Math.round(withPages / totalSubs * 100)}%)`,
  });
  page.regions = [];
  return [];
}

function buildRegionPreview(
  region: { name: string; hasLink: boolean; items: string[] },
  existenceSnapshot: Map<string, boolean>,
): RegionPreview {
  return {
    name: region.name, isLink: region.hasLink, children: region.items,
    pageExists: region.hasLink ? existenceSnapshot.get(region.name) : undefined,
    childPageExists: region.items.length > 0
      ? Object.fromEntries(region.items.map(item => [item, existenceSnapshot.get(item) ?? false]))
      : undefined,
  };
}

/** Build a PendingAIQuestion that reuses existing handlers. */
function makePendingQuestion(args: {
  questionId: number;
  resolved: string;
  aiQuestions: string[];
  wikitext: string;
  aiContext: AIContext;
  progress: ExtractionProgress;
  fetcher: WikivoyageFetcher;
  pageExistenceSnapshot: Map<string, boolean>;
  capturedRegions: RegionPreview[];
}): PendingAIQuestion {
  const { resolved, aiQuestions, wikitext, aiContext, progress: prog, fetcher: fetcherRef, pageExistenceSnapshot: existenceSnapshot, capturedRegions, questionId } = args;
  const openai = aiContext.openai;
  const acc = aiContext.accumulator;

  const pendingQ: PendingAIQuestion = {
    id: questionId,
    pageTitle: resolved,
    sourceUrl: wikivoyageUrl(resolved),
    rawQuestions: aiQuestions,
    currentQuestion: null,
    extractedRegions: capturedRegions,
    queuedRegions: capturedRegions,
    nodes: [],
    resolved: false,
    reExtract: async (feedback: string) => {
      const retryResult = await extractRegionsWithAI(
        resolved, wikitext, openai, acc, { adminFeedback: feedback, pageExistence: existenceSnapshot },
      );
      syncAiAccumulatorToProgress(prog, acc);
      const retryNames = retryResult.regions.flatMap(r => r.hasLink ? [r.name] : r.items);
      const unknownNames = retryNames.filter(n => !existenceSnapshot.has(n));
      if (unknownNames.length > 0) {
        const checked = await fetcherRef.checkPagesExist(unknownNames, resolved);
        for (const [k, v] of checked) existenceSnapshot.set(k, v);
      }
      return {
        regions: retryResult.regions.map(r => buildRegionPreview(r, existenceSnapshot)),
        questions: retryResult.questions,
      };
    },
    formulateNextQuestion: async () => {
      const result = await formulateQuestion(resolved, pendingQ.rawQuestions, pendingQ.extractedRegions, openai, acc);
      syncAiAccumulatorToProgress(prog, acc);
      return result.question;
    },
    processAnswer: async (question: InterviewQuestion, answer: string) => {
      const result = await processInterviewAnswer(resolved, question, answer, pendingQ.rawQuestions, pendingQ.extractedRegions, openai, acc);
      syncAiAccumulatorToProgress(prog, acc);
      return result;
    },
  };

  return pendingQ;
}

/** Queue an AI question for the admin and kick off the interview formulation asynchronously. */
function queueAdminQuestion(
  resolved: string,
  aiQuestions: string[],
  page: PageData,
  pageExistence: Map<string, boolean>,
  aiContext: AIContext,
  progress: ExtractionProgress,
  fetcher: WikivoyageFetcher,
): void {
  const questionId = progress.nextQuestionId++;
  const wikitext = page.rawWikitext!;
  const existenceSnapshot = new Map(pageExistence);
  const capturedRegions = page.regions.map(r => buildRegionPreview(r, existenceSnapshot));

  const pendingQ = makePendingQuestion({
    questionId, resolved, aiQuestions, wikitext, aiContext,
    progress, fetcher, pageExistenceSnapshot: existenceSnapshot, capturedRegions,
  });

  console.log(`[WV Extract] Queued AI question #${questionId} for "${resolved}": ${aiQuestions.join(' | ')}`);
  progress.pendingQuestions.push(pendingQ);

  const openai = aiContext.openai;
  const acc = aiContext.accumulator;
  formulateQuestion(resolved, aiQuestions, capturedRegions, openai, acc)
    .then(result => {
      syncAiAccumulatorToProgress(progress, acc);
      pendingQ.currentQuestion = result.question;
      console.log(`[WV Extract] Interview question ready for "${resolved}": ${result.question.text}`);
    })
    .catch(err => {
      console.warn('[WV Extract] Failed to formulate interview question for "%s":', resolved, err instanceof Error ? err.message : err);
      pendingQ.currentQuestion = {
        text: aiQuestions[0] ?? 'How should this page be handled?',
        options: [
          { label: 'Accept current extraction', value: 'accept' },
          { label: 'Skip this region', value: 'skip' },
          { label: 'Other', value: 'other' },
        ],
        recommended: 0,
      };
    });
}

/** Run the AI-assisted path for pages flagged `needsAI`. Mutates `page` in place. */
async function resolveAmbiguousWithAI(
  page: PageData,
  resolved: string,
  fetcher: WikivoyageFetcher,
  aiContext: AIContext,
  progress: ExtractionProgress,
): Promise<void> {
  try {
    const ambiguousNames = page.regions.filter(r => !r.hasLink).map(r => r.name);
    console.log(`[WV Extract] AI needed for "${resolved}" — ambiguous: ${ambiguousNames.join(', ')}`);

    const allNames = page.regions.flatMap(r => [r.name, ...r.items]);
    const uniqueNames = [...new Set(allNames)];
    const pageExistence = uniqueNames.length > 0
      ? await fetcher.checkPagesExist(uniqueNames, resolved)
      : new Map<string, boolean>();

    dropDeadEnds(page, resolved, pageExistence, progress);

    if (page.needsAI) {
      promotePlainTextLinked(page, resolved, pageExistence, progress);
    }

    if (!page.needsAI) return;

    const aiResult = await extractRegionsWithAI(
      resolved, page.rawWikitext!, aiContext.openai, aiContext.accumulator, { pageExistence },
    );
    let aiQuestions = aiResult.questions;
    if (aiResult.regions.length > 0) {
      console.log(`[WV Extract] AI resolved "${resolved}" → ${aiResult.regions.length} regions (calls so far: ${aiContext.accumulator.apiCalls})`);
      page.regions = aiResult.regions;
      syncAiAccumulatorToProgress(progress, aiContext.accumulator);
    }

    logAiDecision(progress, resolved, aiResult.regions.length, aiQuestions.length);
    await backfillPageExistence(fetcher, resolved, page, pageExistence);
    aiQuestions = maybeApplyCoverageGate(page, resolved, pageExistence, aiQuestions, progress);

    if (aiQuestions.length > 0) {
      queueAdminQuestion(resolved, aiQuestions, page, pageExistence, aiContext, progress, fetcher);
    }
  } catch (err) {
    console.warn('[WV Extract] AI extraction failed for "%s":', resolved, err instanceof Error ? err.message : err);
  }
}

/** Build an ordered list of map-image candidates with the primary image first. */
function orderMapImageCandidates(page: PageData): string[] {
  const candidates = [...page.mapImageCandidates];
  if (!page.mapImage) return candidates;
  const idx = candidates.indexOf(page.mapImage);
  if (idx > 0) {
    candidates.splice(idx, 1);
    candidates.unshift(page.mapImage);
  } else if (idx === -1) {
    candidates.unshift(page.mapImage);
  }
  return candidates;
}

/** Construct the base node with map image info pre-populated. */
function buildNodeShell(title: string, page: PageData): TreeNode {
  const node: TreeNode = { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  if (page.mapImage) node.regionMapUrl = page.mapImage;
  const candidates = orderMapImageCandidates(page);
  if (candidates.length > 0) node.mapImageCandidates = candidates;
  return node;
}

/**
 * Derive the country context for child traversal.
 *
 * Returns 'tiny_country' when the page is classified as a tiny country and
 * should become a leaf immediately (caller should return the node).
 */
async function deriveCountryContext(
  resolved: string,
  ancestors: Set<string>,
  aiContext: AIContext | undefined,
  countryContext: CountryContext | undefined,
  childRegions: PageData['regions'],
  cache: ClassificationCache,
  progress: ExtractionProgress,
): Promise<'tiny_country' | CountryContext | undefined> {
  if (countryContext || childRegions.length === 0 || !aiContext) return countryContext;

  const parentName = [...ancestors].pop() ?? 'World';
  const classification = await classifyEntity(
    aiContext.openai, resolved, parentName, cache,
    childRegions.map(r => r.name),
  );

  if (classification?.type === 'country' && classification.area_km2) {
    const maxSubDepth = computeMaxSubDepth(classification.area_km2);
    if (maxSubDepth === 0) {
      console.log(`[WV Extract] "${resolved}" classified as tiny country (${classification.area_km2} km²) — leaf`);
      progress.decisions.push({
        page: resolved,
        decision: 'leaf',
        decidedBy: 'country_depth',
        detail: `Tiny country (${classification.area_km2} km²), maxSubDepth=0`,
      });
      return 'tiny_country';
    }
    console.log(`[WV Extract] "${resolved}" classified as country (${classification.area_km2} km²), maxSubDepth=${maxSubDepth}`);
    return {
      name: resolved,
      area: classification.area_km2,
      maxSubDepth,
      currentSubDepth: 0,
    };
  }

  if (classification?.type === 'grouping') {
    console.log(`[WV Extract] "${resolved}" classified as grouping — pass-through`);
  }
  return countryContext;
}

/** Recurse into child regions and attach results to the parent node. */
async function buildChildren(
  node: TreeNode,
  childRegions: PageData['regions'],
  fetcher: WikivoyageFetcher,
  maxDepth: number,
  progress: ExtractionProgress,
  currentDepth: number,
  branchAncestors: Set<string>,
  aiContext: AIContext | undefined,
  nextCountryContext: CountryContext | undefined,
  cache: ClassificationCache,
): Promise<void> {
  for (const region of childRegions) {
    if (progress.cancel) break;

    if (region.hasLink) {
      const child = await buildTree(
        fetcher, region.name, maxDepth, progress,
        currentDepth + 1, branchAncestors, aiContext,
        nextCountryContext, cache,
      );
      const processed = processLinked(region.name, region.items, child, branchAncestors);
      if (processed) node.children.push(processed);
    } else {
      const grouping = await buildGroupingNode(
        fetcher, region.name, region.items, maxDepth, progress,
        currentDepth + 1, branchAncestors, aiContext,
        nextCountryContext, cache,
      );
      if (grouping) node.children.push(grouping);
    }
  }
}

/** Shortcut pre-checks that may bypass the rest of buildTree. */
function checkEarlyExit(
  title: string,
  ancestors: Set<string>,
  currentDepth: number,
  maxDepth: number,
  countryContext: CountryContext | undefined,
  progress: ExtractionProgress,
): TreeNode | 'self_ref' | 'missing' | null {
  if (progress.cancel) return 'missing';
  if (ancestors.has(title)) return 'self_ref';
  if (currentDepth >= maxDepth) {
    return { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  }
  if (countryContext && countryContext.currentSubDepth >= countryContext.maxSubDepth) {
    progress.decisions.push({
      page: title,
      decision: 'leaf',
      decidedBy: 'country_depth',
      detail: `Depth ${countryContext.currentSubDepth}/${countryContext.maxSubDepth} within ${countryContext.name} (${countryContext.area} km²)`,
    });
    return { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  }
  return null;
}

/**
 * Build a region tree by recursively fetching Wikivoyage pages.
 *
 * Uses per-branch ancestor tracking so the same region can appear under
 * multiple parents. Cycles prevented by checking ancestors only.
 *
 * Returns TreeNode, 'self_ref', or 'missing'.
 */
export async function buildTree(
  fetcher: WikivoyageFetcher,
  title: string,
  maxDepth: number,
  progress: ExtractionProgress,
  currentDepth = 0,
  ancestors: Set<string> = new Set(),
  aiContext?: AIContext,
  countryContext?: CountryContext,
  classificationCache?: ClassificationCache,
): Promise<TreeNode | 'self_ref' | 'missing'> {
  const early = checkEarlyExit(title, ancestors, currentDepth, maxDepth, countryContext, progress);
  if (early !== null) return early;

  logProgressTick(progress);
  progress.currentPage = title;

  const page = await getPageData(fetcher, title);
  const resolved = page.resolved;

  applyDistrictShortcut(page, resolved, progress);

  // A page reached again in this run — under a second parent, or by a parent's
  // rebuild from an answer (#368) — is built from what was already decided for
  // it, never handed to the model a second time: the admin's answer first, then
  // the regions its open question was queued with, then the model's own
  // outcome. Asking again would drop an answer, repeat the model's calls, and
  // could queue the page twice.
  const answered = progress.pendingQuestions.find(q => q.pageTitle === resolved && q.resolved);
  const open = answered ? undefined : progress.pendingQuestions.find(q => q.pageTitle === resolved);
  const settled = progress.modelRegions.get(resolved);
  if (answered) {
    page.regions = regionEntriesOf(answered.extractedRegions);
    progress.decisions.push({
      page: resolved,
      decision: page.regions.length > 0 ? 'split' : 'leaf',
      decidedBy: 'admin_answer',
      detail: `Built from the admin's answer (${page.regions.length} regions), not extracted again`,
    });
  } else if (open) {
    page.regions = regionEntriesOf(open.queuedRegions);
  } else if (settled) {
    page.regions = settled;
  } else if (page.needsAI && page.rawWikitext && aiContext && isOpenAIAvailable()) {
    await resolveAmbiguousWithAI(page, resolved, fetcher, aiContext, progress);
    progress.modelRegions.set(resolved, page.regions);
  } else if (page.needsAI) {
    console.log(`[WV Extract] AI needed for "${resolved}" but unavailable (aiContext=${!!aiContext}, openai=${isOpenAIAvailable()})`);
    progress.decisions.push({
      page: resolved,
      decision: 'split',
      decidedBy: 'no_ai',
      detail: 'AI needed but unavailable — using parser output as-is',
    });
  }

  if (!page.exists) return 'missing';
  if (resolved !== title && ancestors.has(resolved)) return 'self_ref';

  const branchAncestors = new Set([...ancestors, title, resolved]);
  const node = buildNodeShell(title, page);
  const cache = classificationCache ?? new Map();
  const fill = (childRegions: PageData['regions']) => fillChildren(node, resolved, childRegions, {
    fetcher, maxDepth, progress, currentDepth, ancestors, branchAncestors, aiContext, countryContext, cache,
  });

  // A question queued for this page waits on the admin while the walk goes on,
  // and the admin's answer can re-extract a different region set: the node is
  // rebuilt from it under the same depth, ancestors and country context, so the
  // tree the import reads holds what the admin decided (#368).
  const question = answered ?? open ?? progress.pendingQuestions.find(q => q.pageTitle === resolved);
  question?.nodes.push({
    node,
    fromAnswer: answered !== undefined,
    rebuild: async (regions) => {
      node.children = [];
      await fill(regionEntriesOf(regions));
    },
  });

  await fill(page.regions);
  return node;
}

/** What a node's children are built under: everything `buildTree` received for the node. */
interface ChildContext {
  fetcher: WikivoyageFetcher;
  maxDepth: number;
  progress: ExtractionProgress;
  currentDepth: number;
  ancestors: Set<string>;
  branchAncestors: Set<string>;
  aiContext: AIContext | undefined;
  countryContext: CountryContext | undefined;
  cache: ClassificationCache;
}

/** Build a node's children from its region set, and leave it a leaf where they add no granularity. */
async function fillChildren(
  node: TreeNode,
  resolved: string,
  childRegions: PageData['regions'],
  ctx: ChildContext,
): Promise<void> {
  // A single plain subregion (no grouping children) adds no granularity — treat parent as leaf
  if (childRegions.length === 1 && childRegions[0].items.length === 0) {
    console.log(`[WV Extract] "${resolved}" has only 1 subregion ("${childRegions[0].name}") — treating as leaf`);
    return;
  }
  if (childRegions.length === 0) return;

  const derived = await deriveCountryContext(
    resolved, ctx.ancestors, ctx.aiContext, ctx.countryContext, childRegions, ctx.cache, ctx.progress,
  );
  if (derived === 'tiny_country') return;

  const nextCountryContext = derived
    ? { ...derived, currentSubDepth: derived.currentSubDepth + 1 }
    : undefined;

  await buildChildren(
    node, childRegions, ctx.fetcher, ctx.maxDepth, ctx.progress,
    ctx.currentDepth, ctx.branchAncestors, ctx.aiContext, nextCountryContext, ctx.cache,
  );

  if (node.children.length === 1 && node.children[0].children.length === 0) {
    console.log(`[WV Extract] "${resolved}" has 1 leaf child ("${node.children[0].name}") after build — treating as leaf`);
    node.children = [];
  }
}

/** Process a linked child result */
function processLinked(
  name: string,
  _items: string[],
  childNode: TreeNode | 'self_ref' | 'missing',
  _ancestors: Set<string>,
): TreeNode | null {
  if (childNode === 'self_ref') {
    return { name, sourceUrl: wikivoyageUrl(name), children: [] };
  }
  if (childNode === 'missing') {
    return null;
  }
  return childNode;
}

/** Build a grouping node for a plain-text region name */
async function buildGroupingNode(
  fetcher: WikivoyageFetcher,
  name: string,
  items: string[],
  maxDepth: number,
  progress: ExtractionProgress,
  depth: number,
  ancestors: Set<string>,
  aiContext?: { openai: OpenAI; accumulator: AIExtractionAccumulator },
  countryContext?: CountryContext,
  classificationCache?: ClassificationCache,
): Promise<TreeNode | null> {
  const gnode: TreeNode = { name, children: [] };

  for (const itemName of items) {
    if (progress.cancel) break;

    const itemChild = await buildTree(
      fetcher, itemName, maxDepth, progress,
      depth, ancestors, aiContext,
      countryContext, classificationCache,
    );
    if (itemChild === 'self_ref') {
      gnode.children.push({ name: itemName, sourceUrl: wikivoyageUrl(itemName), children: [] });
    } else if (itemChild !== 'missing') {
      gnode.children.push(itemChild);
    }
  }

  if (gnode.children.length === 0) return null;
  if (gnode.children.length === 1) {
    // Single child adds no granularity — promote it, skip the grouping wrapper
    console.log(`[WV Extract] Grouping "${name}" has 1 child — promoting "${gnode.children[0].name}"`);
    return gnode.children[0];
  }
  return gnode;
}

/** A region set as the admin's question shows it, back in the shape a page's own regions take. */
function regionEntriesOf(regions: RegionPreview[]): PageData['regions'] {
  return regions.map(region => ({ name: region.name, hasLink: region.isLink, items: region.children }));
}

/** Whether `node` is still in the tree under `root` — a parent's rebuild detaches what it replaced. */
function holds(root: TreeNode, node: TreeNode): boolean {
  return root === node || root.children.some(child => holds(child, node));
}

/** Whether two region sets name the same regions, linked the same way, with the same items. */
function sameRegions(a: RegionPreview[], b: RegionPreview[]): boolean {
  const shape = (regions: RegionPreview[]) => JSON.stringify(regions.map(r => [r.name, r.isLink, r.children]));
  return shape(a) === shape(b);
}

/**
 * Carry each answered question's regions into the tree (#368). The tree was
 * built from the regions the page had when its question was queued; an answer
 * that re-extracted a different set rebuilds every node of that page the tree
 * still holds, and one that left it no regions makes them leaves. A node a
 * parent's rebuild already built from the answer is left as it is, and so is
 * one that rebuild detached. A page that got no node has no rebuild to call,
 * and only the leaf case applies, found by its title.
 *
 * Answers that arrive during a pass and were already passed over are left for
 * the next pass. An answer can only land while a rebuild is fetching pages, so
 * the pass returns whether it rebuilt anything, and `applyUntilSettled` passes
 * again until one rebuilds nothing.
 */
export async function applyAnsweredRegions(progress: ExtractionProgress, rootTree: TreeNode): Promise<boolean> {
  let rebuilt = false;
  for (const q of progress.pendingQuestions) {
    if (progress.cancel) return rebuilt;
    if (!q.resolved || sameRegions(q.extractedRegions, q.queuedRegions)) continue;
    if (q.nodes.length === 0) {
      if (q.extractedRegions.length === 0) removeChildrenByTitle(rootTree, q.pageTitle);
      continue;
    }
    for (const built of q.nodes) {
      if (built.fromAnswer || !holds(rootTree, built.node)) continue;
      progress.statusMessage = `Rebuilding "${q.pageTitle}" from the admin's answer...`;
      console.log(`[WV Extract] Rebuilding "${q.pageTitle}" from ${q.extractedRegions.length} re-extracted regions`);
      await built.rebuild(q.extractedRegions);
      built.fromAnswer = true;
      rebuilt = true;
    }
  }
  return rebuilt;
}

/**
 * Apply the answers until a pass rebuilds nothing, so an answer given during a
 * rebuild, to a question the pass had already passed over, still reaches the
 * tree. It ends because a rebuilt node is never rebuilt again.
 */
export async function applyUntilSettled(progress: ExtractionProgress, rootTree: TreeNode): Promise<void> {
  while (await applyAnsweredRegions(progress, rootTree) && !progress.cancel) { /* another pass */ }
}

/** Remove children of a node found by page title (DFS). Used to apply "don't split" decisions. */
export function removeChildrenByTitle(root: TreeNode, pageTitle: string): void {
  if (root.name === pageTitle) {
    root.children = [];
    return;
  }
  for (const child of root.children) {
    removeChildrenByTitle(child, pageTitle);
  }
}

/** Count total nodes in a tree */
export function countNodes(node: TreeNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}
