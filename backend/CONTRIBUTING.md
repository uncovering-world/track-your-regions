# Contributing to Region Tracker Backend

## Introduction
Thank you for your interest in contributing to the Region Tracker backend.
This document outlines the process and guidelines for contributing.

## Directory Structure
All changes should be made to the `backend` directory.
Please follow the directory structure as explained in the
backend [README](./README.md) file.

## Pre-commit Checks
To ensure your code follows our directory structure, we use a pre-commit hook to
check your changes before they are committed.
Ensure you have the `check-dir` hook set up to verify the directory structure
before committing your changes. This check is also performed during the pull
request (PR) process.

### Setting up the Pre-commit Hook
To set up the pre-commit hook, follow these steps:
1. Navigate to the repository root directory.
2. Run the following command to set the custom hooks directory:
   ```bash
   git config core.hooksPath .git-hooks
   ```
## Style Guide
We adhere to the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) for coding standards. Please ensure your code follows these guidelines.

### Linting
Before submitting your code, run the following commands to identify and fix linting issues:
- `npm run linter` to identify issues.
- `npm run linter:fix` to automatically fix many common issues.

## Creating a Pull Request (PR)
1. Fork the repository and create your feature branch from `main`.
2. Make sure your code lints and follows our directory structure and style guide.
3. Issue a pull request with a clear list of what you've done. Make sure to reference the issue number if applicable.
4. Your PR will be reviewed by the maintainers who may provide feedback or request changes. Please be responsive to their comments.

## Additional Resources
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- [Git Pre-commit Hook Documentation](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)
