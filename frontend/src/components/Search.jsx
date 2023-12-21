import React, { useState, useEffect, useRef } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { fetchSearchResults, fetchRegion } from '../api';
import { useNavigation } from './NavigationContext';

function Search() {
  const [searchTerm, setSearchTerm] = useState({ name: '', force: false });
  const [searchResults, setSearchResults] = useState([]);
  const [inputValue, setInputValue] = useState({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { selectedRegion, setSelectedRegion, selectedHierarchyId } = useNavigation();
  const prevSelectedRegion = useRef();

  // Returns an object of the form:
  // { name: 'Region Name', segment: 'Region Segment (if name is not unique)', id: 'Region ID' }
  function formatNames(foundResults) {
    // Group paths by the last element (which is the same as region.name)
    const pathsByLastName = {};
    foundResults.forEach((region) => {
      if (!pathsByLastName[region.name]) {
        pathsByLastName[region.name] = [];
      }
      pathsByLastName[region.name].push(region.path);
    });

    // Find the common prefix of each group of paths
    function findCommonPrefixByTokens(paths) {
      const tokens = paths.map((path) => path.split(' > '));
      const minLength = Math.min(...tokens.map((token) => token.length));
      let prefix = '';
      for (let i = 0; i < minLength; i += 1) {
        const token = tokens[0][i];
        if (tokens.every((t) => t[i] === token)) {
          prefix += `${token} > `;
        } else {
          break;
        }
      }
      return prefix;
    }

    // Process each group to find the shortest unique suffix
    return foundResults.map((region) => {
      const paths = pathsByLastName[region.name];
      if (paths.length === 1) {
        // Only one path with this name, no need to shorten
        return { name: region.name, segment: null, id: region.id };
      }
      // Find the shortest unique suffix for this path
      const prefix = findCommonPrefixByTokens(paths);
      // Replace " >" with ","
      return {
        name: region.name,
        segment: region.path.slice(prefix.length).replace(/ > /g, ', ').trim(','),
        id: region.id,
      };
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
      filterOptions={(x) => x}
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
        setInputValue(newInputValue);
        setSearchTerm({
          name: newInputValue,
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
