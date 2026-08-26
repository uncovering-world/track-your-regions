/**
 * The assertions have to ask the *same* question the reads they guard ask.
 *
 * That is the whole risk in this file's design. An assertion composed of three
 * of the four reader predicates reports a clean catalogue while a screen shows
 * a list entry with no pin — and it would keep reporting clean, because
 * nothing else in the repository looks at the resting state. So every term of
 * every composite is pinned here against the fragment it must come from,
 * rather than against a string spelled a second time: a test that repeats the
 * literal passes when both copies drift together, which is the failure it
 * exists to catch.
 */

import { describe, it, expect } from 'vitest';
import {
  experienceOfferedToReaderSql,
  hideLostSql,
  offeredLocationSql,
  offeredToReaderSql,
  publishedContentSql,
} from '../../experience/experienceLifecycle.js';
import { heldWaitingSql } from '../../experience/waitingCounts.js';
import { LOCATION_UNCHANGED_METERS } from '../../../services/sync/changeSet.js';
import { catalogueAssertions } from './catalogueAssertions.js';

const byId = (id: string) => {
  const assertion = catalogueAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the catalogue assertions as a set', () => {
  it('gives every assertion an id of its own, since a report is read by id', () => {
    const ids = catalogueAssertions.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds exactly two watches, each a count that is expected to be non-zero', () => {
    // ADR-0022 makes the first a count: a traveller who stood somewhere stood
    // there. The second is #668's anchor rule: a scattered territory's box centre
    // is open water, legitimately, so its rows are a number to watch rather than
    // debt to answer for.
    const watches = catalogueAssertions.filter(a => a.kind === 'watch').map(a => a.id);
    expect(watches).toEqual(['visits-on-places-no-reader-is-shown', 'anchor-far-from-its-region']);
  });

  it('gives every assertion an area, since the list is expected to outgrow one screen', () => {
    for (const assertion of catalogueAssertions) {
      expect(['places', 'regions', 'pictures']).toContain(assertion.area);
    }
  });

  it('says what a matching row means, so a report can be acted on without this file', () => {
    for (const assertion of catalogueAssertions) {
      expect(assertion.meaning.length).toBeGreaterThan(0);
      expect(assertion.title.length).toBeGreaterThan(0);
    }
  });
});

describe('the two false-withdrawal assertions', () => {
  it('pairs on the reference as well as the distance (ADR-0027)', () => {
    for (const id of ['withdrawn-beside-its-replacement', 'two-offered-places-at-one-reference']) {
      const sql = collapse(byId(id).sql);
      // Both halves of the pair rule. A tolerance applied without the reference
      // would be a nearest-point search over an object's own points, and 4172
      // pairs of one experience's points lie within a kilometre of each other.
      expect(sql).toMatch(/external_ref IS NOT NULL/);
      expect(sql).toMatch(/external_ref IS NOT DISTINCT FROM/);
      expect(sql).toMatch(/ST_DWithin\([a-z]+\.location::geography/);
    }
  });

  it('measures in metres on geography, at the tolerance the writer uses', () => {
    for (const id of ['withdrawn-beside-its-replacement', 'two-offered-places-at-one-reference']) {
      const sql = collapse(byId(id).sql);
      // Imported rather than spelled: a change to the writer's tolerance that
      // left the assertion on the old number would guard a rule nothing applies.
      expect(sql).toContain(`::geography, ${LOCATION_UNCHANGED_METERS})`);
    }
  });

  it('separates the marked shape from the held one, which are repaired oppositely', () => {
    expect(collapse(byId('withdrawn-beside-its-replacement').sql))
      .toMatch(/WHERE ghost\.missing_since IS NOT NULL/);
    const held = collapse(byId('two-offered-places-at-one-reference').sql);
    expect(held).toMatch(/second\.missing_since IS NULL/);
    expect(held).toMatch(/WHERE first\.missing_since IS NULL/);
  });

  it('means by "on offer" what every reader-facing read means by it', () => {
    // The flag alone would go on reporting a pair a curator settled by
    // recording one of the two places as gone: it is on no map, and the
    // sentence would describe a screen nobody sees. `location_marked_lost` is
    // a verdict a curator can actually record.
    expect(collapse(byId('withdrawn-beside-its-replacement').sql))
      .toContain(collapse(offeredLocationSql('survivor')));
    const held = collapse(byId('two-offered-places-at-one-reference').sql);
    expect(held).toContain(collapse(offeredLocationSql('first')));
    expect(held).toContain(collapse(offeredLocationSql('second')));
  });

  it('leaves the marked row its own predicate, which is what it reports about', () => {
    // A ghost is by definition not offered, and a curator's verdict on it is
    // the thing being reported: #543 is a curator answering
    // `location_marked_former` on a museum that never moved.
    expect(collapse(byId('withdrawn-beside-its-replacement').sql))
      .not.toContain(collapse(offeredLocationSql('ghost')));
  });

  it('names the distance in millimetres, since the case it exists for is 12 mm', () => {
    const sentence = byId('withdrawn-beside-its-replacement').describe({
      ghost_id: 13211,
      survivor_id: 13398,
      marked_at: new Date('2026-08-10T09:00:00Z'),
      external_ref: 'Q127064',
      experience_name: 'Bilbao Fine Arts Museum',
      metres: 0.01244,
    });
    expect(sentence).toContain('Bilbao Fine Arts Museum');
    expect(sentence).toContain('0.012 m');
    expect(sentence).toContain('2026-08-10');
    expect(sentence).toContain('Q127064');
    expect(sentence).toContain('13211');
  });

  it('says which of two offered places is the unread one', () => {
    const sentence = byId('two-offered-places-at-one-reference').describe({
      first_id: 13211,
      second_id: 13398,
      external_ref: '132-001',
      first_state: 'auto',
      second_state: 'pending',
      experience_name: 'Megalithic Temples of Malta',
      metres: 0.01244,
    });
    expect(sentence).toContain('unread: 13398');
  });
});

describe('a stored name on its way into a report line', () => {
  it('strips the control characters a wiki label may carry', () => {
    // These names come from UNESCO's export and from Wikidata labels, which
    // anybody may edit. A newline would forge a line of the report and an
    // escape sequence would take over the terminal printing it.
    const sentence = byId('listed-with-nowhere-to-go').describe({
      experience_id: 1,
      experience_name: 'Bamiyan\n  [ok] every invariant holds\u001b[31m',
      external_id: '208',
      places_held: 0,
    });
    expect(sentence).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    expect(sentence).toContain('Bamiyan');
  });
});

describe('an object offered to readers with no place a reader can see', () => {
  const sql = collapse(byId('listed-with-nowhere-to-go').sql);

  it('asks the reader question whole, term for term', () => {
    // The composite, not a subset of it: this family of predicates was written
    // as a subset of itself six times on one branch, and each time the missing
    // term was a different one.
    expect(sql).toContain(collapse(experienceOfferedToReaderSql()));
    expect(sql).toContain(collapse(hideLostSql()));
    expect(sql).toContain(collapse(offeredLocationSql()));
    expect(sql).toContain(collapse(publishedContentSql('el')));
  });

  it('looks for the absence of a visible place, not of a row', () => {
    // A row exists in both failing shapes — an unread arrival and a withdrawn
    // point are rows. What is missing is a place a reader may be shown.
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM experience_locations el/);
  });

  it('distinguishes an object holding nothing from one holding only hidden places', () => {
    const empty = byId('listed-with-nowhere-to-go').describe({
      experience_id: 1614, experience_name: 'Victory Arch', external_id: 'Q1340523', places_held: 0,
    });
    const hidden = byId('listed-with-nowhere-to-go').describe({
      experience_id: 1, experience_name: 'Bamiyan Valley', external_id: '208', places_held: 8,
    });
    expect(empty).toContain('holds no place at all');
    expect(hidden).toContain('holds 8 none of which a reader may see');
  });
});

describe('visits on places no reader is shown', () => {
  const assertion = byId('visits-on-places-no-reader-is-shown');
  const sql = collapse(assertion.sql);

  it('negates the reader composite rather than a chosen part of it', () => {
    expect(sql).toContain(`NOT (${collapse(offeredToReaderSql())})`);
  });

  it('counts by place and never reads the person, whose whereabouts are not a maintainer\'s', () => {
    expect(sql).toMatch(/GROUP BY el\.id/);
    expect(sql).not.toMatch(/user_id|email|display_name/);
  });

  it('falls back to the location id where a place carries no name', () => {
    expect(assertion.describe({
      location_id: 8143, place_name: null, experience_name: 'Monasteries of Haghpat', ticks: 1,
    })).toContain('location 8143');
    expect(assertion.describe({
      location_id: 8143, place_name: 'Monastery of Haghpat', experience_name: 'Monasteries', ticks: 2,
    })).toContain('2 visits');
  });
});

describe('an object no region holds', () => {
  const assertion = byId('held-by-no-region');
  const sql = collapse(assertion.sql);

  it('asks about the reader-facing object, whole', () => {
    expect(sql).toContain(collapse(experienceOfferedToReaderSql()));
    expect(sql).toContain(collapse(hideLostSql()));
  });

  it('asks whether any row places the object, not whether a reader may see it there', () => {
    // `readerRegionMembershipSql` answers a question about one region, and needs
    // one to be about. An object held only by a row a reader cannot see is the
    // previous assertion's business; this one is about being held at all.
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM experience_regions er/);
    expect(sql).not.toMatch(/assignment_type/);
  });

  it('says where the object is, since that is what makes it findable at all', () => {
    expect(assertion.describe({
      experience_id: 300, experience_name: 'Aldabra Atoll', external_id: '185',
      countries: 'Seychelles',
    })).toContain('in Seychelles, and in no region');
  });

  it('does not print an empty country as though it were one', () => {
    expect(assertion.describe({
      experience_id: 411, experience_name: 'Great Barrier Reef', external_id: '154', countries: '',
    })).toContain('in no country named');
  });
});

describe('a place no region holds', () => {
  const assertion = byId('offered-place-in-no-region');
  const sql = collapse(assertion.sql);

  it('asks placement\'s question, not a reader\'s', () => {
    // Placement writes from every offered point, unread ones included, so that a
    // region curator's queue is not empty (ADR-0025 decision 5). Gating this on
    // what a reader may see would call an unplaced pending point compliant.
    expect(sql).toContain(collapse(offeredLocationSql()));
    expect(sql).not.toMatch(/curation_state/);
  });

  it('looks in the roll-up placement actually writes', () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM experience_location_regions r/);
  });

  it('names the place as well as the object, since one object may have many', () => {
    expect(assertion.describe({
      location_id: 7042, place_name: 'Gold Beach', experience_id: 500,
      experience_name: 'Beaches of the D-Day Landings',
    })).toBe('Beaches of the D-Day Landings — Gold Beach: on offer and in no region (location 7042)');
  });
});

describe('a picture with nobody credited', () => {
  const assertion = byId('picture-with-nobody-credited');
  const sql = collapse(assertion.sql);

  it('covers both tables that hold a picture', () => {
    expect(sql).toMatch(/FROM experiences e/);
    expect(sql).toMatch(/FROM treasures t/);
  });

  it('selects nothing on lifecycle, because the obligation follows the picture', () => {
    // The curation screens show pending rows to curators; working on the
    // catalogue rather than publishing it does not change whose photograph it is.
    // The claim is about which rows are *selected*: the waiting flag beside them
    // is the queue's own predicate and carries the queue's own conditions.
    const selections = sql.match(/WHERE [a-z]\.image_url[^)]*?(?= UNION| ORDER)/g);
    expect(selections).toHaveLength(2);
    for (const clause of selections ?? []) {
      expect(clause).not.toMatch(/admission|curation_state|missing_since/);
    }
  });

  it('treats a key holding null as nothing claimed, which is what a claimed image writes', () => {
    expect(sql).toMatch(/metadata->>'imageCredit' IS NULL/);
  });

  it('says when the author is already fetched and waiting on a curator', () => {
    // Measured: 1414 of the 1590 uncredited objects have a held change naming
    // imageCredit. "Publish what is waiting" and "go and fetch it" are different
    // afternoons, and a report that called them one thing sends a person to the
    // wrong one.
    // The queue's own question, composed rather than re-spelled: the changeset
    // rows are provenance and are never deleted (#480), while the pointer is
    // cleared as soon as a run proposes nothing — so a flag keyed on the
    // changeset alone would say "waiting" for ever over an empty queue.
    expect(sql).toContain(collapse(heldWaitingSql('e')));
    expect(sql).toMatch(/ch\.sync_log_id = e\.pending_change_sync_log_id/);
    expect(assertion.describe({
      holder: 'object', row_id: 300, row_name: 'Aldabra Atoll',
      host: 'whc.unesco.org', credit_waiting: true,
    })).toContain('its author fetched and waiting on a curator');
    expect(assertion.describe({
      holder: 'work', row_id: 88, row_name: 'The Night Watch',
      host: 'upload.wikimedia.org', credit_waiting: false,
    })).not.toContain('waiting');
  });

  it('names the host, since which licence applies depends on where the picture is from', () => {
    expect(assertion.describe({
      holder: 'work', row_id: 88, row_name: 'The Night Watch', host: 'upload.wikimedia.org',
    })).toBe('The Night Watch: a picture from upload.wikimedia.org with nobody credited (work 88)');
  });
});
