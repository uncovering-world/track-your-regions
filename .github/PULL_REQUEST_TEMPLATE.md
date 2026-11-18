## Description
Briefly describe the changes made and the issues they address.

## Related Issues
<Closes|Fixes|Part of|Relates to>: #<Issue Number>

## How Was This Tested?
Provide a brief explanation of the tests conducted to validate your changes.

## Checklist
Before submitting your PR, please review the following:
- [ ] Commit messages follow the standard template.
- [ ] All commits are signed.
- [ ] Related issues are mentioned in the description above.
- [ ] Linter checks have been passed.

## Model transition (only if the PR changes the catalogue model)
<!-- Temporary — transition regime, removed by #2646. What each part holds: docs/tech/model-transition.md § What every model pull request carries. Delete this section when the PR does not change the catalogue model. -->

### Area review
Each construct of the area shaped by the old model: DELETE, SIMPLIFY or KEEP with its reason, and its outcome in this PR.

### Owners touched
Each table and column of `db/target/owners.json` this PR writes or reads, its owner, and whether the code now matches it.

### Retires
The no-legacy ledger entries this PR moves from `pending` to `retired`.

### Removed and added lines
Lines removed and added under the area's paths, with the command that counted them.

### Compared on the catalogue
What was compared between the old and the new answers, the command, the result and the named places.

## Additional Comments (if any):
