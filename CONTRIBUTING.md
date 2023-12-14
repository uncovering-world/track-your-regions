# Contributing to Region Tracker

Thank you for your interest in contributing to the Region Tracker project! This document provides guidelines for
contributing to different parts of the project. Please adhere to the specific guidelines provided in each directory's
CONTRIBUTING file.

## Directory-Specific Guidelines

For detailed instructions specific to each part of the project, refer to the CONTRIBUTING files in the respective directories:

- [Backend CONTRIBUTING.md](./backend/CONTRIBUTING.md)
- [Frontend CONTRIBUTING.md](./frontend/CONTRIBUTING.md)
- [Deployment CONTRIBUTING.md](./deployment/CONTRIBUTING.md)

## Directory Structure

The project is divided into three main directories as mentioned in the [README](./README.md) file:
- Frontend: `./frontend`
- Backend: `./backend`
- Deployment: `./deployment`

Make changes only in the directory you are working on. Adhere to the structure outlined in the respective README files.

### Coding Style
- For JavaScript (used in frontend and backend), follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript).
- For Python (used in deployment scripts), use [Black](https://black.readthedocs.io/en/stable/) for code formatting.

### Testing
Unfortunately, we don't have any automated tests yet. Hence, we can't enforce any testing requirements.

Nevertheless, it's highly recommended to run a full DB + backend + frontend setup for running some manual tests.

To run the full setup, follow the instructions in the deployment [README](./deployment/README.md).

To be short, you need to:
1. Install Docker and Docker Compose.
2. Setup .env file
3. Run the following command to start all services and initialize the database:
```shell
make start-all
```
For the details look in the deployment [README](./deployment/README.md).

At least, please run the code you have introduced or changed :)

### Pre-commit Checks
Use `check-dir` pre-commit hooks to maintain consistency across different directories.

Set up the pre-commit hook with:
```shell
git config core.hooksPath .git-hooks
```

### Commit Message Template
Follow this format for all commit messages:
```
<Type>: <Topic>.

<Description>

Each commit message should include the related issue number in the form: [Issue: #<GitHub Issue Number>]

Signed-off-by: <Your Name> <Your Email>
```

- Type can be one of the following:
  - `front`: Frontend
  - `back`: Backend
  - `deploy`: Deployment 
  Or leave it blank if the commit is not specific to any of the above.
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

### Tips
- We are not against using AI tools like GitHub Copilot or ChatGPT to generate commit messages or PR descriptions. Just make sure that the generated text is correct and relevant.
