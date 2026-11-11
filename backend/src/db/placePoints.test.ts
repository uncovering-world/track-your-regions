/**
 * What a part's point is called, for a reader and as the catalogue holds the
 * part (#2283). A part names itself by a kind of its own; a reader counts only
 * a kind a reader is shown, so a membership waiting for a curator renames
 * nothing a reader reads (ADR-0025 decision 5), while an edit of the point and
 * a run's record of it go by every membership the part holds.
 */

import { describe, expect, it } from 'vitest';
import { placeHoldsKindSql, placeOfferedSql } from './membership.js';
import { pointClaimsAsHeldSql, pointClaimsSql, pointNameAsHeldSql, pointNameSql } from './placePoints.js';

describe("a part's point, for a reader and as held", () => {
  it("names the point by the part's kind a reader is shown", () => {
    expect(pointNameSql('el')).toContain(placeOfferedSql('prt_name'));
    expect(pointNameSql('el')).not.toContain(placeHoldsKindSql('prt_name.id'));
    expect(pointClaimsSql('el')).toContain(placeOfferedSql('prt_own'));
    expect(pointClaimsSql('el')).not.toContain(placeHoldsKindSql('prt_own.id'));
  });

  it('names it by any kind the part holds, read or not, where the catalogue is written', () => {
    expect(pointNameAsHeldSql('el')).toContain(placeHoldsKindSql('prt_name.id'));
    expect(pointNameAsHeldSql('el')).not.toContain(placeOfferedSql('prt_name'));
    expect(pointClaimsAsHeldSql('el')).toContain(placeHoldsKindSql('prt_own.id'));
  });

  it('differs only in that test', () => {
    expect(pointNameSql('el').replace(placeOfferedSql('prt_name'), 'K'))
      .toBe(pointNameAsHeldSql('el').replace(placeHoldsKindSql('prt_name.id'), 'K'));
    expect(pointClaimsSql('el').replace(placeOfferedSql('prt_own'), 'K'))
      .toBe(pointClaimsAsHeldSql('el').replace(placeHoldsKindSql('prt_own.id'), 'K'));
  });
});
