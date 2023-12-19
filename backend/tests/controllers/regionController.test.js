const { searchRegions } = require('../../src/controllers/regionController');

describe('searchRegions', () => {
  // Test case 1: Test when the input query matches the region name exactly
  test('should return regions with exact name match', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'America',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(/* expected response */);
  });

  // Test case 2: Test when the input query matches the region name partially
  test('should return regions with partial name match', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'York',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(/* expected response */);
  });

  // Test case 3: Test when the input query matches the region path
  test('should return regions with path match', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'America > York',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(/* expected response */);
  });

  // Test case 4: Test when the input query matches both the region name and path
  test('should return regions with name and path match', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'America',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(/* expected response */);
  });

  // Test case 5: Test when the input query does not match any region
  test('should return no regions found', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'Invalid Query',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).toHaveBeenCalledWith({ message: 'No regions found' });
  });

  // Test case 6: Test when the input query is empty
  test('should return no regions found for empty query', async () => {
    // Mock the request object
    const req = {
      query: {
        query: '',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).toHaveBeenCalledWith({ message: 'No regions found' });
  });

  // Test case 7: Test when the hierarchyId is not provided
  test('should return regions with default hierarchyId', async () => {
    // Mock the request object
    const req = {
      query: {
        query: 'America',
      },
    };

    // Mock the response object
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Call the searchRegions function
    await searchRegions(req, res);

    // Assert the expected response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(/* expected response */);
  });
});
