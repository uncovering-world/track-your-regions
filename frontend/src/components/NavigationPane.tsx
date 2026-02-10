import { Box } from '@mui/material';
import { HierarchySwitcher } from './HierarchySwitcher';
import { Search } from './Search';
import { BreadcrumbNavigation } from './BreadcrumbNavigation';
import { RegionList } from './RegionList';

export function NavigationPane() {
  return (
    <Box>
      <HierarchySwitcher />
      <Search />
      <BreadcrumbNavigation />
      <RegionList />
    </Box>
  );
}
