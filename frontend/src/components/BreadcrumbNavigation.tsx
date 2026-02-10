import { Breadcrumbs, Link, Typography } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useNavigation } from '../hooks/useNavigation';
import type { AdministrativeDivision, Region } from '../types';

export function BreadcrumbNavigation() {
  const {
    divisionBreadcrumbs,
    regionBreadcrumbs,
    setSelectedDivision,
    setSelectedRegion,
    selectedWorldView,
    isCustomWorldView,
  } = useNavigation();

  // Use the appropriate breadcrumbs based on world view type
  const activeBreadcrumbs = isCustomWorldView ? regionBreadcrumbs : divisionBreadcrumbs;

  if (activeBreadcrumbs.length === 0) {
    return null;
  }

  const handleDivisionClick = (divisionIndex: number) => {
    if (divisionIndex === -1) {
      // Home clicked
      setSelectedDivision(null);
    } else {
      setSelectedDivision(divisionBreadcrumbs[divisionIndex]);
    }
  };

  const handleRegionClick = (regionIndex: number) => {
    if (regionIndex === -1) {
      // Home clicked
      setSelectedRegion(null);
    } else {
      setSelectedRegion(regionBreadcrumbs[regionIndex]);
    }
  };

  const handleClick = isCustomWorldView ? handleRegionClick : handleDivisionClick;

  return (
    <Breadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      sx={{ mb: 2, fontSize: '0.875rem' }}
      maxItems={4}
      itemsAfterCollapse={2}
      itemsBeforeCollapse={1}
    >
      <Link
        component="button"
        underline="hover"
        color="inherit"
        onClick={() => handleClick(-1)}
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <HomeIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
        {selectedWorldView?.name || 'Home'}
      </Link>

      {activeBreadcrumbs.slice(0, -1).map((item: AdministrativeDivision | Region, index: number) => (
        <Link
          key={item.id}
          component="button"
          underline="hover"
          color="inherit"
          onClick={() => handleClick(index)}
          sx={{ cursor: 'pointer' }}
        >
          {item.name}
        </Link>
      ))}

      {activeBreadcrumbs.length > 0 && (
        <Typography color="text.primary" sx={{ fontSize: '0.875rem' }}>
          {activeBreadcrumbs[activeBreadcrumbs.length - 1].name}
        </Typography>
      )}
    </Breadcrumbs>
  );
}
