import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Search from './Search';

describe('Search component', () => {
  test('should display autocomplete dropdown', () => {
    render(<Search />);
    const autocompleteInput = screen.getByRole('textbox');
    fireEvent.change(autocompleteInput, { target: { value: 'search term' } });
    const autocompleteDropdown = screen.getByRole('listbox');
    expect(autocompleteDropdown).toBeInTheDocument();
  });

  test('should handle user input', () => {
    render(<Search />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'user input' } });
    expect(input.value).toBe('user input');
  });

  test('should select a search result', () => {
    render(<Search />);
    const autocompleteInput = screen.getByRole('textbox');
    fireEvent.change(autocompleteInput, { target: { value: 'search term' } });
    const searchResult = screen.getByText('Search Result');
    fireEvent.click(searchResult);
    expect(autocompleteInput.value).toBe('Selected Search Result');
  });
});
