import { getAllData } from '../src/get-repository-collaborators.js';
import { jest } from '@jest/globals';
import { Octokit } from 'octokit';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

// Mock the octokit module
jest.mock('octokit');

// Mock the plugins
jest.mock('@octokit/plugin-throttling');
jest.mock('@octokit/plugin-retry');

describe('getAllData', () => {
  let mockGraphql;
  let consoleLogSpy;
  let MockOctokitInstance;

  beforeEach(() => {
    // Spy on console.log to suppress output during tests
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Create mock graphql function
    mockGraphql = jest.fn();
    
    // Create mock Octokit instance
    MockOctokitInstance = {
      graphql: mockGraphql,
      log: {
        warn: jest.fn(),
        info: jest.fn(),
      },
    };

    // Mock Octokit.plugin to return a constructor that returns our mock instance
    Octokit.plugin = jest.fn(() => {
      return jest.fn(() => MockOctokitInstance);
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should fetch all repositories with collaborators and metadata', async () => {
    // Setup mock response
    mockGraphql
      .mockResolvedValueOnce({
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4999,
          resetAt: '2024-01-01T00:00:00Z',
        },
        organization: {
          repositories: {
            totalCount: 2,
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [
              {
                node: {
                  name: 'test-repo-1',
                  isArchived: false,
                  visibility: 'PRIVATE',
                  isPrivate: true,
                  archivedAt: null,
                  collaborators: {
                    totalCount: 2,
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null,
                    },
                    edges: [
                      {
                        permission: 'ADMIN',
                        node: {
                          login: 'user1',
                          name: 'User One',
                          email: 'user1@example.com',
                        },
                      },
                      {
                        permission: 'WRITE',
                        node: {
                          login: 'user2',
                          name: 'User Two',
                          email: 'user2@example.com',
                        },
                      },
                    ],
                  },
                },
              },
              {
                node: {
                  name: 'test-repo-2',
                  isArchived: true,
                  visibility: 'PUBLIC',
                  isPrivate: false,
                  archivedAt: '2023-12-01T00:00:00Z',
                  collaborators: {
                    totalCount: 1,
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null,
                    },
                    edges: [
                      {
                        permission: 'READ',
                        node: {
                          login: 'user3',
                          name: 'User Three',
                          email: 'user3@example.com',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      });

    const result = await getAllData('test-org', 'fake-token', 'ALL');

    expect(result.repositories).toHaveLength(2);
    
    // Check first repository
    expect(result.repositories[0].name).toBe('test-repo-1');
    expect(result.repositories[0].isArchived).toBe(false);
    expect(result.repositories[0].visibility).toBe('PRIVATE');
    expect(result.repositories[0].collaborators).toHaveLength(2);
    expect(result.repositories[0].collaborators[0].login).toBe('user1');
    expect(result.repositories[0].collaborators[0].permission).toBe('ADMIN');
    
    // Check second repository
    expect(result.repositories[1].name).toBe('test-repo-2');
    expect(result.repositories[1].isArchived).toBe(true);
    expect(result.repositories[1].visibility).toBe('PUBLIC');
    expect(result.repositories[1].collaborators).toHaveLength(1);

    // Verify graphql was called with correct parameters
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-org',
        affiliation: 'ALL',
      })
    );
  });

  it('should handle pagination for collaborators', async () => {
    // First call - repository query with hasNextPage true for collaborators
    mockGraphql
      .mockResolvedValueOnce({
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4999,
          resetAt: '2024-01-01T00:00:00Z',
        },
        organization: {
          repositories: {
            totalCount: 1,
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [
              {
                node: {
                  name: 'large-repo',
                  isArchived: false,
                  visibility: 'PRIVATE',
                  isPrivate: true,
                  archivedAt: null,
                  collaborators: {
                    totalCount: 150,
                    pageInfo: {
                      hasNextPage: true,
                      endCursor: 'cursor123',
                    },
                    edges: [
                      {
                        permission: 'ADMIN',
                        node: {
                          login: 'user1',
                          name: 'User One',
                          email: 'user1@example.com',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      })
      // Second call - additional collaborators
      .mockResolvedValueOnce({
        rateLimit: {
          limit: 5000,
          cost: 1,
          remaining: 4998,
          resetAt: '2024-01-01T00:00:00Z',
        },
        repository: {
          collaborators: {
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [
              {
                permission: 'WRITE',
                node: {
                  login: 'user2',
                  name: 'User Two',
                  email: 'user2@example.com',
                },
              },
            ],
          },
        },
      });

    const result = await getAllData('test-org', 'fake-token', 'DIRECT');

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].collaborators).toHaveLength(2);
    expect(mockGraphql).toHaveBeenCalledTimes(2);
  });

  it('should use OUTSIDE affiliation when specified', async () => {
    mockGraphql.mockResolvedValueOnce({
      rateLimit: {
        limit: 5000,
        cost: 1,
        remaining: 4999,
        resetAt: '2024-01-01T00:00:00Z',
      },
      organization: {
        repositories: {
          totalCount: 0,
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
          edges: [],
        },
      },
    });

    await getAllData('test-org', 'fake-token', 'OUTSIDE');

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliation: 'OUTSIDE',
      })
    );
  });

  it('should handle errors gracefully', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('API Error'));

    await expect(getAllData('test-org', 'fake-token', 'ALL')).rejects.toThrow('API Error');
  });
});
