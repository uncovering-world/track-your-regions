/**
 * How a World Heritage run's components resolved to their Wikidata items
 * (#1269), in the run's details: how many resolved, the references more than
 * one item carries (left without one, since picking would be guessing), and the
 * sites with components left without an item — Frontiers of the Roman Empire –
 * Dacia's 277 components carry no item on Wikidata at all.
 */

import { Box, Link, Typography } from '@mui/material';
import type { SyncLogDetail } from '../../api/admin';
import { plural } from '../../utils/plural';

type ComponentItems = NonNullable<SyncLogDetail['component_items']>;

const itemLink = (item: string) => (
  <Link key={item} href={`https://www.wikidata.org/wiki/${item}`} target="_blank" rel="noopener noreferrer" sx={{ mr: 0.75 }}>
    {item}
  </Link>
);

export function ComponentItemsSummary({ items }: { items: ComponentItems }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" color="text.secondary">Components and their Wikidata items</Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {items.resolved.toLocaleString()} of {items.total.toLocaleString()} {items.total === 1 ? 'component' : 'components'}
        {' '}resolved to an item of their own.
      </Typography>
      {items.failedSites > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mb: 1 }}>
          {plural(items.failedSites, 'site')} could not be recorded this run; their points keep what they held.
        </Typography>
      )}
      {items.ambiguous.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="body2">
            {plural(items.ambiguous.length, 'reference')} more than one item carries, left without one:
          </Typography>
          {items.ambiguous.map(one => (
            <Typography key={`${one.site}-${one.ref}`} variant="body2" color="text.secondary" sx={{ pl: 2 }}>
              {one.ref}: {one.items.map(itemLink)}
            </Typography>
          ))}
        </Box>
      )}
      {items.unresolvedSites.length > 0 && (
        <Box>
          <Typography variant="body2">Sites with components left without an item:</Typography>
          {items.unresolvedSites.map(site => (
            <Typography key={site.site} variant="body2" color="text.secondary" sx={{ pl: 2 }}>
              {site.name}: {site.resolved} of {site.total}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
