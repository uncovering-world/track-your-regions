-- 047: A name is stored as a person would type it (#835)
--
-- Every source is a label service and a label service passes runs of
-- whitespace through, and until this change every writer stored the label as
-- it came: Wikidata's English label for *St. John  on Patmos* (Q2390197,
-- treasure 3122) carries two spaces and *Portrait of a Man (Self      Portrait?)*
-- (Q2392901, treasure 2669) six; the World Heritage Centre's component names
-- carry eighteen runs across the catalogue (*marmalo  IV*, *Geoagiu  / Drumul
-- Romanilor*); 98 of the sites' Arabic local names carry one, and a no-break
-- space sits in the Spanish name of Qalhât, in three local names of Getbol and
-- in Getbol's own English name, *Korean Tidal Flats (Phase II)*. HTML collapses
-- all of it, so a reader types what the screen shows and a filter comparing
-- the raw string finds nothing. On the development catalogue this file
-- rewrites 121 rows; measured in a rolled-back run, and every count the
-- catalogue check reads afterwards is zero.
--
-- The writers now tidy every name before the diff and the write (`tidyLabel`,
-- backend/src/services/sync/labelFold.ts): the edges trimmed, a run of
-- whitespace inside collapsed to one plain space, case and dashes untouched.
-- This file brings what is already stored to the same form, so the next run
-- compares tidied to tidied and reports no rename for a label it only tidied
-- -- without it, the first UNESCO run after the change would file 98 Arabic
-- renames and 18 component renames, every one of them about nothing.
--
-- The whitespace is JavaScript's `\s`: ASCII whitespace and the Unicode
-- spaces, spelled as an alternation because under `en_US.utf8` a bracket
-- expression over these code points also matches the en dash (measured: it
-- named *MAK – Museum of Applied Arts*). The same expression, read from the
-- same constant, is what the catalogue check
-- `name-carries-whitespace-nobody-typed` asks of every row afterwards, and
-- `objectAssertions.test.ts` pins this file to it.
--
-- Four stores in one pass, the shape migration 040 set, because a name lives
-- in all four and a half-converted set is worse than either end of it:
--
--   1. the rows: the name of a place, every language of its local names, the
--      makers of a monument (`metadata.creators`), the name of a point, and
--      the title and the makers of a work;
--   2. the change records that carry those names
--      (`experience_sync_changes`): a `changed_fields` entry for `name`, a
--      `nameLocal.<lang>` or `metadata.creators`, and the contents entries'
--      `item.name` and `name` / `artists` fields -- their `old` and `new`
--      alike. A record holds the name as the run saw it (ADR-0026), and the
--      run saw a run of spaces; every reader that matches a record to a row
--      or to an answer compares the two, and from now on every run records
--      the tidied form, so a record left untidied would find neither;
--   3. the answers to those records -- `experience_held_decisions`, keyed by
--      the part's name and by the proposed value, and
--      `experience_conflict_decisions`, a claimed field's refusal keyed by the
--      proposed value: a refusal of a name recorded with the run's spaces has
--      to go on refusing the tidied proposal the next run makes of the same
--      name. Two held answers that become one name under the rule keep the
--      newer, since the unique key is on the tidied form from now on;
--   4. the writers that record an answer or publish a proposal tidy at the
--      write (`recordHeldAnswers`, `declineSourceValue`,
--      `publishHeldFields.ts`, `publishHeldParts.ts`), so nothing recorded
--      before this file can put back what it took out.
--
-- `experience_curation_log` is left alone, for 040's reason: it records what
-- a curator did and how the thing was called when they did it.
--
-- The rows touched keep their claims, holds and provenance: a tidied name is
-- the same name. The readers still compare a record's name to a row's and to
-- an answer's by the rule on both sides (`recordedLocationSql`,
-- `heldDecisions.ts`, the accept-source fallback), so a record a pre-change
-- backend writes after this file has run is found all the same.
--
-- Re-runnable: a value already tidy is its own tidied form and matches nothing.

\set ON_ERROR_STOP on

BEGIN;

-- `tidyLabel`, for this file only: `tidyLabelSql` in labelFold.ts is the
-- spelling the catalogue check reads.
CREATE FUNCTION pg_temp.tidy_label(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT btrim(regexp_replace(value,
      '(\s|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000|\ufeff)+',
      ' ', 'g'), ' ')
  $$;

UPDATE experiences
   SET name = pg_temp.tidy_label(name)
 WHERE name <> pg_temp.tidy_label(name);

-- The strings of the map only, as for the makers below: a value that is not
-- a string keeps its type rather than being read as text and written back
-- as a string. Every stored value is a string today (measured).
UPDATE experiences e
   SET name_local = (SELECT jsonb_object_agg(kv.key, CASE WHEN jsonb_typeof(kv.value) = 'string'
                                                          THEN to_jsonb(pg_temp.tidy_label(kv.value #>> '{}'))
                                                          ELSE kv.value END)
                       FROM jsonb_each(e.name_local) kv)
 WHERE EXISTS (SELECT 1 FROM jsonb_each(e.name_local) kv
                WHERE jsonb_typeof(kv.value) = 'string'
                  AND (kv.value #>> '{}') <> pg_temp.tidy_label(kv.value #>> '{}'));

-- Only the strings of the list are names; anything else a source might put
-- there keeps its type rather than being read as text and written back as a
-- string. Every stored element is a string today (measured), so this is the
-- rule stated rather than a row rewritten.
UPDATE experiences e
   SET metadata = jsonb_set(e.metadata, '{creators}',
                    (SELECT jsonb_agg(CASE WHEN jsonb_typeof(c.value) = 'string'
                                           THEN to_jsonb(pg_temp.tidy_label(c.value #>> '{}'))
                                           ELSE c.value END
                                      ORDER BY c.ordinality)
                       FROM jsonb_array_elements(e.metadata->'creators')
                            WITH ORDINALITY AS c(value, ordinality)))
 WHERE jsonb_typeof(e.metadata->'creators') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.metadata->'creators') c
                WHERE jsonb_typeof(c) = 'string'
                  AND (c #>> '{}') <> pg_temp.tidy_label(c #>> '{}'));

UPDATE experience_locations
   SET name = pg_temp.tidy_label(name)
 WHERE name <> pg_temp.tidy_label(name);

UPDATE treasures
   SET name = pg_temp.tidy_label(name)
 WHERE name <> pg_temp.tidy_label(name);

UPDATE treasures t
   SET artists = (SELECT array_agg(pg_temp.tidy_label(a.value) ORDER BY a.ordinality)
                    FROM unnest(t.artists) WITH ORDINALITY AS a(value, ordinality))
 WHERE EXISTS (SELECT 1 FROM unnest(t.artists) a WHERE a <> pg_temp.tidy_label(a));

-- ---------------------------------------------------------------------------
-- 2. The change records
-- ---------------------------------------------------------------------------

-- The rule over a recorded value: a string is tidied, a list's strings are,
-- anything else -- null, a number, an object -- is what it was.
CREATE FUNCTION pg_temp.tidy_json(value jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN value IS NULL THEN NULL
      WHEN jsonb_typeof(value) = 'string' THEN to_jsonb(pg_temp.tidy_label(value #>> '{}'))
      WHEN jsonb_typeof(value) = 'array' THEN COALESCE(
        (SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'string'
                               THEN to_jsonb(pg_temp.tidy_label(e.value #>> '{}'))
                               ELSE e.value END ORDER BY e.ordinality)
           FROM jsonb_array_elements(value) WITH ORDINALITY AS e(value, ordinality)),
        '[]'::jsonb)
      ELSE value
    END
  $$;

-- A field entry -- {field, old, new, ...} -- with `old` and `new` tidied where
-- present, and only where present: an absent `new` is a value withdrawn, and
-- must not become a null one.
CREATE FUNCTION pg_temp.tidy_entry(entry jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN entry ? 'new' THEN jsonb_set(e1, '{new}', pg_temp.tidy_json(entry->'new')) ELSE e1 END
      FROM (SELECT CASE WHEN entry ? 'old' THEN jsonb_set(entry, '{old}', pg_temp.tidy_json(entry->'old')) ELSE entry END AS e1) s
  $$;

-- Whether an entry names a field whose value is a name.
CREATE FUNCTION pg_temp.names_a_name(field text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
    SELECT field IN ('name', 'artists', 'metadata.creators') OR field LIKE 'nameLocal.%'
  $$;

-- The object's own fields.
UPDATE experience_sync_changes ch
   SET changed_fields = (SELECT jsonb_agg(CASE WHEN pg_temp.names_a_name(f.value->>'field')
                                               THEN pg_temp.tidy_entry(f.value) ELSE f.value END
                                          ORDER BY f.ordinality)
                           FROM jsonb_array_elements(ch.changed_fields) WITH ORDINALITY AS f(value, ordinality))
 WHERE jsonb_typeof(ch.changed_fields) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.changed_fields) f
                WHERE pg_temp.names_a_name(f->>'field') AND pg_temp.tidy_entry(f) <> f);

-- The parts: each kind's `changed` list, the item's name and its name-carrying
-- fields. The other lists (`added`, `withdrawn`, `returned`) name an item for
-- a person to read and nothing matches on them. One statement per kind rather
-- than a join over the two: a museum's record carries both kinds in one
-- column, and `UPDATE ... FROM` writes a target row once from whichever join
-- row it picks, which would leave the other kind untidied.
UPDATE experience_sync_changes ch
   SET contents = jsonb_set(ch.contents, '{locations,changed}', (
         SELECT jsonb_agg(
                  jsonb_set(
                    jsonb_set(c.value, '{item,name}', pg_temp.tidy_json(c.value->'item'->'name')),
                    '{fields}',
                    COALESCE((SELECT jsonb_agg(CASE WHEN pg_temp.names_a_name(f.value->>'field')
                                                    THEN pg_temp.tidy_entry(f.value) ELSE f.value END
                                               ORDER BY f.ordinality)
                                FROM jsonb_array_elements(c.value->'fields') WITH ORDINALITY AS f(value, ordinality)),
                             '[]'::jsonb))
                  ORDER BY c.ordinality)
           FROM jsonb_array_elements(ch.contents->'locations'->'changed') WITH ORDINALITY AS c(value, ordinality)))
 WHERE jsonb_typeof(ch.contents->'locations'->'changed') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.contents->'locations'->'changed') c
                WHERE pg_temp.tidy_json(c->'item'->'name') IS DISTINCT FROM c->'item'->'name'
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(c->'fields') f
                               WHERE pg_temp.names_a_name(f->>'field') AND pg_temp.tidy_entry(f) <> f));

UPDATE experience_sync_changes ch
   SET contents = jsonb_set(ch.contents, '{treasures,changed}', (
         SELECT jsonb_agg(
                  jsonb_set(
                    jsonb_set(c.value, '{item,name}', pg_temp.tidy_json(c.value->'item'->'name')),
                    '{fields}',
                    COALESCE((SELECT jsonb_agg(CASE WHEN pg_temp.names_a_name(f.value->>'field')
                                                    THEN pg_temp.tidy_entry(f.value) ELSE f.value END
                                               ORDER BY f.ordinality)
                                FROM jsonb_array_elements(c.value->'fields') WITH ORDINALITY AS f(value, ordinality)),
                             '[]'::jsonb))
                  ORDER BY c.ordinality)
           FROM jsonb_array_elements(ch.contents->'treasures'->'changed') WITH ORDINALITY AS c(value, ordinality)))
 WHERE jsonb_typeof(ch.contents->'treasures'->'changed') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.contents->'treasures'->'changed') c
                WHERE pg_temp.tidy_json(c->'item'->'name') IS DISTINCT FROM c->'item'->'name'
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(c->'fields') f
                               WHERE pg_temp.names_a_name(f->>'field') AND pg_temp.tidy_entry(f) <> f));

-- ---------------------------------------------------------------------------
-- 3. The answers
-- ---------------------------------------------------------------------------

-- Two answers whose part names become one under the rule: keep the newer.
-- Reachable before this change through a hand-tidied name -- the point
-- correction did not collapse an inner run -- and a run that then recorded the
-- tidied name and was refused again under it.
DELETE FROM experience_held_decisions older
 USING experience_held_decisions newer
 WHERE older.experience_id = newer.experience_id
   AND older.part_kind IS NOT DISTINCT FROM newer.part_kind
   AND older.part_ref IS NOT DISTINCT FROM newer.part_ref
   AND older.field = newer.field
   AND older.part_name <> newer.part_name
   AND pg_temp.tidy_label(older.part_name) = pg_temp.tidy_label(newer.part_name)
   AND (older.decided_at, older.id) < (newer.decided_at, newer.id);

UPDATE experience_held_decisions
   SET part_name = pg_temp.tidy_label(part_name)
 WHERE part_name <> pg_temp.tidy_label(part_name);

UPDATE experience_held_decisions
   SET value = pg_temp.tidy_json(value)
 WHERE pg_temp.names_a_name(field)
   AND pg_temp.tidy_json(value) <> value;

-- The sibling answer table: a refusal of a *claimed* field's proposal, matched
-- by value the same way (`reviewQueueController.ts`, `d.declined = ...`), and
-- the fields it can name include `name`, `nameLocal.<lang>` and
-- `metadata.creators` -- whose recorded `new` section 2 has just tidied.
UPDATE experience_conflict_decisions
   SET declined = pg_temp.tidy_json(declined)
 WHERE pg_temp.names_a_name(field)
   AND pg_temp.tidy_json(declined) <> declined;

COMMIT;
