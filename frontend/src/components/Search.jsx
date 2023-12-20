import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { fetchSearchResults } from '../api';
import { useNavigation } from './NavigationContext';

function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const { setSelectedRegion } = useNavigation();

  useEffect(() => {
    let active = true;

    const fetchResults = async () => {
      if (searchTerm.length > 3) {
        try {
          const results = await fetchSearchResults(searchTerm);
          if (active) {
            setSearchResults(results);
          }
        } catch (error) {
          console.error('Error fetching search results:', error);
        }
      } else {
        setSearchResults([]);
      }
    };

    if (!searchTerm || searchTerm.length < 3) {
      setSearchResults([]);
      return () => {
        active = false;
      };
    }
    const timerId = setTimeout(fetchResults, 500);

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [searchTerm]);

  return (
    <Autocomplete
      id="search-autocomplete"
      options={searchResults.map((option) => option.name)}
      value={searchTerm}
      onChange={(event, newValue) => {
        const selectedRegion = searchResults.find((region) => region.name === newValue);
        setSelectedRegion(selectedRegion);
      }}
      inputValue={inputValue}
      onInputChange={(event, newInputValue) => {
        setInputValue(newInputValue);
        setSearchTerm(newInputValue);
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
