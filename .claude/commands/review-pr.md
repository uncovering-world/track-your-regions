# Review PR Comments (Quick)

Shortcut that runs the full PR review workflow: analyze, then ask what to do next.

## Arguments

$ARGUMENTS — optional: PR number. If not provided, auto-detect from current branch.

## Instructions

Run the `/pr-comments-analyze` workflow with the given arguments.

The full PR review workflow, in order:
1. `/pr-comments-analyze` — Analyze comments and create categorized action plan
2. _(user makes code changes)_
3. `/pr-changes-amend` — Fold fixes into original commits for clean history, then force-push
4. `/pr-comments-reply` — Post replies to each comment explaining what was done
5. A `/review` comment on the PR (`gh pr comment <number> --body '/review'`) — once the replies are posted and any fixes pushed, this is what brings the next round; a push alone does not, and a reply-only wave gets one too (`claude-review.yml`, #796). When and when not — a PR labelled `review-on-push` is reviewed by its push — is `/pr-create` § 8 "The next round"
