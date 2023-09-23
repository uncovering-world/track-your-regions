#!/bin/bash

# Determine the context (pre-commit or GitHub Action)
context=$1

# Get the list of changed files based on the context
if [[ $context == "pre-commit" ]]; then
    changed_files=$(git diff --cached --name-only)
elif [[ $context == "github-action" ]]; then
    # Always in detached HEAD state in GitHub Actions
    current_commit=$(git rev-parse HEAD)
    parent_commit=$(git rev-parse "${current_commit}~1")
    changed_files=$(git diff --name-only "${parent_commit}" "${current_commit}")
else
    echo "Error: Unknown context '$context'"
    exit 1
fi

# Initialize a string variable to keep track of changed directories
changed_dirs=""

# Loop through the list of changed files to check which directories are affected
for file in $changed_files; do
    dir=$(dirname "$file")
    if [[ $dir == "." || ! $dir =~ ^(api|backend|frontend|deployment) ]]; then
        dir="root"
    else
        dir=$(echo "$dir" | cut -d'/' -f1)
    fi
    if [[ ! $changed_dirs =~ (^|[[:space:]])$dir($|[[:space:]]) ]]; then
        changed_dirs="$changed_dirs $dir"
    fi
done

# Calculate the total number of directories affected
total_changed=$(echo $changed_dirs | wc -w)

# If more than one directory is affected, prevent the commit
if [ $total_changed -gt 1 ]; then
    echo "Error: Commit affects files in multiple directories:$changed_dirs"
    echo "Please, commit files in one directory at a time. The repo most likely will be spit into multiple repos in the future."
    exit 1
fi

# Otherwise, allow the commit
exit 0