## Contributing to Region Tracker Deployment

### Directory Structure
Make changes only in the `deployment` directory. Adhere to the structure outlined in the deployment [README](./README.md).

### Python Code Style
For Python scripts, such as DB initialization and validation scripts, we use Black for code formatting.

Follow these steps to install and use Black:

#### Installation:

Black can be installed via pip. Run the following command:
```shell
pip install black
```

#### Running Black

To format your Python code, navigate to the script's directory and run:

```shell
black .
```

This will automatically format your Python files according to Black's style.

Ensure your code passes Black's formatting checks as this is verified during PR creation.

### Docker and Makefile
- Ensure any changes to Dockerfiles or `docker-compose.yml` maintain the integrity and efficiency of the container setup.
- When modifying the Makefile, ensure all commands are correctly linked and functional.

### Testing

Unfortunately, we don't have any automated tests yet. Hence, we can't enforce any testing requirements.

Nevertheless, it's highly recommended to run a full DB + backend + frontend setup for running some manual tests.

At least, please run the code you have introduced or changed :)

The [README](./README.md) file contains some info about how to run the init scripts quickly. 

### Pre-commit Checks
Set up the `check-dir` pre-commit hook as per the repository root instructions to ensure compliance with our deployment directory structure.

```shell
git config core.hooksPath .git-hooks
```

### Commit Message Template:

Use the following format for commit messages:
  ```
  deploy: <Topic>.

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

### Tips:
- We are not against using AI tools like GitHub Copilot or ChatGPT to generate commit messages or PR descriptions. Just make sure that the generated text is correct and relevant.

### Additional Resources:
- [Black Python Code Formatter](https://black.readthedocs.io/en/stable/)
- [Docker Documentation](https://docs.docker.com/)
- [Makefile Documentation](https://www.gnu.org/software/make/manual/make.html)
- [Git Pre-commit Hook Documentation](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)
