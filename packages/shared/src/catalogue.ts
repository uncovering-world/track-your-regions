/**
 * How many objects a region hands over at once.
 *
 * Neither surface that reads a region is paginated — there is no "load more"
 * in the map sidebar and none in Discover — so a `limit` below the region's
 * size is not a page, it is silent truncation. The backend orders by `e.name`,
 * so the cut lands mid-alphabet: Europe at 200 ended after "G", which dropped
 * `Museo del Prado` and `Museumsinsel` along with 456 others, and the map builds
 * its markers from the same array, so their pins went too.
 *
 * The route's ceiling and what the client asks for are the same number so that
 * a region is always read whole: the largest today holds 661. It used to be a
 * `5000` on each side with a comment pointing at the other (#789).
 */
export const WHOLE_REGION_LIMIT = 5000;
