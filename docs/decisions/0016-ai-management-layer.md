# ADR-0016: Centralized AI Management Layer

**Date:** 2026-04-25
**Status:** Accepted

---

## Context

Multiple features require OpenAI integration: world view import AI matching, hierarchy review,
Wikivoyage content extraction with AI classification and interviewing. Initially each feature called
OpenAI directly with its own error handling, model selection, and cost tracking. This led to:
- Duplicated retry logic across features
- No unified cost visibility for admins
- Difficulty switching models across features simultaneously
- No mechanism for admins to teach the AI from corrections (learned rules)
- No audit trail for AI usage and spend

The admin dashboard needed a unified place to configure AI models, view usage/cost, and manage
learned rules that improve future extractions.

## Decision

Introduce a dedicated AI service layer under `backend/src/services/ai/`:
- `openaiShared.ts` — shared OpenAI client, model selection, and prompt helpers
- `chatCompletion.ts` — model-agnostic completion wrapper with retry on unsupported params
- `aiUsageLogger.ts` — per-session usage logging to `ai_usage_log` table
- `learnedRulesService.ts` — CRUD for user-provided rules injected into AI prompts
- `ruleReviewService.ts` — AI-assisted deduplication/consolidation of learned rules
- `openaiGroupDescriptions.ts` — group description generation
- `openaiGroupSuggestion.ts` — region-to-group classification

Expose these via `aiController.ts` (admin endpoints for settings, usage, rules, pricing update)
and `aiHierarchyReviewController.ts` (hierarchy audit reports). Admin frontend components
(`AISettingsPanel`, `AIReviewDrawer`, `ExtractionRulesPanel`) provide the UI.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep per-feature OpenAI calls | No cost visibility, inconsistent error handling, no learned rules |
| External cost tracking service | Extra dependency, latency, privacy concerns with usage data |
| Shared singleton without DB logging | No persistent audit trail, no admin dashboard data |

## Consequences

**Positive:**
- Single model selection controls all AI features simultaneously
- Admin cost dashboard shows spend by feature and model
- Learned rules improve AI quality over time without code changes
- Unified retry/error handling reduces duplicated code
- `chatCompletion.ts` auto-strips unsupported params per model (cached)

**Negative / Trade-offs:**
- Requires `ai_usage_log` and `ai_learned_rules` DB tables
- All AI features must go through shared layer (minor coupling)
- Pricing data fetched from OpenAI API (requires network on update)

## References

- Related ADRs: ADR-0009 (import controller domain-split), ADR-0015 (Python CV microservice)
- Related docs: `docs/tech/experiences.md`
- Supersedes pattern of ad-hoc OpenAI calls in individual controllers
