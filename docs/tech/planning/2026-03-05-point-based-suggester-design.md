# Point-Based Division Suggester — Future Ideas

Feature implemented. See `backend/src/services/worldViewImport/pointMatcher.ts` and `backend/src/services/wikivoyageExtract/markerParser.ts`.

## Potential Improvements

- **Parent-level clustering**: Run point matcher for all children of a parent at once, clustering GADM divisions to optimally assign siblings (currently per-region only)
- **Marker caching**: Cache parsed markers per Wikivoyage page to avoid re-fetching wikitext on repeated point-match calls
- **Batch point-match**: Add a "Point-match all" button that runs point matching for all unmatched regions with geoshape unavailable
- **Confidence scoring**: Improve the fixed score=500 to vary based on number of points found, marker density, and geo tag vs markers
- **Pre-compute marker availability**: During import enrichment, flag which regions have markers available so the UI can show/hide the button proactively (currently availability is only known at geoshape-check time)
