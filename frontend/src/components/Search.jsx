import React, { useState, useEffect, useRef } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { fetchSearchResults, fetchRegion } from '../api';
import { useNavigation } from './NavigationContext';

/**
 * Component for searching and selecting regions.
 * This component provides a search bar with autocomplete for selecting regions based on user input.
 */
function Search() {
  const [searchTerm, setSearchTerm] = useState({ name: '', force: false });
  const [searchResults, setSearchResults] = useState([]);
  const [inputValue, setInputValue] = useState({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { selectedRegion, setSelectedRegion, selectedHierarchyId } = useNavigation();
  const prevSelectedRegion = useRef();

  /**
 * Format names within found results based on uniqueness.
 * @param {Array.<object>} foundResults - The list of found results to format
 * @returns {Array.<object>} - The formatted list of results
 */
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
      if (searchTerm.name.length > 3 || searchTerm.force) {
        try {
          const results = await fetchSearchResults(searchTerm.name);
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

    if (prevSelectedRegion.current !== selectedRegion) {
      prevSelectedRegion.current = selectedRegion;
      return () => {
        active = false;
      };
    }

    if (selectedRegion && selectedRegion.name === searchTerm.name) {
      return () => {
        active = false;
      };
    }
    if (selectedRegion) {
      if (!searchTerm.name || (searchTerm.name.length < 3 && !searchTerm.force)) {
        setSearchResults([]);
        setIsDropdownOpen(false);
        return () => {
          active = false;
        };
      }
    }

    if (searchTerm.force) {
      fetchResults();
      return () => {
        active = false;
      };
    }

    const timerId = setTimeout(fetchResults, 500);

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [searchTerm, selectedRegion]);

  // Handle Enter key press
  const handleKeyPress = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      setSearchTerm({ name: searchTerm.name, force: true });
    }
  };

  return (
    <Autocomplete
      id="search-autocomplete"
      options={searchResults.length > 0 ? formatNames(searchResults) : [inputValue]}
      getOptionLabel={(option) => {
        if (option && typeof option === 'object' && option.name) {
          return option.segment ? `${option.name} (${option.segment})` : option.name;
        }
        if (option && typeof option === 'string') {
          return option;
        }
        return '';
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
      value={searchTerm.name}
      onChange={async (event, newValue) => {
        if (!newValue) {
          setSearchTerm({ name: '', force: false });
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
      inputValue={searchTerm.name}
      onInputChange={(event, newInputValue) => {
        if (newInputValue.length === 0) {
          setIsDropdownOpen(false);
          return;
        }
        // find the region with the matching name
        const matchingRegion = searchResults.find((region) => region.name === newInputValue);
        setInputValue(matchingRegion);
        setSearchTerm({
          name: matchingRegion ? matchingRegion.name : newInputValue,
          force: false,
        });
      }}
      onKeyPress={handleKeyPress}
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
