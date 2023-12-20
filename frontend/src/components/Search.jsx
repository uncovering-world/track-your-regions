import React, { useState, useEffect } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import { useNavigation } from './NavigationContext';
import { fetchSearchResults } from '../api';

function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { setSelectedRegion } = useNavigation();

  const handleChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleSelectChange = (event) => {
    console.log(event);
    setSelectedItem(event.target.value);
    setSelectedRegion(
      {
        id: event.target.value.id,
        name: event.target.value.name,
        info: {},
        hasSubregions: false,
      },
    );
  };

  const handleSearch = () => {
    setIsSearching(true);
  };

  useEffect(() => {
    const timerId = setTimeout(async () => {
      try {
        if (searchTerm.length > 3 || isSearching) {
          const results = await fetchSearchResults(searchTerm);
          if (results.length === 1) {
            setSelectedItem(results[0].path);
          }
          setSearchResults(results);
          if (results.length > 0) {
            setIsDropdownOpen(true); // Open dropdown if there are results
          }
        } else {
          setSearchResults([]);
          setIsDropdownOpen(false); // Close dropdown if there are no results
        }
      } catch (fetchError) {
        console.error('Error fetching search results: ', fetchError);
      }
      setIsSearching(false);
    }, 500);

    return () => clearTimeout(timerId);
  }, [searchTerm, isSearching]);

  return (
    <div>
      <input
        type="text"
        placeholder="Search"
        value={searchTerm}
        onChange={handleChange}
      />
      <button type="submit" onClick={handleSearch}>Search</button>
      <FormControl fullWidth>
        <InputLabel id="search-results-label">Results</InputLabel>
        <Select
          labelId="search-results-label"
          id="search-results"
          value={selectedItem}
          label="Results"
          onChange={handleSelectChange}
          open={isDropdownOpen} // Control the open state of the dropdown
        >
          {searchResults.map((item) => (
            <MenuItem key={item.id} value={item.path}>
              {item.path}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </div>
  );
}

export default Search;
