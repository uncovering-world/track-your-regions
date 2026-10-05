/**
 * The membership a curator's card asks about, as an answer's body names it
 * (#1264, ADR-0084): present only where the card carries one, so an answer from
 * a card that names none is answered as before, by the membership the endpoint
 * picks.
 */
export function namedMembership(membershipId: number | null | undefined): { membershipId?: number } {
  return membershipId == null ? {} : { membershipId };
}
