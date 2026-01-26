import { Octokit } from 'octokit';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

// Extend Octokit with throttling and retry plugins
const OctokitWithPlugins = Octokit.plugin(throttling, retry);

// Function to retrieve all the repositories and their collaborators in an organization
export const getAllData = async (owner, token) => {
  // Create an Octokit client with throttling and retry plugins
  const octokit = new OctokitWithPlugins({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        // Retry up to 3 times
        if (retryCount < 3) {
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `SecondaryRateLimit detected for request ${options.method} ${options.url}`
        );

        // Retry up to 2 times for secondary rate limits
        if (retryCount < 2) {
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

  // Paginate through the repositories and their collaborators
  do {
    // Query the organization's repositories with pagination
    const repositoriesQuery = await octokit.graphql({
      query: `
        query ($owner: String!, $cursor: String) {
          rateLimit {
            limit
            cost
            remaining
            resetAt
          }
          organization(login: $owner) {
            repositories(first: 100 after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  name
                  collaborators(first: 100) {
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
    });

    // Log rate limit information
    const { rateLimit } = repositoriesQuery;
    console.log(
      `Rate limit: ${rateLimit.remaining}/${rateLimit.limit} (cost: ${rateLimit.cost}, resets at: ${rateLimit.resetAt})`
    );

    // Extract the repositories and their collaborators from the query result
    const { repositories: repoData } = repositoriesQuery.organization;

    // Map over the repositories and their collaborators to extract the relevant data
    const repositoriesWithCollaborators = await Promise.all(
      repoData.edges.map(async (edge) => {
        const { name, collaborators } = edge.node;
        const collabPermissions = [];

        // Recursively retrieve all the collaborators for a repository with pagination
        async function getCollaborators(cursor) {
          const collaboratorsQuery = await octokit.graphql({
            query: `
              query ($owner: String!, $repo: String!, $cursor: String) {
                rateLimit {
                  limit
                  cost
                  remaining
                  resetAt
                }
                repository(owner: $owner, name: $repo) {
                  collaborators(first: 100 after: $cursor) {
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
            cursor,
          });

          // Log rate limit information for nested queries
          const { rateLimit } = collaboratorsQuery;
          console.log(
            `Rate limit (collaborators for ${name}): ${rateLimit.remaining}/${rateLimit.limit} (cost: ${rateLimit.cost})`
          );

          const { collaborators: collabData } = collaboratorsQuery.repository;

          // Extract the collaborators and their permissions from the query result
          collabData.edges.forEach((collab) => {
            const { permission, node } = collab;
            collabPermissions.push({ login: node.login, permission });
          });

          // Recursively retrieve the next page of collaborators if there are more
          if (collabData.pageInfo.hasNextPage) {
            await getCollaborators(collabData.pageInfo.endCursor);
          }
        }

        // Extract the collaborators and their permissions from the query result
        collaborators.edges.forEach((collab) => {
          const { permission, node } = collab;
          collabPermissions.push({ login: node.login, permission });
        });

        // Recursively retrieve the next page of collaborators if there are more
        if (collaborators.pageInfo.hasNextPage) {
          await getCollaborators(collaborators.pageInfo.endCursor);
        }

        // Return an object with the repository name and its collaborators and permissions
        return { name, collaborators: collabPermissions };
      })
    );

    // Concatenate the repositories and their collaborators to the overall list
    repositories = repositories.concat(repositoriesWithCollaborators);

    // Update the cursor for the next page of repositories
    repositoriesCursor = repoData.pageInfo.endCursor;
  } while (repositoriesCursor !== null);

  // Return an object with the list of repositories and their collaborators and permissions
  return { repositories };
}

export default getAllData;
