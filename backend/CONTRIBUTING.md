## Contributing to Region Tracker Backend

### Directory Structure
- Ensure that the "sweep.yaml" file is located in the backend directory.
Make changes only in the `backend` directory. Adhere to the structure outlined in the backend [README](./README.md).

### Coding Style
Follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript). 

To run the linter checks run
```shell
npm run lint
```

To fix what can be fixed automatically run
```shell
`npm run lint:fix`
```

### Testing

Unfortunately, we don't have any automated tests yet. Hence, we can't enforce any testing requirements.

Nevertheless, it's highly recommended to run a full DB + backend + frontend setup for running some manual tests.

To run the full setup, follow the instructions in the deployment [README](../deployment/README.md).

To be short, you need to:
1. Install Docker and Docker Compose.
2. Setup .env file
3. Run the following command to start all services and initialize the database:
```shell
make start-all
```
For the details look in the deployment [README](../deployment/README.md). 

### Pre-commit Checks
Set up the `check-dir` pre-commit hook as per the repository root instructions to ensure compliance with our directory structure.

```shell
git config core.hooksPath .git-hooks
```

### Commit Message Template:
Use the following format for commit messages:
  ```
  back: <Topic>.

  <Description>

  [Issue: #<GitHub Issue Number>]

  Signed-off-by: <Your Name> <Your Email>
  ```
- Ensure the commit message is concise yet descriptive.
- If the commit fixes an issue, add the issue number in the commit message.
- Sign your commits to verify your identity (use `git commit -s`).

### Pull Requests (PRs)

#### General PR Workflow

1. Fork the repo, create your feature branch from `main`. Branch name should be in the form `feature/<Feature Name>` for new features and `fix/<Issue Number>` for bug fixes.
2. Ensure code passes linting, has adequate test coverage, and adheres to our structure and style guide.
3. Create a PR to merge your feature branch into `main` of the original repo.
4. In the PR description, provide a clear explanation of your changes and the motivation behind them.
5. In the PR description, provide the Issue number that your PR fixes in a form `Fixes #<Issue Number>`.
   This will trigger bots to check that the PRs changes address all the requirements of the issue.
6. PRs are reviewed with the help of AI bots @coderabbitai and @CodiumAI-Agent. Pay attention to their comments. If you disagree, provide a clear explanation in the comments.
7. Resolve all discussion threads and ensure mandatory checks pass before merging.

#### Handling Stalled PRs
   - If a PR is inactive for more than 7 days, a 'stale' label will be added to it and a reminder will be posted in the PR.
   - If a PR is inactive for more than 14 days, it will be closed.

### Additional Resources:
   - [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
   - [Git Pre-commit Hook Documentation](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)

