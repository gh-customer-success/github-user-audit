# GitHub User Audit 
<p align="center">
  <a href="https://github.com/actions/javascript-action/actions"><img alt="javscript-action status" src="https://github.com/actions/javascript-action/workflows/units-test/badge.svg"></a>
</p>

Uses the GitHub GraphQL API to run audits on users and their permissions to an organization's repositories. 

Generates a summary for all permissions and their count.

<img width="385" alt="image" src="https://user-images.githubusercontent.com/680463/231044211-0fe1f677-8317-4dcd-88b4-73610eae2bd3.png">

An artifact is uploaded as a CSV file. This format is supported by most spreadsheet applications, such as Microsoft [Excel](https://www.microsoft.com/en-us/microsoft-365/excel).

<img width="768" alt="image" src="https://user-images.githubusercontent.com/680463/231049038-20481116-de7a-42e7-8f77-517ac11a1709.png">

Alternatively CSV files can be persisted in a NoSQL DB.

## Features

✨ **Optimized for Large Organizations**
- Automatic rate limit handling with intelligent retry logic
- Efficient pagination to handle organizations with hundreds of repositories
- GraphQL query optimization to minimize API calls

🔒 **Enhanced Data Collection**
- Repository metadata: archived status, visibility (public/private/internal), archive date
- Collaborator affiliation filtering: ALL, DIRECT, or OUTSIDE collaborators
- Complete permission levels: ADMIN, MAINTAIN, WRITE, TRIAGE, READ
- Collaborator details: login, name, email

⚡ **Performance & Reliability**
- [@octokit/plugin-throttling](https://github.com/octokit/plugin-throttling.js) for automatic rate limit management
- [@octokit/plugin-retry](https://github.com/octokit/plugin-retry.js) for automatic retries on failures
- Real-time rate limit monitoring and logging
- Error handling for GraphQL API failures


## Personal Access Token (classic)

An Oganization Admin can [generate](https://github.com/settings/tokens) a token with the following permissions:

<img width="426" alt="image" src="https://user-images.githubusercontent.com/680463/231043291-ce54bfc5-9d47-49b5-80cc-b317602addc7.png">
<img width="628" alt="image" src="https://user-images.githubusercontent.com/680463/231043402-983d914b-d787-456c-891a-70f6f2106180.png">
<img width="472" alt="image" src="https://user-images.githubusercontent.com/680463/231043457-47c8d3cc-6a9c-4f4f-b919-704d815b5316.png">

 ```
 repo
 read:org 
 read:user
 user:email
 ```

## Using the Action

This Action requires inputs: a [variable](https://docs.github.com/en/actions/learn-github-actions/variables#creating-configuration-variables-for-a-repository) (Organization Name) and a secret (API Token). Optionally, you can specify the collaborator affiliation filter.

<img width="386" alt="image" src="https://user-images.githubusercontent.com/680463/231046061-b0aca50f-17cd-4550-831c-8ead2a09cd95.png">

Pass these values in your workflow file:

```yml

...
steps:
  -
    name: run audit
    uses: gh-customer-success/github-user-audit@main
    with:
      api_token: ${{ secrets.MY_SECRET_TOKEN }}
      owner: ${{ vars.MY_ORG_NAME }}
      affiliation: 'ALL'  # Optional: ALL (default), DIRECT, or OUTSIDE
    id: audit
 ...
 
```

### Input Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `owner` | Yes | - | The organization name |
| `api_token` | Yes | - | GitHub Personal Access Token with required scopes |
| `affiliation` | No | `ALL` | Collaborator filter: `ALL`, `DIRECT` (direct access only), or `OUTSIDE` (outside collaborators only) |

### Collaborator Affiliation Filter

- **`ALL`**: Returns all collaborators (organization members and outside collaborators)
- **`DIRECT`**: Returns only collaborators with direct repository access (not via team membership)
- **`OUTSIDE`**: Returns only outside collaborators (users who are not organization members)

This is useful for security audits to identify outside collaborators who have access to your repositories.

When the run is successful you should see a Job Summary with the total number of users for each `permission` and an artifact that can be downloaded by clicking on its name.

<img width="568" alt="image" src="https://user-images.githubusercontent.com/680463/231046930-7e09e29c-07c0-4d2b-9866-99ec82dfffc1.png">

## Rate Limiting

The action automatically handles GitHub API rate limits:

- **Primary Rate Limit**: Automatically retries up to 3 times when quota is exhausted
- **Secondary Rate Limit**: Automatically retries up to 2 times for abuse detection triggers
- **Real-time Monitoring**: Logs remaining quota and reset times for each API call
- **GraphQL Cost Tracking**: Monitors and logs the cost of each GraphQL query

For organizations with many repositories (100+), the action is optimized to:
1. Fetch repositories in batches of 50 (reduced from 100 to lower query cost)
2. Only make additional queries when collaborator pagination is needed (>100 collaborators per repo)
3. Use efficient GraphQL queries that minimize API calls

## Output Data

The CSV artifact includes:
- Repository name
- User login
- Permission level (ADMIN, MAINTAIN, WRITE, TRIAGE, READ)
- User name and email
- Repository metadata (archived status, visibility)

## Troubleshooting

### Rate Limit Exceeded
If you encounter rate limit issues:
1. Check the logs for rate limit information
2. The action will automatically retry with exponential backoff
3. Consider running during off-peak hours for very large organizations
4. Use the `affiliation` parameter to reduce the scope of the audit

### Missing Collaborators
Ensure your Personal Access Token has the correct scopes:
- `repo` - Full control of private repositories
- `read:org` - Read org and team membership
- `read:user` - Read all user profile data
- `user:email` - Access user email addresses





