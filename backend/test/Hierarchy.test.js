// backend/test/Hierarchy.test.js

// Import necessary modules and functions
const { getSiblings } = require('../models/Hierarchy');

// Test cases for getSiblings function
describe('getSiblings', () => {
  // Test case for when there are siblings
  test('should return an array of sibling hierarchies when there are siblings', () => {
    // Create a mock hierarchy
    const hierarchy = { id: 1, name: 'Hierarchy A' };

    // Mock the Hierarchy.findOne method to return the mock hierarchy
    Hierarchy.findOne = jest.fn().mockResolvedValue(hierarchy);

    // Call the getSiblings function
    const siblings = getSiblings(1);

    // Assert that the result is an array of sibling hierarchies
    expect(Array.isArray(siblings)).toBe(true);
    expect(siblings).toHaveLength(2);
    expect(siblings).toContainEqual({ id: 2, name: 'Hierarchy B' });
    expect(siblings).toContainEqual({ id: 3, name: 'Hierarchy C' });
  });

  // Test case for when there are no siblings
  test('should return an empty array when there are no siblings', () => {
    // Mock the Hierarchy.findOne method to return null
    Hierarchy.findOne = jest.fn().mockResolvedValue(null);

    // Call the getSiblings function
    const siblings = getSiblings(4);

    // Assert that the result is an empty array
    expect(Array.isArray(siblings)).toBe(true);
    expect(siblings).toHaveLength(0);
  });
});
