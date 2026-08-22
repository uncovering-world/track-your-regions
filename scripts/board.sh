#!/usr/bin/env bash
# Helper for the org task board (https://github.com/orgs/uncovering-world/projects/2).
# Adds issues to the board and sets its single-select fields by name, resolving
# field/option ids via GraphQL so callers never handle raw node ids. Option names
# carry emoji prefixes ("🏔 High"), so a value matches the option's exact name or
# the part after the emoji; an ambiguous value is an error, never a guess.
#
# Usage:
#   scripts/board.sh add <issue#> [<priority> <size> <theme> <ai-fit> [<status>]]
#   scripts/board.sh set <issue#> <field> <value>
#   scripts/board.sh status <issue#> <status>
#
# Examples:
#   scripts/board.sh add 631 High Large "UX & Frontend" Pair Backlog
#   scripts/board.sh status 631 "In progress"
#   scripts/board.sh set 631 Priority Medium
#
# Values are the literal option words as shown on the board (Size: Tiny, Small,
# Medium, Large, X-Large — not single letters).
#
# Requires: gh (authenticated with the `project` scope; `gh auth refresh -s project`), jq.

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

project_id() {
  gql "query{organization(login:\"$ORG\"){projectV2(number:$PROJECT_NUMBER){id}}}" \
    --jq '.data.organization.projectV2.id'
}

fields_json() {
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

# Resolves "<Field>=<value>" to "<field id>=<option id>", matching the option's
# exact name or its name with the emoji prefix stripped; ambiguity is fatal.
resolve_option() {
  local fields="$1" fname="$2" value="$3" fid matches count
  # An empty value would match any single-token option name via the stripped-prefix
  # branch (its tail is ""), silently writing a wrong value — reject it up front.
  [ -n "$value" ] || die "empty value for field '$fname'"
  fid=$(echo "$fields" | jq -r --arg f "$fname" '.[] | select(.name == $f) | .id')
  [ -n "$fid" ] || die "no field named '$fname' on the board"
  matches=$(echo "$fields" | jq -r --arg f "$fname" --arg v "$value" \
    '.[] | select(.name == $f) | .options[]
     | select(.name == $v or ((.name | split(" ")[1:] | join(" ")) == $v))
     | .id')
  count=$(echo "$matches" | grep -c . || true)
  [ "$count" -ne 0 ] || die "field '$fname' has no option matching '$value'"
  [ "$count" -eq 1 ] || die "value '$value' is ambiguous for field '$fname'"
  echo "${fid}=${matches}"
}

apply_option() {
  local pid="$1" item="$2" pair="$3" fname="$4" value="$5"
  # The single quotes are deliberate: $pid/$iid/$fid/$oid are GraphQL variables bound via -f.
  # shellcheck disable=SC2016
  gql 'mutation($pid:ID!,$iid:ID!,$fid:ID!,$oid:String!){updateProjectV2ItemFieldValue(
        input:{projectId:$pid,itemId:$iid,fieldId:$fid,value:{singleSelectOptionId:$oid}}){projectV2Item{id}}}' \
    -f pid="$pid" -f iid="$item" -f fid="${pair%%=*}" -f oid="${pair##*=}" \
    --jq '.data.updateProjectV2ItemFieldValue.projectV2Item.id' >/dev/null
  echo "#${ISSUE}: ${fname} = ${value}"
}

# --- validate the invocation fully before touching the network -------------

[ $# -ge 2 ] || die "usage: board.sh add|set|status <issue#> ..."
CMD="$1"; ISSUE="$2"; shift 2
[[ "$ISSUE" =~ ^[1-9][0-9]*$ ]] || die "positive issue number expected, got '$ISSUE'"

case "$CMD" in
  add)    [ $# -eq 0 ] || [ $# -eq 4 ] || [ $# -eq 5 ] || \
            die "add takes either no field args or: <priority> <size> <theme> <ai-fit> [<status>]" ;;
  set)    [ $# -eq 2 ] || die "usage: board.sh set <issue#> <field> <value>" ;;
  status) [ $# -eq 1 ] || die "usage: board.sh status <issue#> <status>" ;;
  *)      die "unknown command '$CMD' (expected add, set, or status)" ;;
esac

PID=$(project_id)
FIELDS=$(fields_json "$PID")

case "$CMD" in
  add)
    if [ $# -ge 4 ]; then
      # Resolve every option before the first mutation, so a typo in any value
      # cannot leave the issue half-configured on the board.
      P_PAIR=$(resolve_option "$FIELDS" "Priority" "$1")
      S_PAIR=$(resolve_option "$FIELDS" "Size" "$2")
      T_PAIR=$(resolve_option "$FIELDS" "Theme" "$3")
      A_PAIR=$(resolve_option "$FIELDS" "AI fit" "$4")
      ST_PAIR=$(resolve_option "$FIELDS" "Status" "${5:-Backlog}")
      ITEM=$(item_id "$PID" "$ISSUE")
      echo "#${ISSUE}: on the board"
      apply_option "$PID" "$ITEM" "$P_PAIR" "Priority" "$1"
      apply_option "$PID" "$ITEM" "$S_PAIR" "Size" "$2"
      apply_option "$PID" "$ITEM" "$T_PAIR" "Theme" "$3"
      apply_option "$PID" "$ITEM" "$A_PAIR" "AI fit" "$4"
      apply_option "$PID" "$ITEM" "$ST_PAIR" "Status" "${5:-Backlog}"
    else
      ITEM=$(item_id "$PID" "$ISSUE")
      echo "#${ISSUE}: on the board"
    fi
    ;;
  set)
    PAIR=$(resolve_option "$FIELDS" "$1" "$2")
    ITEM=$(item_id "$PID" "$ISSUE")
    apply_option "$PID" "$ITEM" "$PAIR" "$1" "$2"
    ;;
  status)
    PAIR=$(resolve_option "$FIELDS" "Status" "$1")
    ITEM=$(item_id "$PID" "$ISSUE")
    apply_option "$PID" "$ITEM" "$PAIR" "Status" "$1"
    ;;
esac
