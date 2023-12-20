import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { fetchSearchResults, fetchRegion } from '../api';
import { useNavigation } from './NavigationContext';

function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [inputValue, setInputValue] = useState({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { selectedRegion, setSelectedRegion, selectedHierarchyId } = useNavigation();

  function formatNames(foundResults) {
    const nameCount = new Map();
    foundResults.forEach((item) => {
      nameCount.set(item.name, (nameCount.get(item.name) || 0) + 1);
    });

    return foundResults.map((item) => {
      if (nameCount.get(item.name) === 1) {
        return ({
          name: item.name,
          segment: null,
          id: item.id,
        }); // Unique name, return as is
      }
      // Find the smallest unique path segment
      const pathSegments = item.path.split(' > ');
      let uniqueSegment = pathSegments[pathSegments.length - 1];

      for (let i = pathSegments.length - 2; i >= 0; i -= 1) {
        const testPath = pathSegments.slice(i).join(' > ');
        const isUnique = foundResults.filter((r) => r.path.includes(testPath)).length === 1;
        if (isUnique) {
          uniqueSegment = pathSegments.slice(i).join(' > ');
          break;
        }
      }

      return ({
        name: item.name,
        segment: uniqueSegment,
        id: item.id,
      });
    });
  }

  useEffect(() => {
    let active = true;

    const fetchResults = async () => {
      if (searchTerm.length > 3) {
        try {
          const results = await fetchSearchResults(searchTerm);
          if (active) {
            setSearchResults(results);
            if (results.length > 0) {
              setIsDropdownOpen(true);
            }
          }
        } catch (error) {
          console.error('Error fetching search results:', error);
        }
      } else {
        setSearchResults([]);
        setIsDropdownOpen(false);
      }
    };

    if (selectedRegion) {
      if (!searchTerm || searchTerm.length < 3) {
        setSearchResults([]);
        setIsDropdownOpen(false);
        return () => {
          active = false;
        };
      }
    }
    const timerId = setTimeout(fetchResults, 500);

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [searchTerm, selectedRegion]);

  return (
    <Autocomplete
      id="search-autocomplete"
      options={searchResults.length > 0 ? formatNames(searchResults) : [inputValue]}
      getOptionLabel={(option) => {
        if (option && typeof option === 'object' && option.name) {
          return option.segment ? `${option.name} (${option.segment})` : option.name;
        }
        return option;
      }}
      freeSolo
      open={isDropdownOpen}
      onOpen={() => {
        if (searchResults.length > 0) {
          setIsDropdownOpen(true);
        }
      }}
      onClose={() => {
        setIsDropdownOpen(false);
      }}
      value={searchTerm}
      onChange={async (event, newValue) => {
        if (!newValue) {
          setSearchTerm('');
          return;
        }
        const selectedItem = searchResults.find((region) => region.id === newValue.id);
        const region = await fetchRegion(selectedItem.id, selectedHierarchyId);
        const newRegion = {
          id: region.id,
          name: region.name,
          info: region.info,
          hasSubregions: region.hasSubregions,
        };
        setSelectedRegion(newRegion);
        setIsDropdownOpen(false);
      }}
      inputValue={searchTerm}
      onInputChange={(event, newInputValue) => {
        if (newInputValue.length === 0) {
          console.log('newInputValue is empty');
          setIsDropdownOpen(false);
          return;
        }
        // find the region with the matching name
        const matchingRegion = searchResults.find((region) => region.name === newInputValue);
        setInputValue(matchingRegion);
        setSearchTerm(matchingRegion ? matchingRegion.name : newInputValue);
      }}
      renderInput={(params) => (
        <TextField
          label="Search Regions"
          variant="outlined"
          InputProps={{
            inputProps: {
              ...params.inputProps,
            },
            ...params.InputProps,
          }}
          ref={params.InputProps.ref}
          inputRef={params.inputRef}
          fullWidth
        />
      )}
    />
  );
}

export default Search;
