# ADR-0011: Centralized AI service layer

**Date:** 2026-03-24
**Status:** Accepted

---

## Context

Multiple features need OpenAI integration: world view import matching (AI-assisted cluster-to-division assignment), hierarchy review, and Wikivoyage content extraction. Initially, each feature called the OpenAI API directly with its own error handling, model selection, and cost tracking logic. This led to duplicated retry logic, inconsistent error handling, no unified cost visibility, and difficulty switching models across features.

## Decision

Centralize all OpenAI interactions into `backend/src/services/ai/` with these components:

- **`chatCompletion.ts`** -- Model-agnostic chat completion wrapper. Handles optional parameter stripping (temperature, top_p, max_completion_tokens) when a model rejects them, with per-model caching of unsupported params so retries are automatic and transparent to callers.
- **`aiSettingsService.ts`** -- Reads/writes per-feature model selections from the `ai_settings` database table. In-memory cache with 60-second TTL to avoid DB round-trips on every AI call.
- **`aiUsageLogger.ts`** -- Logs per-call usage (tokens, cost, feature, model) to the `ai_usage_log` table. Provides summary queries for the admin dashboard (today/month/all-time totals, breakdown by model and feature).
- **`pricingService.ts`** -- Loads model pricing from a CSV file (community-maintained via litellm). Calculates per-call cost from token counts. Supports cached input pricing for prompt caching scenarios.
- **`openaiService.ts`** -- High-level service that ties the above together. Manages the OpenAI client instance, model listing, and feature-specific model selection (e.g., separate models for general AI vs. web search).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Direct OpenAI calls per feature | Duplicated error handling, no unified cost tracking, model changes required touching every call site |
| Third-party AI orchestration library (LangChain, etc.) | Heavy dependency for relatively simple needs (chat completions with retries); abstractions add complexity without proportional benefit for our use case |
| Separate microservice for AI calls | Over-engineered for a single-backend architecture; adds network hop and deployment complexity |

## Consequences

**Positive:**
- Single place to change model, add retry logic, or update error handling -- all features benefit automatically
- Unified cost tracking with per-feature, per-model granularity visible in admin dashboard
- Model-agnostic parameter handling means new models (with different supported params) work without caller changes
- Per-feature model selection allows using cheaper models for simple tasks and more capable models for complex ones

**Negative / Trade-offs:**
- All AI features coupled to a shared service -- a breaking change in the service layer affects all callers
- In-memory caches (settings, pricing, unsupported params) add subtle state; server restart clears cached model compatibility data
- CSV-based pricing requires periodic updates to stay accurate with OpenAI pricing changes

## References

- Service directory: `backend/src/services/ai/`
- Key files: `chatCompletion.ts`, `aiSettingsService.ts`, `aiUsageLogger.ts`, `pricingService.ts`, `openaiService.ts`
- Consumers: `backend/src/controllers/admin/wvImportMatch*.ts`, `backend/src/controllers/ai/`
