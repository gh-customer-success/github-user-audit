import { Octokit } from 'octokit';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

// Extend Octokit with throttling and retry plugins
const OctokitWithPlugins = Octokit.plugin(throttling, retry);

// Configuration constants
const RATE_LIMIT_RETRY_COUNT = 3;  // Retry up to 3 times on primary rate limit
const SECONDARY_RATE_LIMIT_RETRY_COUNT = 2;  // Retry up to 2 times on secondary rate limit
const REPOSITORIES_PER_PAGE = 50;  // Fetch 50 repos per request (reduced from 100 to lower GraphQL cost)
const COLLABORATORS_PER_PAGE = 100;  // Max allowed by GitHub API

/**
 * Retrieve all repositories and their collaborators in an organization
 * Optimized for large organizations with efficient pagination and rate limit handling
 * 
 * @param {string} owner - Organization login name
 * @param {string} token - GitHub Personal Access Token with repo and read:org scopes
 * @param {string} affiliation - Collaborator affiliation filter: ALL, DIRECT, or OUTSIDE
 * @returns {Promise<{repositories: Array}>} Array of repositories with collaborators
 */
export const getAllData = async (owner, token, affiliation = 'ALL') => {
  // Create an Octokit client with throttling and retry plugins
  const octokit = new OctokitWithPlugins({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        // Retry up to RATE_LIMIT_RETRY_COUNT times
        if (retryCount < RATE_LIMIT_RETRY_COUNT) {
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `SecondaryRateLimit detected for request ${options.method} ${options.url}`
        );

        // Retry up to SECONDARY_RATE_LIMIT_RETRY_COUNT times for secondary rate limits
        if (retryCount < SECONDARY_RATE_LIMIT_RETRY_COUNT) {
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
      },
    },
    retry: {
      doNotRetry: ['429'], // Let throttling plugin handle rate limits
    },
  });

  let repositories = [];
  let repositoriesCursor = null;
  let totalReposProcessed = 0;

  console.log(`Starting audit for organization: ${owner}`);
  console.log(`Collaborator affiliation filter: ${affiliation}`);

  // Paginate through the repositories
  do {
    try {
      // Query the organization's repositories with enhanced fields
      const repositoriesQuery = await octokit.graphql({
        query: `
          query ($owner: String!, $cursor: String, $affiliation: CollaboratorAffiliation) {
            rateLimit {
              limit
              cost
              remaining
              resetAt
            }
            organization(login: $owner) {
              repositories(first: ${REPOSITORIES_PER_PAGE}, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                totalCount
                edges {
                  node {
                    name
                    isArchived
                    visibility
                    isPrivate
                    archivedAt
                    collaborators(first: ${COLLABORATORS_PER_PAGE}, affiliation: $affiliation) {
                      totalCount
                      pageInfo {
                        hasNextPage
                        endCursor
                      }
                      edges {
                        permission
                        node {
                          login
                          name
                          email
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        owner,
        cursor: repositoriesCursor,
        affiliation,
      });

      // Log rate limit information
      const { rateLimit } = repositoriesQuery;
      console.log(
        `Rate limit: ${rateLimit.remaining}/${rateLimit.limit} (cost: ${rateLimit.cost}, resets at: ${rateLimit.resetAt})`
      );

      // Extract the repositories and their collaborators from the query result
      const { repositories: repoData } = repositoriesQuery.organization;

      // Process each repository and handle collaborator pagination if needed
      for (const edge of repoData.edges) {
        const { name, collaborators, isArchived, visibility, isPrivate, archivedAt } = edge.node;
        const collabPermissions = [];

        // Extract collaborators from the first page
        collaborators.edges.forEach((collab) => {
          const { permission, node } = collab;
          collabPermissions.push({ 
            login: node.login, 
            permission,
            name: node.name,
            email: node.email
          });
        });

        // Handle pagination for repositories with more than 100 collaborators
        let hasMoreCollaborators = collaborators.pageInfo.hasNextPage;
        let collaboratorsCursor = collaborators.pageInfo.endCursor;
        
        while (hasMoreCollaborators && collaboratorsCursor) {
          const additionalCollabsQuery = await octokit.graphql({
            query: `
              query ($owner: String!, $repo: String!, $cursor: String, $affiliation: CollaboratorAffiliation) {
                rateLimit {
                  limit
                  cost
                  remaining
                  resetAt
                }
                repository(owner: $owner, name: $repo) {
                  collaborators(first: ${COLLABORATORS_PER_PAGE}, after: $cursor, affiliation: $affiliation) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    edges {
                      permission
                      node {
                        login
                        name
                        email
                      }
                    }
                  }
                }
              }
            `,
            owner,
            repo: name,
            cursor: collaboratorsCursor,
            affiliation,
          });

          // Log rate limit for additional collaborator queries
          const { rateLimit: collabRateLimit } = additionalCollabsQuery;
          console.log(
            `Rate limit (additional collaborators for ${name}): ${collabRateLimit.remaining}/${collabRateLimit.limit} (cost: ${collabRateLimit.cost})`
          );

          const { collaborators: additionalCollabs } = additionalCollabsQuery.repository;

          // Extract additional collaborators
          additionalCollabs.edges.forEach((collab) => {
            const { permission, node } = collab;
            collabPermissions.push({ 
              login: node.login, 
              permission,
              name: node.name,
              email: node.email
            });
          });

          // Update pagination state
          hasMoreCollaborators = additionalCollabs.pageInfo.hasNextPage;
          collaboratorsCursor = additionalCollabs.pageInfo.endCursor;
        }

        totalReposProcessed++;
        console.log(
          `Processed repository ${totalReposProcessed}/${repoData.totalCount}: ${name} (${collabPermissions.length} collaborators, archived: ${isArchived}, visibility: ${visibility})`
        );

        // Add repository with all metadata
        repositories.push({ 
          name, 
          collaborators: collabPermissions,
          isArchived,
          visibility,
          isPrivate,
          archivedAt,
          collaboratorCount: collabPermissions.length
        });
      }

      // Update the cursor for the next page of repositories
      repositoriesCursor = repoData.pageInfo.hasNextPage ? repoData.pageInfo.endCursor : null;

    } catch (error) {
      console.error(`Error fetching repositories: ${error.message}`);
      if (error.response) {
        console.error('GraphQL Errors:', JSON.stringify(error.response.errors, null, 2));
      }
      throw error;
    }
  } while (repositoriesCursor !== null);

  console.log(`\nAudit complete! Processed ${totalReposProcessed} repositories with ${repositories.reduce((sum, r) => sum + r.collaborators.length, 0)} total collaborator entries.`);

  // Return an object with the list of repositories and their collaborators and permissions
  return { repositories };
}

export default getAllData;
