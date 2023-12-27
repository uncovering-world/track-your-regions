// backend/test/regionController.test.js

// Import necessary modules and functions
const { getSiblings } = require('../controllers/regionController');
const { Region } = require('../models/Region');

// Test cases for getSiblings function
describe('getSiblings', () => {
  // Test case for when the region exists
  test('should return an array of sibling regions when the region exists', () => {
    // Create a mock region
    const region = new Region({ name: 'Region A' });

    // Mock the Region.findOne method to return the mock region
    Region.findOne = jest.fn().mockResolvedValue(region);

    // Call the getSiblings function
    const siblings = getSiblings('Region A');

    // Assert that the result is an array of sibling regions
    expect(Array.isArray(siblings)).toBe(true);
    expect(siblings).toHaveLength(2);
    expect(siblings).toContainEqual({ name: 'Region B' });
    expect(siblings).toContainEqual({ name: 'Region C' });
  });

  // Test case for when the region does not exist
  test('should return an empty array when the region does not exist', () => {
    // Mock the Region.findOne method to return null
    Region.findOne = jest.fn().mockResolvedValue(null);

    // Call the getSiblings function
    const siblings = getSiblings('Region D');

    // Assert that the result is an empty array
    expect(Array.isArray(siblings)).toBe(true);
    expect(siblings).toHaveLength(0);
  });
});
