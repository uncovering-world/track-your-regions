# AI Centralization & Extraction Rework — Design

**Status: Fully implemented** (2026-02-26)

All features from this design are live:
- Centralized AI settings with per-feature model selection (`ai_settings` table)
- Usage logging dashboard with cost tracking (`ai_usage_log` table)
- AI-assisted Wikivoyage extraction for ambiguous pages
- Admin panel integration (AI Settings section in sidebar)

See `docs/tech/planning/2026-02-26-ai-centralization-plan.md` for the implementation plan.

## Future improvements

- **Pagination** for usage log (currently shows last 50 sessions)
- **Export** usage data as CSV
- **Budget alerts** — configurable threshold with notification when AI spend exceeds limit
- **Per-feature cost breakdown** chart in the dashboard
