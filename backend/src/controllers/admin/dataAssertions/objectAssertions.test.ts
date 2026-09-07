/**
 * The object rules ask the product's own question about a row, and every term
 * a composite carries is pinned here against the fragment it must come from
 * rather than against a string spelled a second time — a test that repeats
 * the literal passes when both copies drift together.
 */
import { describe, it, expect } from 'vitest';
import { heldFieldAnsweredSql, heldFieldRefusedSql } from '../../experience/heldDecisions.js';
import { admissionPinnedSql, iconicPinnedSql } from '../../../db/membership.js';
import {
  KILL_CLASSES, VETO_CLASSES, WORSHIP_CLASSES, MONUMENT_CLASSES, FOUNTAIN_ROOT,
} from '../../../services/sync/publicArt/classes.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SQL_WHITESPACE_ALTERNATION, tidyLabelSql } from '../../../services/sync/labelFold.js';
import { objectAssertions } from './objectAssertions.js';

const byId = (id: string) => {
  const assertion = objectAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the object assertions', () => {
  it('all live in the objects area, with a title and a meaning', () => {
    for (const a of objectAssertions) {
      expect(a.area).toBe('objects');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe('the danger flag against its tag', () => {
  const assertion = byId('danger-flag-disagrees-with-its-tag');
  const sql = collapse(assertion.sql);

  it('reads a null tag column as no tag, rather than dropping the row', () => {
    // `tags` is nullable and reachable as null -- `createManualExperience`
    // writes NULL for an object created with none -- and `NULL ? 'in_danger'`
    // is NULL, so `NULL <> FALSE` is neither true nor false and Postgres drops
    // the row. That would lose the direction this rule calls the worse one: a
    // hand-made object flagged in danger with nothing tagging it. Measured
    // against the live catalogue with one such row inserted in a transaction:
    // uncoalesced finds nothing, this finds it.
    expect(sql).toContain("COALESCE(e.tags ? 'in_danger', FALSE) <> COALESCE(e.metadata->'inDanger' = 'true'::jsonb, FALSE)");
  });

  it('asks the two stored columns, not UNESCO\'s own field', () => {
    // A rule about this catalogue's two copies of one fact. Re-reading
    // `dangerList` here would make the assertion a second copy of the
    // importer's reading, which is the copy that would rot.
    expect(sql).toContain("e.tags ? 'in_danger'");
    // And not while the flag itself is held: under a gate the run writes the tag
    // past it and holds the flag, so the two are apart by design until the card
    // is published (#570). The held *flag*, not the held row -- any held field
    // sets the pointer, and every UNESCO row on the dev database carries one
    // (criteria and a credit held on all 1272), so a bare pointer test would
    // switch the check off for the whole category. The flag is named on its
    // own, never inside the `metadata` catch-all, so only its own name is asked.
    // The pointer is the membership's (#822), so the changeset is reached
    // through it.
    expect(sql).toContain('JOIN experience_kind_memberships m ON m.experience_id = e.id AND m.pending_change_sync_log_id = ch.sync_log_id');
    expect(sql).toContain("AND (f->>'held')::boolean");
    expect(sql).toContain("AND f->>'field' = 'metadata.inDanger')");
    expect(sql).not.toContain("'metadata')");
    expect(sql).not.toContain('pending_change_sync_log_id IS NULL');
    // Excused on *any* answer, which is where this parts company with the credit
    // check one assertion over (#722): a published flag is a flag that landed, so
    // the two halves agree and there is nothing left to reconcile. A published
    // credit is not — see `heldFieldRefusedSql`.
    expect(sql).toContain(collapse(heldFieldAnsweredSql('e.id')));
    expect(sql).not.toContain(collapse(heldFieldRefusedSql('e.id')));
    expect(sql).toContain("e.metadata->'inDanger' = 'true'::jsonb");
  });

  it('catches the disagreement whichever half is missing', () => {
    // Tagged and not flagged is the shape 035 repaired; flagged and not tagged
    // is a badge on a site nothing lists, and a one-sided test would report the
    // catalogue clean while a traveller is told a place is in peril.
    expect(sql).toMatch(/<>/);
    expect(assertion.describe({
      experience_id: 21, experience_name: 'Ancient City of Aleppo',
      tagged: true, flagged: false, listing: 'Y 2013',
    })).toBe('Ancient City of Aleppo: tagged as in danger since 2013, with no badge on it '
      + '(experience 21)');
    expect(assertion.describe({
      experience_id: 764, experience_name: 'Belize Barrier Reef Reserve System',
      tagged: false, flagged: true, listing: null,
    })).toBe('Belize Barrier Reef Reserve System: badged as in danger with nothing in the '
      + 'catalogue listing it (experience 764)');
  });

  it('says the year only where the listing carries one', () => {
    expect(assertion.describe({
      experience_id: 1, experience_name: 'A site', tagged: true, flagged: false, listing: null,
    })).toBe('A site: tagged as in danger, with no badge on it (experience 1)');
  });
});

describe('a refused row still wearing the Iconic badge', () => {
  const assertion = byId('refused-row-wearing-iconic');
  const sql = collapse(assertion.sql);

  it('asks the admission axis and the flag together, on the membership itself', () => {
    // Both are columns of the membership (#822), written by the same refusal
    // paths, so the question is whether one moved without the other (#760).
    // The flag as stored is what a read of it on its own -- the Iconic filter,
    // an export -- would hand a reader, so it is the stored value that is
    // asked, not a reader composite.
    expect(sql).toContain('FROM experience_kind_memberships m');
    expect(sql).toContain("WHERE m.admission = 'refused' AND m.is_iconic");
    expect(sql).toContain('JOIN experience_categories c ON c.id = m.source_id');
    expect(assertion.kind).toBe('invariant');
  });

  it('leaves alone the one row the writers leave alone: a flag a curator pinned', () => {
    // The refusal writes keep a pinned flag (`CLEAR_ICONIC`), so a pinned
    // refused row is the badge kept on purpose rather than a defect. The guard
    // is the writers' own, imported, so the two cannot drift apart.
    expect(sql).toContain(`AND NOT ${iconicPinnedSql('m')}`);
  });

  it('names the row and the category that turned it away', () => {
    expect(assertion.describe({
      experience_id: 6205, experience_name: 'British Museum', category_name: 'Art Museums',
    })).toBe('British Museum: turned away from Art Museums and still badged as a must-see '
      + '(experience 6205)');
  });

  it('sends the admin to the migration for the rows refused before the writers cleared the flag', () => {
    expect(assertion.meaning).toContain('042');
  });
});

describe('an admitted public-art row typed as a building', () => {
  const assertion = byId('public-art-row-typed-a-building');
  const sql = collapse(assertion.sql);

  it('asks only the admitted, source-written rows of the public-art source', () => {
    // The membership the public-art source brought (#822): its classes and
    // its admission are that source's, whatever else the place belongs to.
    expect(sql).toContain('JOIN experience_kind_memberships m ON m.experience_id = e.id AND m.source_id = 3');
    expect(sql).toContain("m.admission = 'admitted'");
    expect(sql).toContain('e.is_manual = FALSE');
    expect(assertion.kind).toBe('invariant');
  });

  it('reads the classes the run stored, against the rule\'s own lists', () => {
    // Composing the writer's lists is the point rather than the exception the
    // data-assertions doc warns about: what this catches is a row the rule
    // never reached — created before the test, or admitted by a path without
    // it — not a wrong rule, which no check reading its output could see.
    expect(sql).toContain("e.metadata->'wikidataClasses'");
    for (const qid of [...Object.keys(KILL_CLASSES), ...Object.keys(WORSHIP_CLASSES)]) {
      expect(sql).toContain(`'${qid}'`);
    }
    for (const qid of Object.keys(VETO_CLASSES)) expect(sql).toContain(`'${qid}'`);
  });

  it('lets an artwork class answer a building class by the rule\'s own answer, not an approximation', () => {
    // The Hermannsdenkmal is a sculpture and a tower; Monas an obelisk and a
    // museum; a holy well built into a building is in the fountain closure.
    // The rule stores whether an artwork class answered (`wikidataArtwork`),
    // and the check reads that rather than the row's type or a pinned list,
    // which cannot hold the closures the rule reads at run time. COALESCE,
    // because a row the run wrote before the key existed carries none.
    expect(sql).toContain("NOT COALESCE((e.metadata->>'wikidataArtwork')::boolean, FALSE)");
    expect(sql).not.toContain("e.type IS DISTINCT FROM");
    expect(sql).not.toContain("e.type <>");
    for (const qid of [...Object.keys(MONUMENT_CLASSES), FOUNTAIN_ROOT]) expect(sql).not.toContain(`'${qid}'`);
  });

  it('leaves alone a row whose admission a curator pinned', () => {
    // An override says the rule was wrong about this row; naming it here every
    // run would be the rule arguing back.
    expect(sql).toContain(`AND NOT ${admissionPinnedSql('m')}`);
  });

  it('names the row and says the classes that give it away in words', () => {
    // The query hands back the ids the row stores; the sentence carries the
    // labels the lists know them by, and an id no list knows stays an id.
    expect(assertion.describe({
      experience_id: 6301, experience_name: 'Segovia Cathedral', classes: 'Q56242215',
    })).toBe('Segovia Cathedral: admitted to Public Art & Monuments, typed Catholic cathedral '
      + '(experience 6301)');
    expect(assertion.describe({
      experience_id: 1477, experience_name: 'Aljafería', classes: 'Q16560, Q23413, Q999999',
    })).toBe('Aljafería: admitted to Public Art & Monuments, typed palace, castle, Q999999 '
      + '(experience 1477)');
  });
});

describe('a place that belongs to no kind', () => {
  const assertion = byId('place-without-membership');
  const sql = collapse(assertion.sql);

  it('asks for a row with no membership at all, whatever its state', () => {
    // Every reader-facing read asks the four questions through the memberships
    // (#822), so such a row is on no screen and in no queue. Not filtered on
    // lifecycle: a lost or refused place with a membership is answered, one
    // without is never asked.
    expect(sql).toContain('WHERE NOT EXISTS ( SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = e.id )');
    expect(sql).not.toMatch(/admission|curation_state|existence/);
    expect(assertion.kind).toBe('invariant');
  });

  it('names the source the row is keyed on, which is the kind it wants', () => {
    expect(assertion.describe({
      experience_id: 12001, experience_name: 'Kartlis Deda', category_name: 'Public Art & Monuments',
    })).toBe('Kartlis Deda: keyed on Public Art & Monuments and a member of no kind (experience 12001)');
  });
});

describe('a membership brought by a source other than the one its row is keyed on', () => {
  const assertion = byId('membership-source-disagrees-with-row');
  const sql = collapse(assertion.sql);

  it('compares the membership\'s source with the row\'s identity column', () => {
    // `experiences.category_id` is the identity arbiter until #755, and the
    // lists read it while the counts read the membership; a row where the two
    // disagree is shown in one kind and counted in another.
    expect(sql).toContain('WHERE m.source_id <> e.category_id');
    expect(assertion.kind).toBe('invariant');
  });

  it('names both sources, since the remedy is choosing between them', () => {
    expect(assertion.describe({
      experience_id: 382, experience_name: 'Statue of Liberty',
      row_source_name: 'UNESCO World Heritage Sites', membership_source_name: 'Public Art & Monuments',
    })).toBe('Statue of Liberty: keyed on UNESCO World Heritage Sites, its membership brought by '
      + 'Public Art & Monuments (experience 382)');
  });
});

describe('the name a filter cannot find', () => {
  const assertion = byId('name-carries-whitespace-nobody-typed');
  const sql = collapse(assertion.sql);

  it('asks the store rule in its SQL spelling, of every column a person types into a filter', () => {
    // The rule is `tidyLabel`; `tidyLabelSql` is that rule over a column, and
    // `labelFold.test.ts` pins the two to each other. Composed rather than
    // restated, so the check cannot drift from what the writers store.
    expect(sql).toContain(collapse(`e.name <> ${tidyLabelSql('e.name')}`));
    // The strings of the local-names map only, as for the makers: a value that
    // is not a string is not a name, and read as text it would be asked a
    // question about a value it is not.
    expect(sql).toContain("jsonb_each(e.name_local) kv WHERE jsonb_typeof(kv.value) = 'string'");
    expect(sql).toContain(collapse(`(kv.value #>> '{}') <> ${tidyLabelSql("(kv.value #>> '{}')")}`));
    // The strings of the list only: a non-string element is not a name, and
    // read as text it would be asked a question about a value it is not.
    expect(sql).toContain("jsonb_array_elements(e.metadata->'creators') c WHERE jsonb_typeof(c.value) = 'string'");
    expect(sql).toContain(collapse(`el.name <> ${tidyLabelSql('el.name')}`));
    expect(sql).toContain(collapse(`t.name <> ${tidyLabelSql('t.name')}`));
    expect(sql).toContain('unnest(t.artists)');
    // And not by asking what the writers' code thinks: a check that agreed with
    // a writer by construction would report clear on every row it got wrong.
    expect(sql).not.toContain('curated_fields');
  });

  it('spells the whitespace the way migration 047 does, so the two rewrite the same rows', () => {
    // The migration cannot import the constant, so it carries the alternation
    // in full; a code point added to one and not the other is a name one side
    // tidies and the other reports for ever.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
    const migration = readFileSync(
      fileURLToPath(new URL(
        '../../../../../db/migrations/047-a-name-is-stored-as-a-person-would-type-it.sql',
        import.meta.url,
      )),
      'utf8',
    );
    expect(migration).toContain(`'${SQL_WHITESPACE_ALTERNATION}+'`);
    expect(sql).toContain(SQL_WHITESPACE_ALTERNATION);
  });

  it('says the row the way a person would', () => {
    expect(assertion.describe({ kind: 'work', id: 3122, name: 'St. John  on Patmos', field: 'name' }))
      .toBe('work 3122, "St. John  on Patmos": name is not stored as a person would type it');
  });
});
