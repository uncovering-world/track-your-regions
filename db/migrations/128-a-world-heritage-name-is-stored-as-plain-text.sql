-- 128-a-world-heritage-name-is-stored-as-plain-text.sql
--
-- The World Heritage Centre's feed writes some names with inline HTML, and the
-- run stored them as received, so every screen drew the tags (#1610): Map mode
-- listed "Via Appia. <em>Regina Viarum</em>" under Lazio. On the development
-- catalogue on 2026-10-18 that was 21 places' names, 23 places' local names
-- and 8 points' names, and no work's or membership's view.
--
-- The run now reads the feed's names as plain text (`feedText`,
-- backend/src/services/sync/unescoText.ts). This brings the stored rows to the
-- same rule, step by step as it reads:
--   - a line break is a space (Auschwitz Birkenau's name runs on after one);
--   - an underlined letter is that letter with a macron below, U+0331, as the
--     Haida and Pitjantjatjara spellings write it: S<U>G</U>ang Gwaay is
--     SG̱ang Gwaay, and NFC composes Ulu<U>r</U>u-Kata Tju<U>t</U>a into
--     Uluṟu-Kata Tjuṯa;
--   - every other tag goes, and the name is tidied as every stored name is.
-- Every underline in the feed holds one letter, as the pattern below assumes.
--
-- The change records are read the same way, as migration 047 read them for
-- whitespace, so a record still matches the row it describes: a name field's
-- old and new values, a changed component's name and its name fields, and the
-- record's snapshot of the name (94, 12 and 253 records on dev). The answers
-- keyed by a name, a held part's `part_name` and a declined conflict, carried
-- no tag on the development catalogue on 2026-10-18 and are left alone.
--
-- Order-independent: a name with no tag is untouched.
-- Re-runnable: a name already plain matches nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.feed_text(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  text_now text;
  text_before text;
BEGIN
  text_now := regexp_replace(regexp_replace(value, '<br\s*/?>', ' ', 'gi'), '<u>([^<])</u>', '\1' || chr(817), 'gi');
  -- Until nothing changes, so a tag that dropping another one assembles goes too.
  LOOP
    text_before := text_now;
    text_now := regexp_replace(text_now, '</?[a-zA-Z][^<>]*>', '', 'g');
    EXIT WHEN text_now = text_before;
  END LOOP;
  RETURN btrim(regexp_replace(normalize(text_now, NFC), '\s+', ' ', 'g'));
END
$$;

UPDATE experiences
   SET name = pg_temp.feed_text(name)
 WHERE name ~ '<[a-zA-Z/][^<>]*>';

UPDATE experiences e
   SET name_local = (
         SELECT jsonb_object_agg(kv.key,
                  CASE WHEN jsonb_typeof(kv.value) = 'string'
                       THEN to_jsonb(pg_temp.feed_text(kv.value #>> '{}'))
                       ELSE kv.value END)
           FROM jsonb_each(e.name_local) kv)
 WHERE e.name_local::text ~ '<[a-zA-Z/][^<>]*>';

UPDATE experience_locations
   SET name = pg_temp.feed_text(name)
 WHERE name ~ '<[a-zA-Z/][^<>]*>';

-- The source's own view of the name (ADR-0084), which a curator can choose
-- onto the place and the near-places pass compares: none carried a tag on the
-- development catalogue, but a database whose run stored one gets it read
-- the same way, so a view chosen before the next run brings no tag back.
UPDATE experience_kind_memberships
   SET reported_name = pg_temp.feed_text(reported_name)
 WHERE reported_name ~ '<[a-zA-Z/][^<>]*>';

-- The change records. A recorded value: a string is read through the rule, a
-- list's strings are, anything else is what it was.
CREATE FUNCTION pg_temp.feed_json(value jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN value IS NULL THEN NULL
      WHEN jsonb_typeof(value) = 'string' THEN to_jsonb(pg_temp.feed_text(value #>> '{}'))
      WHEN jsonb_typeof(value) = 'array' THEN COALESCE(
        (SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'string'
                               THEN to_jsonb(pg_temp.feed_text(e.value #>> '{}'))
                               ELSE e.value END ORDER BY e.ordinality)
           FROM jsonb_array_elements(value) WITH ORDINALITY AS e(value, ordinality)),
        '[]'::jsonb)
      ELSE value
    END
  $$;

-- A field entry with `old` and `new` read where present, and only there.
CREATE FUNCTION pg_temp.feed_entry(entry jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN entry ? 'new' THEN jsonb_set(e1, '{new}', pg_temp.feed_json(entry->'new')) ELSE e1 END
      FROM (SELECT CASE WHEN entry ? 'old' THEN jsonb_set(entry, '{old}', pg_temp.feed_json(entry->'old')) ELSE entry END AS e1) s
  $$;

CREATE FUNCTION pg_temp.names_a_name(field text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
    SELECT field = 'name' OR field LIKE 'nameLocal.%'
  $$;

UPDATE experience_sync_changes
   SET name_snapshot = pg_temp.feed_text(name_snapshot)
 WHERE name_snapshot ~ '<[a-zA-Z/][^<>]*>';

UPDATE experience_sync_changes ch
   SET changed_fields = (SELECT jsonb_agg(CASE WHEN pg_temp.names_a_name(f.value->>'field')
                                               THEN pg_temp.feed_entry(f.value) ELSE f.value END
                                          ORDER BY f.ordinality)
                           FROM jsonb_array_elements(ch.changed_fields) WITH ORDINALITY AS f(value, ordinality))
 WHERE jsonb_typeof(ch.changed_fields) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.changed_fields) f
                WHERE pg_temp.names_a_name(f->>'field') AND pg_temp.feed_entry(f) <> f);

UPDATE experience_sync_changes ch
   SET contents = jsonb_set(ch.contents, '{locations,changed}', (
         SELECT jsonb_agg(
                  jsonb_set(
                    jsonb_set(c.value, '{item,name}', pg_temp.feed_json(c.value->'item'->'name')),
                    '{fields}',
                    COALESCE((SELECT jsonb_agg(CASE WHEN pg_temp.names_a_name(f.value->>'field')
                                                    THEN pg_temp.feed_entry(f.value) ELSE f.value END
                                               ORDER BY f.ordinality)
                                FROM jsonb_array_elements(c.value->'fields') WITH ORDINALITY AS f(value, ordinality)),
                             '[]'::jsonb))
                  ORDER BY c.ordinality)
           FROM jsonb_array_elements(ch.contents->'locations'->'changed') WITH ORDINALITY AS c(value, ordinality)))
 WHERE jsonb_typeof(ch.contents->'locations'->'changed') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.contents->'locations'->'changed') c
                WHERE pg_temp.feed_json(c->'item'->'name') IS DISTINCT FROM c->'item'->'name'
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(c->'fields') f
                               WHERE pg_temp.names_a_name(f->>'field') AND pg_temp.feed_entry(f) <> f));

COMMIT;
