-- 029: A local cache for Wikidata's answers, with an expiry a person can read.
--
-- Museum run 61 died in its collection phase having already paid for 1166
-- artwork classes, and threw them away: a collection that fails in its third
-- phase starts the next attempt at the first. The endpoint's own guidance is to
-- assume it is degraded and to work in batches, which only helps if the batches
-- that succeeded are kept.
--
-- Keyed by the hash of the query text rather than by a name we invent, because
-- the query *is* the question: change a filter and it is a different question
-- and must miss. The text is kept beside it so the admin panel can show what a
-- cached row actually asked, and so a stale answer can be read rather than
-- guessed at.
--
-- `expires_at` is stored rather than computed on read, so the row carries its
-- own rule: the TTL that applied when it was written stays with it even if the
-- constant changes, and a person looking at the panel sees the same expiry the
-- reader will honour.
CREATE TABLE IF NOT EXISTS wikidata_query_cache (
    id SERIAL PRIMARY KEY,
    -- Whose run kept this. The store is shared, but the question an admin asks is
    -- always about one source -- "why did the museum run answer that" -- and the
    -- lifetimes differ by source as much as by kind: a museum's work pool and a
    -- UNESCO site list age at different rates. Cascade, because a category that
    -- no longer exists has no answers worth keeping.
    category_id INTEGER NOT NULL REFERENCES experience_categories(id) ON DELETE CASCADE,
    query_hash TEXT NOT NULL UNIQUE,
    -- What kind of question this was, so the panel can group and a purge can be
    -- selective: a curator refreshing pools usually does not want to re-fetch
    -- the class closure that takes eleven minutes.
    kind TEXT NOT NULL,
    -- One line a person can read: 'artwork classes', 'pool: painting, 100+ sitelinks'.
    label TEXT NOT NULL,
    query_text TEXT NOT NULL,
    result JSONB NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wikidata_cache_kind ON wikidata_query_cache(kind);
CREATE INDEX IF NOT EXISTS idx_wikidata_cache_expires ON wikidata_query_cache(expires_at);

-- How long each kind is worth keeping, when an admin disagrees with the default.
--
-- The defaults live in code because they are an argument about how fast the
-- facts change -- an ontology moves over months, a label over hours -- and an
-- argument belongs where it can be read. This table is the override: a row here
-- means a person decided otherwise, and the absence of a row means nobody has.
--
-- Changing a lifetime re-stamps the answers already kept, because the alternative
-- is a panel that shows one rule and honours another until every row happens to
-- be replaced.
CREATE TABLE IF NOT EXISTS wikidata_cache_policy (
    category_id INTEGER NOT NULL REFERENCES experience_categories(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ttl_ms BIGINT NOT NULL CHECK (ttl_ms > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (category_id, kind)
);

COMMENT ON TABLE wikidata_cache_policy IS 'Per-kind overrides for how long a cached Wikidata answer stays fresh. Absent kind = the default in wikidataCache.ts, which states why that number and not another.';

COMMENT ON TABLE wikidata_query_cache IS 'Answers from query.wikidata.org, kept so a failed run resumes where it stopped and a repeated question costs their cluster nothing. Never a source of truth: every row carries its own expiry, a run can be told to ignore the cache entirely, and the admin panel shows each kind''s age and expiry with a button to drop it.';
COMMENT ON COLUMN wikidata_query_cache.query_hash IS 'SHA-256 of the exact query text. The query is the question, so a changed filter is a different key and misses by construction rather than by remembering to invalidate.';
COMMENT ON COLUMN wikidata_query_cache.expires_at IS 'Stored rather than derived: the row keeps the rule that applied when it was written, and the panel shows the same expiry the reader honours.';
