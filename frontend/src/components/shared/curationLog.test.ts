/**
 * Tests for what an object's History makes of the twenty acts its trail records.
 *
 * This screen is the only place several of them are readable at all: answering a point's
 * verdict takes the point off every list, taking a verdict back moves the row's note to
 * whoever took it, and the two cards that ask for a note promise it "in this object's
 * curation history" — so the wording that explained an answer survives here or nowhere
 * (#544). The card that destroys it says so and points here — a promise this file is what
 * keeps true.
 *
 * Both halves used to fail silently, first for a point's verdict (#690) and then for the
 * nine acts the labels never learned (#691): the chip fell through to the raw
 * `admission_overridden` and the detail line returned null, so the History said a machine
 * word and nothing else about six acts that carry a curator's own sentence.
 */

import { describe, it, expect } from 'vitest';
import { ACTION_LABELS, formatLogDetails } from './curationLog';

/** An entry as the controllers write it. */
function entry(action: string, details: Record<string, unknown>) {
  return { id: 1, action, details, curator_id: 1, created_at: '2026-08-15T09:12:00Z' } as never;
}

describe('a point verdict in the object’s history', () => {
  it('names every verdict, so the row does not print a machine word', () => {
    // The fallback is `{ label: entry.action }`, which reads as `location_marked_former`
    // on a screen a curator is meant to read.
    for (const action of [
      'location_marked_former', 'location_marked_lost',
      'location_state_restored', 'location_missing_dismissed',
    ]) {
      expect(ACTION_LABELS[action]?.label).toBeTruthy();
      expect(ACTION_LABELS[action]?.label).not.toContain('location_');
    }
  });

  it('carries the note, which has no other screen once the verdict moves', () => {
    const line = formatLogDetails(entry('location_marked_lost', {
      locationId: 13211,
      membership: { old: 'present', new: 'present' },
      existence: { old: 'extant', new: 'lost' },
      note: 'Demolished in the 2019 fire; the source still lists it',
    }));

    expect(line).toContain('Demolished in the 2019 fire');
    expect(line).toContain('13211');
  });

  it('does not repeat an axis the act never moved', () => {
    // `details` carries both axes whatever the verdict was about, so a formatter reading
    // them off would print `existence: extant → extant` beside a membership verdict. The
    // chip already names the transition.
    const line = formatLogDetails(entry('location_marked_former', {
      locationId: 13211,
      membership: { old: 'present', new: 'former' },
      existence: { old: 'extant', new: 'extant' },
      note: null,
    }));

    expect(line).toBe('Place #13211');
  });

  it('names the correction beside the verdicts, being the same family and the same list', () => {
    // Left out, the History reads "Place: source dropped it" on one row and
    // `location_edited` on the next — the inconsistency naming four of five creates.
    expect(ACTION_LABELS.location_edited?.label).toBeTruthy();

    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      name: { old: 'Shahr-i-Zuhak', new: 'Shahr-e Zohak' },
    }));
    expect(line).toContain('Place #13211');
    expect(line).toContain('Shahr-e Zohak');
  });

  it('prints a moved point as a coordinate, not as [object Object]', () => {
    // A point edit records the move as a pair of objects, unlike every scalar the
    // object-level `edited` action carries — so the row that exists to say what moved is
    // the one shape the shared formatter could not render.
    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      location: { old: { lon: -2.93785, lat: 43.265974 }, new: { lon: -2.9378, lat: 43.2661 } },
      anchorMoved: true,
    }));

    expect(line).not.toContain('[object Object]');
    expect(line).toContain('43.265974, -2.93785');
    expect(line).toContain('43.2661, -2.9378');
  });

  it('does not round a correction smaller than the writer’s tolerance away', () => {
    // Four decimals is about 11 m, which is right for naming where a place is and wrong
    // here: the catalogue's own case is 1.2 cm (#543), and a row saying X → X about a
    // move is worse than no row.
    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      location: {
        old: { lon: -2.93785, lat: 43.26597 },
        new: { lon: -2.93785, lat: 43.265973888 },
      },
    })) as string;
    const [before, after] = line.split('→');

    expect(before).not.toBe(after);
    expect(line).toContain('43.265973888');
  });

  it('leaves the other kinds of entry as they were', () => {
    expect(formatLogDetails(entry('rejected', { reason: 'duplicate' }))).toBe('Reason: duplicate');
    expect(formatLogDetails(entry('added_to_region', { regionId: 4 }))).toBeNull();
  });
});

describe('every act the History can be handed', () => {
  // Which acts exist is the schema's answer, not this file's: the CHECK on
  // `experience_curation_log.action` is the closed list, and `curationLogActionLabels`
  // in the backend suite is what holds the two together — a text-level guard in the
  // family of `schemaMigrationParity`, since the label lives in a module no backend
  // test can import and the schema in a file no frontend test may read. What is
  // checkable from here is the quality of each label, for every one that exists.
  it.each(Object.keys(ACTION_LABELS))('says %s in words rather than in the column value',
    (action) => {
      const named = ACTION_LABELS[action];
      expect(named.label).toBeTruthy();
      expect(named.label).not.toBe(action);
      expect(named.label).not.toMatch(/_/);
      // The fallback's grey is what an unnamed action rendered as; a label wearing it
      // would be a row that looks answered for and is not.
      expect(named.color).not.toBe('#6B7280');
    });
});

describe('a verdict on the whole object', () => {
  // The point-level four and these four are deliberately distinct actions — the prefix is
  // what stops a component's departure reading as the whole site's (ADR-0026) — so the
  // History has to tell them apart on the chip.
  it('does not read as a verdict on one of its places', () => {
    for (const action of ['marked_former', 'marked_lost', 'state_restored', 'missing_dismissed']) {
      expect(ACTION_LABELS[action]?.label).not.toContain('Place');
      expect(ACTION_LABELS[`location_${action}`]?.label).toContain('Place');
    }
  });

  it('carries the note the card promised would be kept with the answer', () => {
    // "Kept with your answer in this object's curation history", says the field on the
    // missing card. Until this, it was kept and shown nowhere.
    const line = formatLogDetails(entry('marked_lost', {
      membership: { old: 'present', new: 'present' },
      existence: { old: 'extant', new: 'lost' },
      note: 'Demolished after the 2019 fire; the source still lists it',
    }));

    expect(line).toBe('“Demolished after the 2019 fire; the source still lists it”');
  });

  it('says nothing rather than repeating an axis the act never moved', () => {
    expect(formatLogDetails(entry('marked_former', {
      membership: { old: 'present', new: 'former' },
      existence: { old: 'extant', new: 'extant' },
      note: null,
    }))).toBeNull();
  });
});

describe('a verdict on a rule’s refusal', () => {
  it('keeps the objection and the curator’s answer to it', () => {
    // Both halves are the point: the rule's own words are how a bad rule is found in a
    // category's history, and the note is why this curator agreed with it.
    const line = formatLogDetails(entry('admission_confirmed', {
      reason: 'not an art museum — painting-share: 0 painting(s) vs 2 sculptural work(s)',
      note: 'Sculpture park, and the works are the collection',
      published: false,
      locations: 0, treasureLinks: 0, treasures: 0, withdrawalsReleased: 0,
    }));

    expect(line).toContain('The rule said: not an art museum');
    expect(line).toContain('“Sculpture park, and the works are the collection”');
  });

  it('says that overriding published the object, which is half of what it did', () => {
    // An override on a row nobody had passed makes it visible in the same transaction
    // (ADR-0025 § 4.5). A history that recorded only the admission would leave a curator
    // to infer the publication from the category of act.
    const line = formatLogDetails(entry('admission_overridden', {
      reason: 'not an art museum — named by a monument',
      note: null,
      published: true,
      locations: 1, treasureLinks: 12, treasures: 12, withdrawalsReleased: 0,
    })) as string;

    expect(line).toContain('Published');
    expect(line).toContain('1 point and 12 works now visible');
  });
});

describe('an edit that replaced or removed the picture', () => {
  // Bamiyan's picture on the development catalogue, as the sync stored its credit.
  const PICTURE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Bamiyan%20Valley2.jpg';
  const credit = {
    author: 'Carl Montgomery',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Bamiyan_Valley2.jpg',
  };

  it('names the photographer whose credit went with the picture', () => {
    // The row `editExperience` writes when a curator empties the Image URL box and
    // saves (#696): the credit is recorded beside the picture, as an object — and the
    // line read `metadata.imageCredit: "[object Object]" → "(empty)"`, which leaves out
    // the one fact the credit rule exists to keep visible (ADR-0043).
    const line = formatLogDetails(entry('edited', {
      image_url: { old: PICTURE, new: null },
      'metadata.imageCredit': { old: credit, new: null },
    })) as string;

    expect(line).not.toContain('[object Object]');
    expect(line).toContain('metadata.imageCredit: "Carl Montgomery · CC BY 2.0" → "(empty)"');
  });

  it('reads on both sides of the arrow as the line under the picture does', () => {
    const line = formatLogDetails(entry('edited', {
      'metadata.imageCredit': {
        old: credit,
        new: { author: 'Stefan Kühn', license: 'CC BY-SA 3.0', licenseUrl: null, detailsUrl: null },
      },
    }));

    expect(line).toBe('metadata.imageCredit: "Carl Montgomery · CC BY 2.0" → "Stefan Kühn · CC BY-SA 3.0"');
  });

  it('calls a credit that names nobody empty, as it calls a value that is not there', () => {
    // A Commons file whose page names no author and no licence stores a credit of
    // four nulls; on screen that is the same absence as no credit at all.
    const line = formatLogDetails(entry('edited', {
      'metadata.imageCredit': {
        old: { author: null, license: null, licenseUrl: null, detailsUrl: null },
        new: credit,
      },
    }));

    expect(line).toBe('metadata.imageCredit: "(empty)" → "Carl Montgomery · CC BY 2.0"');
  });

  it('does not cut the licence off a long credit', () => {
    // Forty characters is where the other values are cut, and a Commons author
    // string is often longer than that on its own — Calakmul's photographer on the
    // development catalogue is forty-one — so the licence, which is the half that
    // binds, would be the part to go.
    const line = formatLogDetails(entry('edited', {
      'metadata.imageCredit': {
        old: { author: 'Pavel Kirillov from St.Petersburg, Russia', license: 'CC BY-SA 2.0', licenseUrl: null, detailsUrl: null },
        new: null,
      },
    })) as string;

    expect(line).toContain('Pavel Kirillov from St.Petersburg, Russia · CC BY-SA 2.0');
    expect(line).not.toContain('...');
  });
});

describe('a publication', () => {
  it('names the fields in the reader’s words, not the changeset’s', () => {
    // The card the curator read said "short description"; `shortDescription` is our word
    // for a column, and reads as a different subject.
    const line = formatLogDetails(entry('published', {
      scope: 'object',
      fields: ['shortDescription', 'imageUrl'],
      claimedFieldsSkipped: ['name'],
      fromSyncLogId: 64,
      locations: 0, treasureLinks: 0, treasures: 0, withdrawalsReleased: 0,
    })) as string;

    expect(line).toContain('Applied: short description, picture');
    expect(line).toContain('Kept as curated: name');
    expect(line).not.toContain('shortDescription');
  });

  it('says what a one-row publication left waiting', () => {
    // The difference between publishing a proposal and publishing one row of six
    // (#722), which the counts cannot carry: the audit row records it for this
    // reader, and without the line the two entries read the same.
    const line = formatLogDetails(entry('published', {
      scope: 'fields',
      fields: ['name'], claimedFieldsSkipped: [],
      fromSyncLogId: 68, heldLeftOpen: 5,
      locations: 0, treasureLinks: 0, treasures: 0, withdrawalsReleased: 0,
    })) as string;

    expect(line).toContain('Applied: name');
    expect(line).toContain('Left waiting: 5');
  });

  it('says nothing of the kind for a publication that answered the card', () => {
    const line = formatLogDetails(entry('published', {
      scope: 'object',
      fields: ['name'], claimedFieldsSkipped: [],
      fromSyncLogId: 68, heldLeftOpen: 0,
      locations: 0, treasureLinks: 0, treasures: 0, withdrawalsReleased: 0,
    })) as string;

    expect(line).not.toContain('Left waiting');
  });

  it('counts the works once, having been given the same works twice', () => {
    // The link says a work has been passed *here*, the work says it has been passed at
    // all. Added, they would double a museum's release.
    const line = formatLogDetails(entry('published', {
      scope: 'contents',
      fields: [], claimedFieldsSkipped: [],
      locations: 3, treasureLinks: 12, treasures: 12, withdrawalsReleased: 1,
    })) as string;

    expect(line).toContain('3 points and 12 works now visible');
    expect(line).toContain('1 replaced point no longer shown');
    expect(line).not.toContain('24');
  });
});

describe('an answer to what a source proposed', () => {
  it('separates what landed now from what lands at the next sync', () => {
    // Five fields are written on the spot and the rest are handed back for the next run,
    // so an entry that printed a value for those would claim something that has not
    // happened yet.
    const line = formatLogDetails(entry('accepted_source', {
      fields: [
        { field: 'name', applied: 'Getbol, Korean Tidal Flats (Phase II)' },
        { field: 'location', appliesAtNextSync: true },
      ],
      movedPoints: [13211],
    })) as string;

    expect(line).toContain('name: "Getbol, Korean Tidal Flats (Phase II)"');
    expect(line).toContain('coordinates: at the next sync');
    expect(line).toContain('1 point moved back to the source’s coordinate');
  });

  it('records the credit that went with the picture', () => {
    // Accepting a picture deletes the credit the curator's own edit wrote, and the card
    // said nothing about a photographer.
    expect(formatLogDetails(entry('accepted_source', {
      fields: [{ field: 'imageUrl', applied: 'https://upload.wikimedia.org/x.jpg' }],
      releasedCredit: true,
    }))).toContain('Picture credit dropped with it');
  });

  it('keeps the proposal a curator refused, which is what they stood against', () => {
    expect(formatLogDetails(entry('declined_source', {
      fields: [{ field: 'shortDescription', declined: 'A museum in Paris' }],
    }))).toBe('short description: source proposed "A museum in Paris"');
  });

  it('prints a refused false as false, not as an absent value', () => {
    // `metadata.inDanger` is a boolean and the ranking counters are numbers, so this is
    // an ordinary proposal in this catalogue, not a hypothetical. Under `value || …` the
    // row read "source proposed "(empty)"" — the opposite claim about the danger list.
    const line = formatLogDetails(entry('declined_source', {
      fields: [
        { field: 'metadata.inDanger', declined: false },
        { field: 'metadata.artworkCount', declined: 0 },
      ],
    })) as string;

    // The names are the facts' own (#570): where a value lives is what the card's
    // hint says, not a suffix on every mention of it.
    expect(line).toContain('in danger: source proposed "false"');
    expect(line).toContain('works placed: source proposed "0"');
    expect(line).not.toContain('(empty)');
  });

  it('still calls a value that is not there empty', () => {
    expect(formatLogDetails(entry('accepted_source', {
      fields: [{ field: 'shortDescription', applied: '' }],
    }))).toBe('short description: "(empty)"');
  });
});
