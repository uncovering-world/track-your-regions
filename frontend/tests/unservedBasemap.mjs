/**
 * The basemap the repository does not serve, kept out of every headless run
 * (#2351).
 *
 * The smoke lane and the Lighthouse lane load the product's maps in headless
 * Chrome, and the maps draw OpenStreetMap's standard tiles (`OSM_RASTER_SOURCE`,
 * `src/constants/mapStyles.ts`). The OSMF tile usage policy
 * (https://operations.osmfoundation.org/policies/tiles/) does not allow
 * headless bots that pan or zoom. So no lane asks those servers: Chrome is told
 * the hosts do not resolve, and a tile request fails on the machine with
 * `net::ERR_NAME_NOT_RESOLVED` before anything is sent. Everything else a page
 * loads is fetched as a reader fetches it, the regions' own vector tiles from
 * Martin among it; the map draws them over an empty background.
 */

/** The hosts no headless run asks: OpenStreetMap's public tile servers. */
export const UNSERVED_BASEMAP_HOSTS = ['tile.openstreetmap.org'];

/** The Chrome switch that keeps those hosts from resolving. */
const notFound = (host) => 'MAP ' + host + ' ~NOTFOUND';
export const NO_UNSERVED_BASEMAP_FLAG = `--host-resolver-rules=${UNSERVED_BASEMAP_HOSTS.map(notFound).join(', ')}`;

/** A run's Chrome flags with that switch, refusing a second set of resolver rules it would silently replace. */
export function withoutUnservedBasemap(flags) {
  if (flags.some((flag) => flag.startsWith('--host-resolver-rules='))) {
    throw new Error('These Chrome flags already set --host-resolver-rules; merge them with NO_UNSERVED_BASEMAP_FLAG instead');
  }
  return [...flags, NO_UNSERVED_BASEMAP_FLAG];
}
