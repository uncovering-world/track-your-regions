#!/usr/bin/env bash
# Helper for the org task board (https://github.com/orgs/uncovering-world/projects/2).
#
# Since 2026-09-02 the board carries one field of its own — Status — and everything
# else lives on the issue itself as GitHub-native metadata: the org issue fields
# Priority / Size / Theme / AI fit (set here through the issue-field REST endpoint,
# by issue number, no project item id involved), the issue type Bug / Feature /
# Task / Epic, sub-issues, dependencies and the milestone. Only Status still goes
# through the project (GraphQL, `project` scope). Writing a field needs `repo`;
# listing the org's fields to validate a value (GET /orgs/{org}/issue-fields)
# needs `read:org`, which `gh auth login` grants by default — creating or editing
# a field or a type is the one thing that needs `admin:org`, and this script
# never does it.
#
# Usage:
#   scripts/board.sh add <issue#> [<priority> <size> <theme> <ai-fit> [<status>]]
#   scripts/board.sh set <issue#> <field> <value>       # Status, Priority, Size, Theme, AI fit
#   scripts/board.sh status <issue#> <status>
#   scripts/board.sh type <issue#> <Bug|Feature|Task|Epic>
#
# Examples:
#   scripts/board.sh add 631 High Large "UX & Frontend" Pair Backlog
#   scripts/board.sh status 631 "In progress"
#   scripts/board.sh set 631 Priority Medium
#   scripts/board.sh type 631 Epic
#
# `add` with fields writes the four fields first and places the issue second, so a
# token without the `project` scope loses the placement alone: the fields are set,
# the miss is printed on stderr, and the exit status is 2 — retry `add` once the
# scope is there (idempotent: the same values are rewritten, an existing board item
# is reused). `add` without field args, `set Status` and `status` need the board
# and die with the reason (exit 1); `set` on the four fields and `type` never
# touch the project.
#
# Values are the option names as GitHub shows them (Size: Tiny, Small, Medium, Large,
# X-Large — not single letters). Status options carry an emoji prefix ("🏗 In progress");
# a value matches an option's exact name or the part after the emoji, case-insensitively,
# and an ambiguous value is an error, never a guess. Parents, blockers and milestones
# need no helper: `gh issue edit N --parent P`, `--add-blocked-by B`, `--milestone "M"`.
#
# Requires: gh (authenticated with `repo` + `read:org`; `project` scope for Status and
# for placing an issue on the board — `gh auth refresh -s project`), jq.

set -euo pipefail

ORG="uncovering-world"
REPO="track-your-regions"
PROJECT_NUMBER=2

die() { echo "board.sh: $*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required"

gql() {
  local query="$1"; shift
  gh api graphql -f query="$query" "$@"
}

# Drops an emoji prefix ("🏔 High" -> "High") so the old board vocabulary keeps working.
strip_prefix() {
  local v="$1" first
  if [[ "$v" == *" "* ]]; then
    first="${v%% *}"
    [[ "$first" =~ [A-Za-z0-9] ]] || v="${v#* }"
  fi
  echo "$v"
}

is_issue_field() {
  case "$1" in Priority|Size|Theme|"AI fit") return 0 ;; *) return 1 ;; esac
}

# --- issue fields (org-level, on the issue itself; REST, `repo` scope) -------

org_fields_json() {
  gh api "orgs/$ORG/issue-fields" --jq '[.[] | select(.data_type == "single_select") | {id, name, options: [.options[].name]}]'
}

# Resolves "<Field>" + "<value>" to "<field id>=<option name>", matching the option's
# name exactly or case-insensitively after stripping an emoji prefix; ambiguity is fatal.
resolve_issue_option() {
  local fields="$1" fname="$2" value="$3" fid matches count
  value=$(strip_prefix "$value")
  [ -n "$value" ] || die "empty value for field '$fname'"
  fid=$(echo "$fields" | jq -r --arg f "$fname" '.[] | select(.name == $f) | .id')
  [ -n "$fid" ] || die "no org issue field named '$fname'"
  matches=$(echo "$fields" | jq -r --arg f "$fname" --arg v "$value" \
    '.[] | select(.name == $f) | .options[]
     | select(. == $v or (ascii_downcase == ($v | ascii_downcase)))')
  count=$(echo "$matches" | grep -c . || true)
  [ "$count" -ne 0 ] || die "field '$fname' has no option matching '$value'"
  [ "$count" -eq 1 ] || die "value '$value' is ambiguous for field '$fname'"
  echo "${fid}=${matches}"
}

# Writes every "<field id>=<option name>" pair in one request (POST adds or updates the
# named fields and leaves the others alone).
apply_issue_options() {
  local issue="$1"; shift
  local body='{"issue_field_values":[]}' pair
  for pair in "$@"; do
    body=$(echo "$body" | jq --arg id "${pair%%=*}" --arg v "${pair#*=}" \
      '.issue_field_values += [{"field_id": ($id | tonumber), "value": $v}]')
  done
  echo "$body" | gh api -X POST "repos/$ORG/$REPO/issues/$issue/issue-field-values" --input - >/dev/null
}

# --- Status (the one remaining project field; GraphQL, `project` scope) ------

# Prints the project's node id, or nothing when the project cannot be read
# (missing `project` scope, or no such project); never the string "null".
project_id() {
  gql "query{organization(login:\"$ORG\"){projectV2(number:$PROJECT_NUMBER){id}}}" \
    --jq '.data.organization.projectV2.id // empty'
}

# `add` after the fields are written: the placement is what was lost, and exit 2
# keeps that visible to a caller that reads the status (the /issue-upload ledger).
placement_missed() {
  echo "board.sh: #${ISSUE}: fields set, but $1 — not placed, Status not set; retry \`board.sh add\` once that is fixed" >&2
  exit 2
}

# For the commands whose only job is the board: die with the reason.
require_project_id() {
  local pid
  pid=$(project_id 2>/dev/null) || pid=""
  [ -n "$pid" ] || die "the board is unreadable (missing \`project\` scope? gh auth refresh -s project)"
  echo "$pid"
}

project_fields_json() {
  local pid="$1"
  # The single quotes are deliberate: $pid is a GraphQL variable bound via -f.
  # shellcheck disable=SC2016
  gql 'query($pid:ID!){node(id:$pid){... on ProjectV2{fields(first:30){nodes{
        ... on ProjectV2SingleSelectField{id name options{id name}}}}}}}' \
    -f pid="$pid" --jq '[.data.node.fields.nodes[] | select(.name != null)]'
}

# Finds the board item for an issue, adding the issue to the board when absent.
item_id() {
  local pid="$1" issue="$2" existing content_id
  # On any GraphQL error gh prints the raw response to stdout, so keep the
  # output only when gh succeeds.
  existing=$(gql "query{repository(owner:\"$ORG\",name:\"$REPO\"){issue(number:$issue){
      id projectItems(first:10){nodes{id project{id}}}}}}" \
    --jq ".data.repository.issue | select(. != null) | ((.projectItems.nodes // [])[] | select(.project.id == \"$pid\") | .id) // empty" \
    2>/dev/null) || existing=""
  existing=$(echo "$existing" | head -1)
  if [ -n "$existing" ]; then
    echo "$existing"
    return
  fi
  content_id=$(gql "query{repository(owner:\"$ORG\",name:\"$REPO\"){issue(number:$issue){id}}}" \
    --jq '.data.repository.issue.id // empty' 2>/dev/null) || content_id=""
  [ -n "$content_id" ] || die "issue #$issue not found"
  # The single quotes are deliberate: $pid/$cid are GraphQL variables bound via -f.
  # shellcheck disable=SC2016
  gql 'mutation($pid:ID!,$cid:ID!){addProjectV2ItemById(input:{projectId:$pid,contentId:$cid}){item{id}}}' \
    -f pid="$pid" -f cid="$content_id" --jq '.data.addProjectV2ItemById.item.id'
}

# Resolves a Status value to "<field id>=<option id>", matching the option's exact
# name or its name with the emoji prefix stripped; ambiguity is fatal.
resolve_status_option() {
  local fields="$1" value="$2" fid matches count
  [ -n "$value" ] || die "empty value for field 'Status'"
  fid=$(echo "$fields" | jq -r '.[] | select(.name == "Status") | .id')
  [ -n "$fid" ] || die "no field named 'Status' on the board"
  matches=$(echo "$fields" | jq -r --arg v "$value" \
    '.[] | select(.name == "Status") | .options[]
     | select(.name == $v or ((.name | split(" ")[1:] | join(" ")) == $v)
              or ((.name | split(" ")[1:] | join(" ") | ascii_downcase) == ($v | ascii_downcase)))
     | .id')
  count=$(echo "$matches" | grep -c . || true)
  [ "$count" -ne 0 ] || die "Status has no option matching '$value'"
  [ "$count" -eq 1 ] || die "value '$value' is ambiguous for Status"
  echo "${fid}=${matches}"
}

apply_status() {
  local pid="$1" item="$2" pair="$3" value="$4"
  # The single quotes are deliberate: $pid/$iid/$fid/$oid are GraphQL variables bound via -f.
  # shellcheck disable=SC2016
  gql 'mutation($pid:ID!,$iid:ID!,$fid:ID!,$oid:String!){updateProjectV2ItemFieldValue(
        input:{projectId:$pid,itemId:$iid,fieldId:$fid,value:{singleSelectOptionId:$oid}}){projectV2Item{id}}}' \
    -f pid="$pid" -f iid="$item" -f fid="${pair%%=*}" -f oid="${pair##*=}" \
    --jq '.data.updateProjectV2ItemFieldValue.projectV2Item.id' >/dev/null || return 1
  # The explicit `|| return 1` matters: when this function runs as the left side
  # of `||`, `set -e` is suspended inside it, and without it a failed mutation
  # would fall through to the echo and return 0.
  echo "#${ISSUE}: Status = ${value}"
}

# --- issue type ---------------------------------------------------------------

apply_type() {
  local issue="$1" value="$2" known
  known=$(gh api "orgs/$ORG/issue-types" --jq '.[] | select(.is_enabled) | .name')
  echo "$known" | grep -qx -- "$value" || die "unknown issue type '$value' (expected one of: $(echo "$known" | tr '\n' ' '))"
  gh issue edit "$issue" -R "$ORG/$REPO" --type "$value" >/dev/null
  echo "#${issue}: Type = ${value}"
}

# --- validate the invocation fully before touching the network -------------

[ $# -ge 2 ] || die "usage: board.sh add|set|status|type <issue#> ..."
CMD="$1"; ISSUE="$2"; shift 2
[[ "$ISSUE" =~ ^[1-9][0-9]*$ ]] || die "positive issue number expected, got '$ISSUE'"

case "$CMD" in
  add)    [ $# -eq 0 ] || [ $# -eq 4 ] || [ $# -eq 5 ] || \
            die "add takes either no field args or: <priority> <size> <theme> <ai-fit> [<status>]" ;;
  set)    [ $# -eq 2 ] || die "usage: board.sh set <issue#> <field> <value>" ;;
  status) [ $# -eq 1 ] || die "usage: board.sh status <issue#> <status>" ;;
  type)   [ $# -eq 1 ] || die "usage: board.sh type <issue#> <Bug|Feature|Task|Epic>" ;;
  *)      die "unknown command '$CMD' (expected add, set, status, or type)" ;;
esac

case "$CMD" in
  add)
    if [ $# -ge 4 ]; then
      # Resolve every option before the first mutation, so a typo in any value
      # cannot leave the issue half-configured.
      OF=$(org_fields_json)
      P_PAIR=$(resolve_issue_option "$OF" "Priority" "$1")
      S_PAIR=$(resolve_issue_option "$OF" "Size" "$2")
      T_PAIR=$(resolve_issue_option "$OF" "Theme" "$3")
      A_PAIR=$(resolve_issue_option "$OF" "AI fit" "$4")
      # The project leg is the only one that needs the `project` scope; the four
      # field writes need `repo`. So a token without that scope loses board
      # placement alone, never the fields it was asked to set — and a bad Status
      # value still dies before any write, as long as the project is readable.
      # (Assign PID only on success: `PID=$(cmd)` keeps cmd's output even when
      # the condition fails.)
      PID=""
      if pid=$(project_id 2>/dev/null) && [ -n "$pid" ] \
         && pf=$(project_fields_json "$pid" 2>/dev/null) && [ -n "$pf" ]; then
        PID="$pid"
        # A bad Status *value* still dies here, before any write; a failed *read*
        # of the project or its fields leaves PID empty and lands in placement_missed.
        ST_PAIR=$(resolve_status_option "$pf" "${5:-Backlog}")
      fi
      # Every option is resolved; the first mutation is the field write, and the
      # board mutations (adding the item, setting Status) come after it, so a
      # project that can be read but not written still leaves the fields set.
      apply_issue_options "$ISSUE" "$P_PAIR" "$S_PAIR" "$T_PAIR" "$A_PAIR"
      echo "#${ISSUE}: Priority = ${P_PAIR#*=}, Size = ${S_PAIR#*=}, Theme = ${T_PAIR#*=}, AI fit = ${A_PAIR#*=}"
      [ -n "$PID" ] || placement_missed "the board is unreadable (missing \`project\` scope? gh auth refresh -s project)"
      ITEM=$(item_id "$PID" "$ISSUE") || ITEM=""
      [ -n "$ITEM" ] || placement_missed "adding the issue to the board failed (a token that reads the project but cannot write it?)"
      echo "#${ISSUE}: on the board"
      apply_status "$PID" "$ITEM" "$ST_PAIR" "${5:-Backlog}" || placement_missed "setting Status failed"
    else
      PID=$(require_project_id)
      ITEM=$(item_id "$PID" "$ISSUE")
      echo "#${ISSUE}: on the board"
    fi
    ;;
  set)
    if [ "$1" = "Status" ]; then
      PID=$(require_project_id)
      PAIR=$(resolve_status_option "$(project_fields_json "$PID")" "$2")
      ITEM=$(item_id "$PID" "$ISSUE")
      apply_status "$PID" "$ITEM" "$PAIR" "$2"
    elif is_issue_field "$1"; then
      PAIR=$(resolve_issue_option "$(org_fields_json)" "$1" "$2")
      apply_issue_options "$ISSUE" "$PAIR"
      echo "#${ISSUE}: $1 = ${PAIR#*=}"
    else
      die "unknown field '$1' (expected Status, Priority, Size, Theme, or AI fit)"
    fi
    ;;
  status)
    PID=$(require_project_id)
    PAIR=$(resolve_status_option "$(project_fields_json "$PID")" "$1")
    ITEM=$(item_id "$PID" "$ISSUE")
    apply_status "$PID" "$ITEM" "$PAIR" "$1"
    ;;
  type)
    apply_type "$ISSUE" "$1"
    ;;
esac
