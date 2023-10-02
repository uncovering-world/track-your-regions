#!/bin/bash

# Determine the context (pre-commit or GitHub Action)
context=$1

BASE_SHA=$2

# Function to perform directory checks
check_directories() {
  local changed_files=$1
  local changed_dirs=""

  for file in $changed_files; do
    echo "Checking file: $file"
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

  total_changed=$(echo $changed_dirs | wc -w)

  if [ $total_changed -gt 1 ]; then
    echo "Error: Commit affects files in multiple directories:$changed_dirs"
    echo "Please, commit files in one directory at a time. The repo most likely will be spit into multiple repos in the future."
    exit 1
  fi
}

# Get the list of changed files based on the context
if [[ $context == "pre-commit" ]]; then
  changed_files=$(git diff --cached --name-only)
  check_directories "$changed_files"
elif [[ $context == "github-action" ]]; then
  if [[ -z "${BASE_SHA}" ]]; then
    echo "Error: BASE_SHA is not set"
    exit 1
  fi

  commits=$(git rev-list --ancestry-path $BASE_SHA..HEAD)

  for commit in $commits; do
    echo "Checking commit: $commit"
    changed_files=$(git diff-tree --no-commit-id --name-only -r $commit)
    check_directories "$changed_files"
  done
else
  echo "Error: Unknown context '$context'"
  exit 1
fi

# Otherwise, allow the commit
exit 0
