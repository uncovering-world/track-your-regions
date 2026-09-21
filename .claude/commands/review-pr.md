# Review PR Comments (Quick)

Shortcut that runs the full PR review workflow: analyze, then ask what to do next.

## Arguments

$ARGUMENTS — optional: PR number. If not provided, auto-detect from current branch.

## Instructions

Run the `/pr-comments-analyze` workflow with the given arguments.

The full PR review workflow, in order:
1. `/pr-comments-analyze` — Analyze comments and create categorized action plan
2. Sort every verified finding into its disposition — fixed on the branch, filed, or dropped — by two questions: *would this problem exist if this branch were not merged?* and, if it would, *is the changed path correct while it stands?* A no to either makes it the branch's to fix now; two yeses make it filed (or linked to the issue that covers it); what verification shows to be no defect, or not worth backlog work, is dropped with its reason (`/pr-create` § 8 *Dispositions*, #924)
3. _(user makes the code changes for what is fixed on the branch)_
4. `/pr-changes-amend` — Fold fixes into original commits for clean history; the replies and the round comment cite those commits, so the fold stays ahead of steps 5–6, and its closing force-push is the one act whose place depends on the PR's label (`/pr-create` § 8)
5. `/pr-comments-reply` — Post replies to each comment explaining what was done, declined or filed
6. The round comment on the PR — `Review round <n> — dispositions`, listing what was fixed, filed (with its number) and dropped, so the maintainer sees where review scope ended. The push and steps 5–6 run in the order `/pr-create` § 8 "The next round" states for the PR's label state
7. A `/review` comment on the PR (`gh pr comment <number> --body '/review'`) — once the replies and the round comment are posted and any fixes pushed, this is what brings the next round; a push alone does not, and a reply-only wave gets one too (`claude-review.yml`, #796). When and when not — a PR labelled `review-on-push` is reviewed by its push — is `/pr-create` § 8 "The next round"
