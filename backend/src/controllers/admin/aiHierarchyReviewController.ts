/**
 * AI Hierarchy Review Controller
 *
 * Provides an endpoint that sends the import tree to an LLM for
 * travel-expert analysis. Supports both full-tree (two-pass) and
 * single-subtree review modes.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import OpenAI from 'openai';
import { pool } from '../../db/index.js';
import { getModelForFeature } from '../../services/ai/aiSettingsService.js';
import { calculateCost } from '../../services/ai/pricingService.js';
import { chatCompletion } from '../../services/ai/chatCompletion.js';
import { logAIUsage } from '../../services/ai/aiUsageLogger.js';
import { isOpenAIAvailable } from '../../services/ai/openaiService.js';

// ---------------------------------------------------------------------------
// Lazy OpenAI singleton (same pattern as aiClassifier.ts)
// ---------------------------------------------------------------------------

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeRow {
  id: number;
  name: string;
  depth: number;
  parent_id: number | null;
  child_count: number;
  match_status: string;
  /** Computed in JS: number of leaf descendants */
  leaf_count: number;
  /** Computed in JS: max depth among descendants, relative to this node */
  max_depth: number;
}

interface FlaggedBranch {
  regionId: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// 1. queryTree — recursive CTE + bottom-up leaf/depth stats
// ---------------------------------------------------------------------------

async function queryTree(
  worldViewId: number,
  rootRegionId?: number,
): Promise<TreeRow[]> {
  const params: (number)[] = [worldViewId];

  // Seed clause: either a single root or all roots in the world view
  let seedWhere: string;
  if (rootRegionId != null) {
    params.push(rootRegionId);
    seedWhere = `r.world_view_id = $1 AND r.id = $2`;
  } else {
    seedWhere = `r.world_view_id = $1 AND r.parent_region_id IS NULL`;
  }

  const sql = `
    WITH RECURSIVE tree AS (
      SELECT
        r.id,
        r.name,
        0 AS depth,
        r.parent_region_id AS parent_id,
        (SELECT COUNT(*)::int FROM regions c WHERE c.parent_region_id = r.id) AS child_count,
        COALESCE(ris.match_status, 'no_candidates') AS match_status
      FROM regions r
      LEFT JOIN region_import_state ris ON ris.region_id = r.id
      WHERE ${seedWhere}

      UNION ALL

      SELECT
        r.id,
        r.name,
        t.depth + 1,
        r.parent_region_id,
        (SELECT COUNT(*)::int FROM regions c WHERE c.parent_region_id = r.id),
        COALESCE(ris.match_status, 'no_candidates')
      FROM regions r
      JOIN tree t ON r.parent_region_id = t.id
      LEFT JOIN region_import_state ris ON ris.region_id = r.id
    )
    SELECT id, name, depth, parent_id, child_count, match_status
    FROM tree
    ORDER BY depth, name
  `;

  const result = await pool.query(sql, params);

  // Build rows with placeholder stats
  const rows: TreeRow[] = result.rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    depth: r.depth as number,
    parent_id: r.parent_id as number | null,
    child_count: r.child_count as number,
    match_status: r.match_status as string,
    leaf_count: 0,
    max_depth: 0,
  }));

  // Bottom-up pass: compute leaf_count and max_depth per node
  const byId = new Map<number, TreeRow>();
  for (const row of rows) byId.set(row.id, row);

  // Process from deepest first (rows are ordered depth ASC, so reverse)
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.child_count === 0) {
      // Leaf node
      row.leaf_count = 1;
      row.max_depth = 0;
    }
    // Propagate to parent
    if (row.parent_id != null) {
      const parent = byId.get(row.parent_id);
      if (parent) {
        parent.leaf_count += row.leaf_count;
        parent.max_depth = Math.max(parent.max_depth, row.max_depth + 1);
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 2. formatTreeText — indented plain text with compact deep branches
// ---------------------------------------------------------------------------

function formatTreeText(rows: TreeRow[], detailDepth: number): string {
  const lines: string[] = [];

  // Gather children lookup
  const childrenOf = new Map<number | null, TreeRow[]>();
  for (const row of rows) {
    const pid = row.parent_id;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(row);
  }

  // Find root nodes (those whose parent_id is not in the row set, or null)
  const idSet = new Set(rows.map((r) => r.id));
  const roots = rows.filter(
    (r) => r.parent_id == null || !idSet.has(r.parent_id),
  );

  function walk(node: TreeRow, indentLevel: number): void {
    const indent = '  '.repeat(indentLevel);
    const relativeDepth = indentLevel; // relative to the tree root

    if (relativeDepth >= detailDepth && node.child_count > 0) {
      // Compact one-liner for deep branches
      lines.push(
        `${indent}${node.name} (${node.leaf_count} leaves, max depth +${node.max_depth}) [${node.match_status}]`,
      );
      return;
    }

    // Full detail line
    const childInfo =
      node.child_count > 0 ? ` (${node.child_count} children)` : '';
    lines.push(`${indent}${node.name}${childInfo} [${node.match_status}]`);

    // Recurse into children
    const children = childrenOf.get(node.id) ?? [];
    for (const child of children) {
      walk(child, indentLevel + 1);
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. buildTreeSummary — full tree at summary detail
// ---------------------------------------------------------------------------

async function buildTreeSummary(
  worldViewId: number,
): Promise<{ text: string; nodeCount: number }> {
  const rows = await queryTree(worldViewId);
  const text = formatTreeText(rows, 3);
  return { text, nodeCount: rows.length };
}

// ---------------------------------------------------------------------------
// 4. buildSubtreeDetail — full detail for specific branches
// ---------------------------------------------------------------------------

async function buildSubtreeDetail(
  worldViewId: number,
  regionIds: number[],
): Promise<string> {
  const parts: string[] = [];
  for (const regionId of regionIds) {
    const rows = await queryTree(worldViewId, regionId);
    if (rows.length > 0) {
      parts.push(formatTreeText(rows, Infinity));
    }
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

// Shared context about the system, prepended to all system prompts
const SYSTEM_CONTEXT = `You are a travel-industry expert reviewing a region hierarchy for "Track Your Regions" — a travel tracking application where users mark regions they've visited.

ABOUT THE DATA:
- Region names come from Wikivoyage (a community travel wiki). Names may intentionally differ from official administrative names to match how travelers refer to places (e.g., "Nenetsia" instead of "Nenets Autonomous Okrug", "Taymyria" instead of "Taymyr Peninsula"). This is expected and often preferred for traveler recognition.
- The tree is being matched against GADM administrative divisions (official government boundaries). Not every Wikivoyage region maps to an administrative division — travel regions and admin divisions serve different purposes.

MATCH STATUS VALUES (shown in brackets):
- [manual_matched] — Admin manually confirmed a match to a GADM division. This is good.
- [auto_matched] — System automatically matched with high confidence. This is good.
- [needs_review] — Match candidates exist but need human review. Expected during import.
- [no_candidates] — No GADM division matched this region name. Common for: travel-specific groupings (e.g., "Central Russia", "The Riviera"), non-standard names, or regions that are conceptual rather than administrative. This is NOT necessarily a problem — many travel regions legitimately have no admin equivalent.
- [children_matched] — This container node's children are matched; the parent itself doesn't need a direct GADM match. This is the expected state for grouping nodes.
- [dismissed] — Intentionally excluded from matching. Normal for nodes deemed irrelevant.
- [manual_fix_needed] — Flagged for manual attention. Known issue being tracked.

WHAT TO FOCUS ON:
- Structural issues that affect traveler navigation (confusing nesting, duplicates, missing important regions)
- Depth/breadth balance (is one country broken into 50 tiny areas while a similar one has only 3?)
- Whether the hierarchy helps a traveler understand "where things are" at a glance
- DO NOT flag [no_candidates] as a data quality problem — it's often expected for travel groupings
- DO NOT suggest renaming Wikivoyage names to official admin names unless the current name would genuinely confuse travelers`;

const PASS1_SYSTEM = `${SYSTEM_CONTEXT}

YOUR TASK: Review the tree summary below and identify branches that look problematic from a travel perspective. Look for:
- **Missing important regions** — Use your travel knowledge to spot major cities, provinces, or well-known travel areas that should exist but are absent. This is the MOST IMPORTANT check. Flag the parent container so pass 2 can investigate.
- Regions that are too granular or too coarse for practical travel use
- Odd nesting (e.g. a city nested under another city, or a country under a province)
- Duplicate or near-duplicate regions at different levels
- Regions with unusually many or few children compared to siblings

Respond with JSON only (no markdown fences):
{
  "flaggedBranches": [
    { "regionId": <number>, "reason": "<brief reason>" }
  ],
  "observations": "<1-2 paragraph overall assessment>"
}

Flag at most 10 branches. Focus on the most impactful issues.`;

const ACTION_TYPES_SCHEMA = `
AVAILABLE ACTION TYPES (use these exact type values):
- "rename": Rename a region. params: { "newName": "string" }
- "reparent": Move a region to a new parent. params: { "newParentName": "string" }. Use choices[] if multiple valid parents exist.
- "remove": Remove a region from the tree. No params needed.
- "merge": Merge a single-child parent's child into the parent. No params needed.
- "dismiss_children": Remove all children, making this a leaf node. No params needed.
- "add_child": Add a new child region. params: { "childName": "string" }
- "other": Any action that doesn't fit the above. Describe in description field.`;

const PASS2_SYSTEM = `${SYSTEM_CONTEXT}

YOUR TASK: Provide a detailed review of the flagged branches below. For each branch, analyze the full subtree and provide actionable recommendations.

Check for:
1. **Missing important regions** — Use your travel knowledge. Are there major cities, provinces, or well-known travel areas that should exist under a parent but are absent? This is the MOST IMPORTANT check.
2. **Structural issues** — bad nesting, wrong parent, duplicates, too deep/flat
3. **Match status inconsistencies** — e.g., a container showing [no_candidates] when all children are matched (should be [children_matched])

REPORT FORMAT:
- Use a markdown ## heading for each flagged region (include the region name in the heading)
- Under each heading, write a brief analysis with bullet points for specific issues
- Keep it scannable — an admin should quickly see what's wrong and where

ACTION RULES:
- Every recommendation in the report text MUST have a corresponding entry in the actions array
- Every action MUST include the target regionName and a clear description mentioning the region by name
- For rename actions, say explicitly: 'Rename "X" to "Y"'
- For reparent actions, say explicitly: 'Move "X" under "Y"'
- For add_child actions, say explicitly: 'Add "X" as child of "Y"'

BREVITY RULES:
- Be concise. Focus on real problems, not describing what looks fine.
- Every action must be concrete and actionable. No vague suggestions.

Respond with JSON only (no markdown fences):
{
  "report": "<structured markdown with ## headings per region>",
  "actions": [
    {
      "id": "action-1",
      "type": "<one of the action types below>",
      "regionId": <number from the tree>,
      "regionName": "<current name>",
      "description": "<explicit what to do, naming the region>",
      "params": { ... },
      "choices": [{ "label": "Option A", "value": "a" }, ...]
    }
  ]
}

${ACTION_TYPES_SCHEMA}`;

const SUBTREE_SYSTEM = `${SYSTEM_CONTEXT}

YOUR TASK: Review the specific branch below. Focus on finding real problems.

Check for:
1. **Missing important regions** — Use your travel knowledge. Are there major cities, provinces, or well-known travel areas that should exist under this parent but are absent? This is the MOST IMPORTANT check. For example, if a "Northwestern Russia" grouping lacks Saint Petersburg, that's a critical omission.
2. **Structural issues** — bad nesting, wrong parent, duplicates, too deep/flat
3. **Match status inconsistencies** — e.g., a container showing [no_candidates] when all children are matched (should be [children_matched])

REPORT FORMAT:
- If multiple issues found, use markdown ## headings to separate topics (e.g., "## Missing Regions", "## Structural Issues")
- Use bullet points for specific findings
- Keep it scannable — an admin should quickly see what's wrong and where

ACTION RULES:
- Every recommendation in the report text MUST have a corresponding entry in the actions array
- Every action MUST include the target regionName and a clear description mentioning the region by name
- For rename actions, say explicitly: 'Rename "X" to "Y"'
- For reparent actions, say explicitly: 'Move "X" under "Y"'
- For add_child actions, say explicitly: 'Add "X" as child of "Y"'

BREVITY RULES:
- If the subtree looks good with no issues, say so in 1-2 sentences. Do NOT pad with filler paragraphs about how the structure is reasonable. A short "all good" is better than a verbose one.
- Only write detailed analysis for actual problems found.
- Every action must be concrete and actionable. No vague suggestions.

Respond with JSON only (no markdown fences):
{
  "report": "<structured markdown — brief if no issues, with ## headings if multiple topics>",
  "actions": [
    {
      "id": "action-1",
      "type": "<one of the action types below>",
      "regionId": <number from the tree>,
      "regionName": "<current name>",
      "description": "<explicit what to do, naming the region>",
      "params": { ... },
      "choices": [{ "label": "Option A", "value": "a" }, ...]
    }
  ]
}

If no issues found, return an empty actions array.

${ACTION_TYPES_SCHEMA}`;

// ---------------------------------------------------------------------------
// 5. parseStructuredResponse — extract report + actions from JSON or markdown
// ---------------------------------------------------------------------------

function parseStructuredResponse(content: string): {
  report: string;
  actions: Array<Record<string, unknown>>;
} {
  if (!content) return { report: 'No response from AI', actions: [] };
  try {
    let jsonStr = content;
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

    const parsed = JSON.parse(jsonStr.trim());
    return {
      report: parsed.report ?? content,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    // Graceful degradation: treat entire content as markdown report
    return { report: content, actions: [] };
  }
}

// ---------------------------------------------------------------------------
// 6. hierarchyReview — Express endpoint
// ---------------------------------------------------------------------------

export async function hierarchyReview(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API is not configured' });
    return;
  }

  const worldViewId = Number(req.params.worldViewId);
  const { regionId } = req.body as { regionId?: number };

  const startTime = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let passes = 0;

  try {
    const model = await getModelForFeature('hierarchy_review');
    const client = getClient();
    let report: string;
    let actions: Array<Record<string, unknown>> = [];

    if (regionId != null) {
      // ----- Single-subtree review (one pass) -----
      const rows = await queryTree(worldViewId, regionId);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Region not found in this world view' });
        return;
      }
      const treeText = formatTreeText(rows, Infinity);

      const response = await chatCompletion(client, {
        model,
        temperature: 0.3,
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: SUBTREE_SYSTEM },
          {
            role: 'user',
            content: `Review this subtree (${rows.length} nodes):\n\n${treeText}`,
          },
        ],
      });

      passes = 1;
      totalPromptTokens += response.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += response.usage?.completion_tokens ?? 0;

      const subtreeContent = response.choices[0]?.message?.content || '';
      const parsed = parseStructuredResponse(subtreeContent);
      report = parsed.report;
      actions = parsed.actions;
    } else {
      // ----- Full tree review (two passes) -----

      // Pass 1: summary -> flagged branches
      const summary = await buildTreeSummary(worldViewId);
      const pass1Response = await chatCompletion(client, {
        model,
        temperature: 0.2,
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: PASS1_SYSTEM },
          {
            role: 'user',
            content: `Review this region tree (${summary.nodeCount} nodes):\n\n${summary.text}`,
          },
        ],
      });

      passes = 1;
      totalPromptTokens += pass1Response.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += pass1Response.usage?.completion_tokens ?? 0;

      const pass1Content =
        pass1Response.choices[0]?.message?.content ?? '';

      // Try to parse pass 1 JSON
      let flaggedBranches: FlaggedBranch[] = [];
      let observations = '';
      try {
        // Strip markdown fences if present
        let jsonStr = pass1Content;
        const fenceMatch = pass1Content.match(
          /```(?:json)?\s*([\s\S]*?)```/,
        );
        if (fenceMatch) jsonStr = fenceMatch[1];

        const parsed = JSON.parse(jsonStr.trim()) as {
          flaggedBranches: FlaggedBranch[];
          observations: string;
        };
        flaggedBranches = parsed.flaggedBranches ?? [];
        observations = parsed.observations ?? '';
      } catch {
        // Graceful degradation: return raw pass 1 output as report
        report = pass1Content || 'AI returned an empty response';

        const durationMs = Date.now() - startTime;
        const cost = calculateCost(
          totalPromptTokens,
          totalCompletionTokens,
          model,
        );

        await logAIUsage({
          feature: 'hierarchy_review',
          model,
          apiCalls: passes,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalCost: cost.totalCost,
          durationMs,
          description: `Full tree review (pass 1 only, JSON parse failed) for world view ${worldViewId}`,
        });

        res.json({
          report,
          actions: [],
          stats: {
            passes,
            inputTokens: totalPromptTokens,
            outputTokens: totalCompletionTokens,
            cost: cost.totalCost,
          },
        });
        return;
      }

      // Pass 2: detailed review of flagged branches
      if (flaggedBranches.length > 0) {
        const flaggedIds = flaggedBranches.map((b) => b.regionId);
        const detailText = await buildSubtreeDetail(
          worldViewId,
          flaggedIds,
        );

        const flagContext = flaggedBranches
          .map((b) => `- Region ${b.regionId}: ${b.reason}`)
          .join('\n');

        const pass2Response = await chatCompletion(client, {
          model,
          temperature: 0.3,
          max_completion_tokens: 25000,
          messages: [
            { role: 'system', content: PASS2_SYSTEM },
            {
              role: 'user',
              content: `Overall observations from initial scan:\n${observations}\n\nFlagged branches:\n${flagContext}\n\nDetailed subtrees:\n\n${detailText}`,
            },
          ],
        });

        passes = 2;
        totalPromptTokens += pass2Response.usage?.prompt_tokens ?? 0;
        totalCompletionTokens +=
          pass2Response.usage?.completion_tokens ?? 0;

        const pass2Content = pass2Response.choices[0]?.message?.content || '';
        const pass2Parsed = parseStructuredResponse(pass2Content);
        report = pass2Parsed.report;
        actions = pass2Parsed.actions;
      } else {
        // No flagged branches — use observations as the report
        report =
          observations ||
          'No issues found. The hierarchy looks well-structured.';
      }
    }

    const durationMs = Date.now() - startTime;
    const cost = calculateCost(
      totalPromptTokens,
      totalCompletionTokens,
      model,
    );

    await logAIUsage({
      feature: 'hierarchy_review',
      model,
      apiCalls: passes,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalCost: cost.totalCost,
      durationMs,
      description: regionId
        ? `Subtree review for region ${regionId} in world view ${worldViewId}`
        : `Full tree review (${passes} passes) for world view ${worldViewId}`,
    });

    res.json({
      report,
      actions,
      stats: {
        passes,
        inputTokens: totalPromptTokens,
        outputTokens: totalCompletionTokens,
        cost: cost.totalCost,
      },
    });
  } catch (err) {
    console.error('[AI Hierarchy Review] Error:', err);
    res
      .status(500)
      .json({
        error:
          err instanceof Error ? err.message : 'AI hierarchy review failed',
      });
  }
}
