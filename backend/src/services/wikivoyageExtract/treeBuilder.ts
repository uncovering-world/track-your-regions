/**
 * Recursive tree builder — uses fetcher + parser to build region hierarchy
 *
 * Ported from Python build_tree() + get_page_data().
 * Per-branch ancestor tracking (not global visited set) so the same region
 * can appear under multiple parents (e.g. Caucasus under both Asia and Europe).
 */

import type { TreeNode, PageData, ExtractionProgress, WikiSection, RegionPreview, PendingAIQuestion, InterviewQuestionData, CountryContext } from './types.js';
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
    const data2 = await fetcher.apiGet({
      action: 'parse', page: resolved, prop: 'wikitext',
      section: sectionIdx,
    }) as Record<string, unknown>;

    if (!('error' in data2)) {
      const parse2 = data2['parse'] as Record<string, unknown>;
      const wikitext = (parse2['wikitext'] as Record<string, string>)?.['*'] ?? '';

      if (wikitext) {
        if (wikitext.includes('{{Regionlist') || wikitext.includes('{{regionlist')) {
          const { mapImage, regions } = parseRegionlist(wikitext);
          result.mapImage = mapImage;
          result.mapImageCandidates = extractImageCandidates(wikitext);
          if (regions.length > 0) {
            result.regions = regions;
            // Flag pages with ambiguous regions for AI resolution.
            // Plain-text names that group linked items (e.g., "Bechar Province" → items: ["Béchar"])
            // are standard grouping nodes — NOT ambiguous. Only flag when there's genuine ambiguity:
            // unlinked entries with no items (dead-ends) or multi-link names needing interpretation.
            const hasAmbiguity = regions.some(r => !r.hasLink && r.items.length === 0);
            if (hasAmbiguity) {
              result.needsAI = true;
              result.rawWikitext = wikitext;
            }
          }
        } else {
          // No Regionlist — try plain bullet links
          const links = parseBulletLinks(wikitext);
          result.regions = links.map((link) => ({
            name: link, items: [], hasLink: true,
          }));
        }
      }
    }
  }

  // Step 3: Fallback map image from full page wikitext
  if (!result.mapImage || result.mapImageCandidates.length === 0) {
    const dataFull = await fetcher.apiGet({
      action: 'parse', page: resolved, prop: 'wikitext',
    }) as Record<string, unknown>;

    if (!('error' in dataFull)) {
      const parseFull = dataFull['parse'] as Record<string, unknown>;
      const fullWt = (parseFull['wikitext'] as Record<string, string>)?.['*'] ?? '';

      if (fullWt) {
        // Disambiguation pages are not real regions — skip them
        if (fullWt.includes('Disambiguation banner') || fullWt.includes('{{disamb')) {
          result.regions = [];
          result.needsAI = false;
          return result;
        }

        if (!result.mapImage) {
          result.mapImage = extractFileMapImage(fullWt);
        }
        // Merge full-page candidates (section first, then full-page, deduplicated)
        const existing = new Set(result.mapImageCandidates);
        for (const url of extractImageCandidates(fullWt)) {
          if (!existing.has(url)) {
            result.mapImageCandidates.push(url);
            existing.add(url);
          }
        }
      }
    }
  }

  return result;
}

// ─── Tree building ──────────────────────────────────────────────────────────

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
  aiContext?: { openai: OpenAI; accumulator: AIExtractionAccumulator },
  countryContext?: CountryContext,
  classificationCache?: ClassificationCache,
): Promise<TreeNode | 'self_ref' | 'missing'> {
  if (progress.cancel) return 'missing';

  if (ancestors.has(title)) {
    return 'self_ref';
  }

  if (currentDepth >= maxDepth) {
    return { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  }

  // Country depth limit: stop recursing if we've exceeded the allowed sub-depth
  if (countryContext && countryContext.currentSubDepth >= countryContext.maxSubDepth) {
    progress.decisions.push({
      page: title,
      decision: 'leaf',
      decidedBy: 'country_depth',
      detail: `Depth ${countryContext.currentSubDepth}/${countryContext.maxSubDepth} within ${countryContext.name} (${countryContext.area} km²)`,
    });
    return { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  }

  // Update progress
  progress.regionsFetched++;
  progress.currentPage = title;
  if (progress.regionsFetched % 100 === 0) {
    const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
    const rate = progress.regionsFetched / (Date.now() - progress.startedAt) * 1000;
    console.log(
      `[WV Extract] Progress: ${progress.regionsFetched} regions, ` +
      `${rate.toFixed(1)} regions/s, ${elapsed}s elapsed, ` +
      `API=${progress.apiRequests}, cache=${progress.cacheHits}`,
    );
  }

  const page = await getPageData(fetcher, title);
  const resolved = page.resolved;

  // Shortcut: city district pages (e.g., "Hong Kong/Central") → treat as leaf.
  // Wikivoyage uses Parent/District subpage convention for city districts.
  // Check ALL regions including grouping node items (e.g., Hong Kong Island items).
  const hasDistrictSubpages = page.regions.some(r =>
    (r.hasLink && r.name.startsWith(resolved + '/')) ||
    r.items.some(item => item.startsWith(resolved + '/')),
  );
  if (hasDistrictSubpages) {
    console.log(`[WV Extract] "${resolved}" has district subpages — treating as city leaf`);
    progress.decisions.push({
      page: resolved,
      decision: 'leaf',
      decidedBy: 'city_districts',
      detail: `Has district subpages (${page.regions.filter(r => r.name.startsWith(resolved + '/')).map(r => r.name).join(', ')})`,
    });
    page.regions = [];
    page.needsAI = false;
  }

  // Use AI for ambiguous pages
  let aiQuestions: string[] = [];
  if (page.needsAI && page.rawWikitext && aiContext && isOpenAIAvailable()) {
    try {
      const ambiguousNames = page.regions.filter(r => !r.hasLink).map(r => r.name);
      console.log(`[WV Extract] AI needed for "${resolved}" — ambiguous: ${ambiguousNames.join(', ')}`);

      // Check which region names have real Wikivoyage pages (helps AI decide)
      // Include ALL names: linked regions, unlinked regions, and their items
      const allNames = page.regions.flatMap(r => [r.name, ...r.items]);
      const uniqueNames = [...new Set(allNames)];
      const pageExistence = uniqueNames.length > 0
        ? await fetcher.checkPagesExist(uniqueNames, resolved)
        : new Map<string, boolean>();

      // Handle plain-text entries with no items (dead-ends vs real pages):
      const ambiguousEntries = page.regions.filter(r => !r.hasLink && r.items.length === 0);

      // Drop dead-ends: no link, no items, no Wikivoyage page → just annotations
      // (e.g., "Santa Luzia" — uninhabited island with no article)
      const deadEndNames = new Set(
        ambiguousEntries.filter(r => pageExistence.get(r.name) !== true).map(r => r.name),
      );
      if (deadEndNames.size > 0) {
        console.log(`[WV Extract] Dropping dead-ends for "${resolved}": ${[...deadEndNames].join(', ')}`);
        page.regions = page.regions.filter(r => !deadEndNames.has(r.name));
        // Re-check: if no ambiguity remains, skip AI
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

      // Shortcut: if ALL entries are plain-text (no wikilinks at all) and have real pages,
      // treat them as linked (e.g., older Wikivoyage articles using plain-text names).
      // Do NOT apply in mixed pages (some linked, some not) — editors intentionally
      // left entries unlinked (e.g., "Santa Luzia" in Cape Verde → name collision with Azores page).
      if (page.needsAI) {
        const hasLinkedContent = page.regions.some(r => r.hasLink || r.items.length > 0);
        const remainingAmbiguous = page.regions.filter(r => !r.hasLink && r.items.length === 0);
        const allHavePages = remainingAmbiguous.length > 0 &&
          remainingAmbiguous.every(r => pageExistence.get(r.name) === true);
        if (allHavePages && !hasLinkedContent) {
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
      }

      // Only call AI if still needed after the shortcut
      if (page.needsAI) {

      const aiResult = await extractRegionsWithAI(
        resolved, page.rawWikitext, aiContext.openai, aiContext.accumulator, { pageExistence },
      );
      aiQuestions = aiResult.questions;
      if (aiResult.regions.length > 0) {
        console.log(`[WV Extract] AI resolved "${resolved}" → ${aiResult.regions.length} regions (calls so far: ${aiContext.accumulator.apiCalls})`);
        page.regions = aiResult.regions;
        // Update progress accumulators
        progress.aiApiCalls = aiContext.accumulator.apiCalls;
        progress.aiPromptTokens = aiContext.accumulator.promptTokens;
        progress.aiCompletionTokens = aiContext.accumulator.completionTokens;
        progress.aiTotalCost = aiContext.accumulator.totalCost;
      }

      // Log AI decision
      if (aiResult.regions.length === 0) {
        progress.decisions.push({
          page: resolved,
          decision: 'leaf',
          decidedBy: 'ai_empty',
          detail: 'AI returned no regions',
        });
      } else if (aiQuestions.length === 0) {
        progress.decisions.push({
          page: resolved,
          decision: 'split',
          decidedBy: 'ai_confident',
          detail: `AI extracted ${aiResult.regions.length} regions with no questions`,
        });
      }

      // Validate AI output: check page existence for AI's suggested regions
      const aiNames = page.regions.flatMap(r => r.hasLink ? [r.name] : r.items);
      const newNames = aiNames.filter(n => !pageExistence.has(n));
      if (newNames.length > 0) {
        const extra = await fetcher.checkPagesExist(newNames, resolved);
        for (const [k, v] of extra) pageExistence.set(k, v);
      }

      // Auto-resolve: if AI has questions but page coverage is very low, don't split
      // Count every region as a subregion (grouping or leaf — same for split decisions)
      if (aiQuestions.length > 0) {
        const totalSubs = page.regions.length;
        let withPages = 0;
        for (const r of page.regions) {
          if (r.hasLink && pageExistence.get(r.name) === true) withPages++;
          // Grouping nodes without links count as "no page"
        }
        if (totalSubs > 0 && withPages / totalSubs < 0.5) {
          console.log(`[WV Extract] Auto-resolved "${resolved}": only ${withPages}/${totalSubs} subregions have pages — treating as leaf`);
          progress.decisions.push({
            page: resolved,
            decision: 'leaf',
            decidedBy: 'coverage_gate',
            detail: `${withPages}/${totalSubs} subregions have pages (${Math.round(withPages / totalSubs * 100)}%)`,
          });
          page.regions = [];
          aiQuestions = [];
        }
      }

      // Queue remaining questions for admin review (non-blocking — extraction continues)
      if (aiQuestions.length > 0) {
        const questionId = progress.nextQuestionId++;
        const wikitext = page.rawWikitext!;
        const openai = aiContext.openai;
        const acc = aiContext.accumulator;
        const prog = progress;
        const fetcherRef = fetcher;
        // Capture page existence for preview annotations (including children)
        const existenceSnapshot = new Map(pageExistence);
        const capturedRegions = page.regions.map((r): RegionPreview => ({
          name: r.name, isLink: r.hasLink, children: r.items,
          pageExists: r.hasLink ? existenceSnapshot.get(r.name) : undefined,
          childPageExists: r.items.length > 0
            ? Object.fromEntries(r.items.map(item => [item, existenceSnapshot.get(item) ?? false]))
            : undefined,
        }));

        // Formulate the first interview question (fire-and-forget — doesn't block extraction)
        const pendingQ: PendingAIQuestion = {
          id: questionId,
          pageTitle: resolved,
          sourceUrl: wikivoyageUrl(resolved),
          rawQuestions: aiQuestions,
          currentQuestion: null, // Will be populated async
          extractedRegions: capturedRegions,
          resolved: false,
          reExtract: async (feedback: string) => {
            const retryResult = await extractRegionsWithAI(
              resolved, wikitext, openai, acc, { adminFeedback: feedback, pageExistence: existenceSnapshot },
            );
            prog.aiApiCalls = acc.apiCalls;
            prog.aiPromptTokens = acc.promptTokens;
            prog.aiCompletionTokens = acc.completionTokens;
            prog.aiTotalCost = acc.totalCost;
            // Re-check page existence for new names
            const retryNames = retryResult.regions.flatMap(r => r.hasLink ? [r.name] : r.items);
            const unknownNames = retryNames.filter(n => !existenceSnapshot.has(n));
            if (unknownNames.length > 0) {
              const checked = await fetcherRef.checkPagesExist(unknownNames, resolved);
              for (const [k, v] of checked) existenceSnapshot.set(k, v);
            }
            return {
              regions: retryResult.regions.map((r): RegionPreview => ({
                name: r.name, isLink: r.hasLink, children: r.items,
                pageExists: r.hasLink ? existenceSnapshot.get(r.name) : undefined,
                childPageExists: r.items.length > 0
                  ? Object.fromEntries(r.items.map(item => [item, existenceSnapshot.get(item) ?? false]))
                  : undefined,
              })),
              questions: retryResult.questions,
            };
          },
          formulateNextQuestion: async () => {
            const result = await formulateQuestion(resolved, pendingQ.rawQuestions, pendingQ.extractedRegions, openai, acc);
            prog.aiApiCalls = acc.apiCalls;
            prog.aiPromptTokens = acc.promptTokens;
            prog.aiCompletionTokens = acc.completionTokens;
            prog.aiTotalCost = acc.totalCost;
            return result.question;
          },
          processAnswer: async (question: InterviewQuestionData, answer: string) => {
            const result = await processInterviewAnswer(resolved, question, answer, pendingQ.rawQuestions, pendingQ.extractedRegions, openai, acc);
            prog.aiApiCalls = acc.apiCalls;
            prog.aiPromptTokens = acc.promptTokens;
            prog.aiCompletionTokens = acc.completionTokens;
            prog.aiTotalCost = acc.totalCost;
            return result;
          },
        };

        console.log(`[WV Extract] Queued AI question #${questionId} for "${resolved}": ${aiQuestions.join(' | ')}`);
        progress.pendingQuestions.push(pendingQ);

        // Formulate interview question async (doesn't block extraction)
        formulateQuestion(resolved, aiQuestions, capturedRegions, openai, acc)
          .then(result => {
            prog.aiApiCalls = acc.apiCalls;
            prog.aiPromptTokens = acc.promptTokens;
            prog.aiCompletionTokens = acc.completionTokens;
            prog.aiTotalCost = acc.totalCost;
            pendingQ.currentQuestion = result.question;
            console.log(`[WV Extract] Interview question ready for "${resolved}": ${result.question.text}`);
          })
          .catch(err => {
            console.warn(`[WV Extract] Failed to formulate interview question for "${resolved}":`, err instanceof Error ? err.message : err);
            // Fallback: use raw questions directly
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

      } // end if (page.needsAI) — shortcut may have resolved it
    } catch (err) {
      console.warn(`[WV Extract] AI extraction failed for "${resolved}":`, err instanceof Error ? err.message : err);
      // Fall through to use parser results
    }
  } else if (page.needsAI) {
    console.log(`[WV Extract] AI needed for "${resolved}" but unavailable (aiContext=${!!aiContext}, openai=${isOpenAIAvailable()})`);
    progress.decisions.push({
      page: resolved,
      decision: 'split',
      decidedBy: 'no_ai',
      detail: 'AI needed but unavailable — using parser output as-is',
    });
  }

  if (!page.exists) {
    return 'missing';
  }

  if (resolved !== title && ancestors.has(resolved)) {
    return 'self_ref';
  }

  const branchAncestors = new Set([...ancestors, title, resolved]);

  const node: TreeNode = { name: title, sourceUrl: wikivoyageUrl(title), children: [] };
  if (page.mapImage) {
    node.regionMapUrl = page.mapImage;
  }

  // Ensure regionMapUrl is always first in candidates
  const candidates = [...page.mapImageCandidates];
  if (page.mapImage) {
    const idx = candidates.indexOf(page.mapImage);
    if (idx > 0) {
      candidates.splice(idx, 1);
      candidates.unshift(page.mapImage);
    } else if (idx === -1) {
      candidates.unshift(page.mapImage);
    }
  }
  if (candidates.length > 0) {
    node.mapImageCandidates = candidates;
  }

  const childRegions = page.regions;

  // A single plain subregion (no grouping children) adds no granularity — treat parent as leaf
  // But keep grouping nodes that contain multiple items (e.g., "Island Group" with IslandA, IslandB)
  if (childRegions.length === 1 && childRegions[0].items.length === 0) {
    console.log(`[WV Extract] "${resolved}" has only 1 subregion ("${childRegions[0].name}") — treating as leaf`);
    return node;
  }

  if (childRegions.length === 0) {
    return node;
  }

  // ─── Country-aware depth control ──────────────────────────────────────
  // If we're not yet inside a country context, classify this entity to decide depth.
  let childCountryContext = countryContext;
  const cache = classificationCache ?? new Map();

  if (!countryContext && childRegions.length > 0 && aiContext) {
    const parentName = [...ancestors].pop() ?? 'World';
    const classification = await classifyEntity(
      aiContext.openai, resolved, parentName, cache,
      childRegions.map(r => r.name),
    );

    if (classification?.type === 'country' && classification.area_km2) {
      const maxSubDepth = computeMaxSubDepth(classification.area_km2);
      if (maxSubDepth === 0) {
        // Tiny country — make leaf immediately
        console.log(`[WV Extract] "${resolved}" classified as tiny country (${classification.area_km2} km²) — leaf`);
        progress.decisions.push({
          page: resolved,
          decision: 'leaf',
          decidedBy: 'country_depth',
          detail: `Tiny country (${classification.area_km2} km²), maxSubDepth=0`,
        });
        return node;
      }
      childCountryContext = {
        name: resolved,
        area: classification.area_km2,
        maxSubDepth,
        currentSubDepth: 0,
      };
      console.log(`[WV Extract] "${resolved}" classified as country (${classification.area_km2} km²), maxSubDepth=${maxSubDepth}`);
    } else if (classification?.type === 'grouping') {
      // Pass-through — no depth limit, keep looking for countries
      console.log(`[WV Extract] "${resolved}" classified as grouping — pass-through`);
    }
    // sub_country or null: inherit parent context (if any) or no limit
  }

  // Increment sub-depth for children if inside a country
  const nextCountryContext = childCountryContext
    ? { ...childCountryContext, currentSubDepth: childCountryContext.currentSubDepth + 1 }
    : undefined;

  // Build children (sequential for safety; fetcher serializes anyway)
  for (const region of childRegions) {
    if (progress.cancel) break;

    if (region.hasLink) {
      const child = await buildTree(
        fetcher, region.name, maxDepth, progress,
        currentDepth + 1, branchAncestors, aiContext,
        nextCountryContext, cache,
      );
      const processed = processLinked(region.name, region.items, child, branchAncestors);
      if (processed) {
        node.children.push(processed);
      }
      // Missing pages are skipped entirely
    } else {
      const grouping = await buildGroupingNode(
        fetcher, region.name, region.items, maxDepth, progress,
        currentDepth + 1, branchAncestors, aiContext,
        nextCountryContext, cache,
      );
      if (grouping) {
        node.children.push(grouping);
      }
      // All sub-items missing — skip grouping entirely
    }
  }

  // After building all children, if only 1 leaf child remains it adds no granularity
  if (node.children.length === 1 && node.children[0].children.length === 0) {
    console.log(`[WV Extract] "${resolved}" has 1 leaf child ("${node.children[0].name}") after build — treating as leaf`);
    node.children = [];
  }

  return node;
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
