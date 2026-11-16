#!/usr/bin/env bash
# Holds the ADRs and the issues built to them to each other
# (docs/decisions/README.md § An ADR names the issues built to it).
#
# It checks the links and nothing else. A missing link says that nobody has
# compared the issue with the ADR yet: the answer is to compare them, and where
# they disagree to decide with the maintainer which of the two changes. It is
# never a reason to rewrite either to match the other.
#
# The link has two ends, and each is one line a script can read:
#   - an ADR's header field `**Built by:**` lists the issues built to it, as `#N`;
#   - such an issue's body has a line `**Built to:** ADR-NNNN decisions …`.
#
# Usage:
#   scripts/adr-issues.sh for <issue#>...
#       Which ADRs govern these issues, each with its Status: first the ADRs
#       whose field names one of them, then the ADRs that only mention one in
#       their text. It reads the working tree and needs no network.
#   scripts/adr-issues.sh check [ADR-NNNN | #N]...
#       Both directions, over the open issues:
#         (a) every open issue an ADR's field names carries that ADR in its
#             body's `**Built to:**` line;
#         (b) every open issue whose `**Built to:**` line names an ADR is named
#             by that ADR's field.
#       With arguments, only the mismatches that involve one of them are
#       printed and counted. A closed issue is not asked anything.
#
# Exit status of `check`: 0 when the two sides agree, 1 on any mismatch, 2 when
# the check could not run (no gh, no token, no network). 2 is "not checked",
# never "clean".
#
# `check` reads GitHub, so it needs the network and a token, and it is NOT a
# gate in scripts/gates.mjs: a gate reads the change's own files and answers the
# same on every machine. The skills call it at the moments drift is made or met
# (/pr-create, /queue check, /docs-sweep), and `npm run adr:issues` is the same
# command.
#
# Requires: jq; for `check`, gh authenticated with `repo`.
# ADR_ISSUES_DIR names another decisions directory (the spec's fixture).

set -euo pipefail

ORG="uncovering-world"
REPO="track-your-regions"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADR_DIR="${ADR_ISSUES_DIR:-$SCRIPT_DIR/../docs/decisions}"

die() { echo "adr-issues.sh: $*" >&2; exit 2; }

usage() {
  sed -n '/^# Usage:/,/^# Exit status/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

adr_files() {
  local file
  for file in "$ADR_DIR"/[0-9][0-9][0-9][0-9]-*.md; do
    [[ -e "$file" ]] && echo "$file"
  done
}

adr_number() { basename "$1" | cut -c1-4; }

# The paragraph a header field opens: from its line to the next blank line or
# the next field.
field_text() {
  awk -v field="**$2:**" '
    index($0, field) == 1 { on = 1; print; next }
    on && (/^[[:space:]]*$/ || /^\*\*/) { exit }
    on { print }
  ' "$1"
}

# The issue numbers of an ADR's field, one per line. Prints nothing when the
# ADR has no field.
built_by() {
  field_text "$1" "Built by" | grep -o '#[0-9]\+' | tr -d '#' | sort -un || true
}

has_field() { grep -q '^\*\*Built by:\*\*' "$1"; }

status_of() {
  field_text "$1" "Status" | tr '\n' ' ' | sed 's/^\*\*Status:\*\* *//; s/ *$//'
}

cmd_for() {
  [[ $# -ge 1 ]] || usage
  local issue file number found
  for issue in "$@"; do
    issue="${issue#\#}"
    [[ "$issue" =~ ^[1-9][0-9]*$ ]] || die "not an issue number: $issue"
    found=0
    echo "#$issue is built to:"
    while read -r file; do
      if built_by "$file" | grep -qx "$issue"; then
        found=1
        echo "  ADR-$(adr_number "$file")  Status: $(status_of "$file")"
        echo "      docs/decisions/$(basename "$file")"
      fi
    done < <(adr_files)
    [[ $found -eq 1 ]] || echo "  no ADR's Built by field names it"
    found=0
    while read -r file; do
      built_by "$file" | grep -qx "$issue" && continue
      if grep -q -E "#${issue}([^0-9]|\$)" "$file"; then
        [[ $found -eq 1 ]] || echo "#$issue is mentioned, and not named as built to it, by:"
        found=1
        number="$(adr_number "$file")"
        if has_field "$file"; then
          echo "  ADR-$number  Status: $(status_of "$file")"
        else
          echo "  ADR-$number  (no Built by field yet)  Status: $(status_of "$file")"
        fi
      fi
    done < <(adr_files)
  done
}

cmd_check() {
  command -v gh >/dev/null || die "gh is required for check"
  local -A only_adr=() only_issue=()
  local arg filtered=0
  for arg in "$@"; do
    filtered=1
    if [[ "$arg" =~ ^ADR-([0-9]{4})$ ]]; then
      only_adr["${BASH_REMATCH[1]}"]=1
    elif [[ "$arg" =~ ^#?([1-9][0-9]*)$ ]]; then
      only_issue["${BASH_REMATCH[1]}"]=1
    else
      die "check takes ADR-NNNN or #N, not: $arg"
    fi
  done

  # One read of every open issue: its number and the ADRs its Built to line names.
  local issues
  issues="$(gh issue list --repo "$ORG/$REPO" --state open --limit 10000 --json number,body)" \
    || die "could not list the open issues (network, or gh auth status): nothing was checked"
  local -A open=() issue_adrs=()
  local number adrs
  while IFS=$'\t' read -r number adrs; do
    open["$number"]=1
    issue_adrs["$number"]="$adrs"
  done < <(jq -r '
    .[] | [
      .number,
      ((.body // "") | gsub("\r"; "") | split("\n")
        | map(select(test("^\\*\\*Built to:\\*\\*"))) | (.[0] // "")
        | [scan("ADR-([0-9]{4})") | .[0]] | unique | join(" "))
    ] | @tsv' <<<"$issues")
  [[ ${#open[@]} -gt 0 ]] || die "the list of open issues came back empty: nothing was checked"

  local -A adr_file=() adr_names=()
  local file adr issue
  while read -r file; do
    adr="$(adr_number "$file")"
    adr_file["$adr"]="$file"
    has_field "$file" && adr_names["$adr"]=" $(built_by "$file" | tr '\n' ' ')"
  done < <(adr_files)

  wanted() { # <adr> <issue>
    [[ $filtered -eq 0 ]] || [[ -n "${only_adr[$1]:-}" ]] || [[ -n "${only_issue[$2]:-}" ]]
  }

  local checked_adrs=0 links=0
  local -a unnamed_in_issue=() unnamed_in_adr=() no_field=() no_adr=()
  # (a) the ADR's field names an open issue whose body does not name the ADR
  for adr in $(printf '%s\n' "${!adr_names[@]}" | sort); do
    checked_adrs=$((checked_adrs + 1))
    for issue in ${adr_names[$adr]}; do
      [[ -n "${open[$issue]:-}" ]] || continue
      wanted "$adr" "$issue" || continue
      links=$((links + 1))
      [[ " ${issue_adrs[$issue]} " == *" $adr "* ]] || unnamed_in_issue+=("ADR-$adr names #$issue, and #$issue's body does not name ADR-$adr")
    done
  done
  # (b) an open issue's body names an ADR whose field does not name the issue
  for issue in $(printf '%s\n' "${!issue_adrs[@]}" | sort -n); do
    for adr in ${issue_adrs[$issue]}; do
      wanted "$adr" "$issue" || continue
      if [[ -z "${adr_file[$adr]:-}" ]]; then
        no_adr+=("#$issue names ADR-$adr, and docs/decisions/ holds no ADR-$adr")
      elif [[ -z "${adr_names[$adr]+set}" ]]; then
        no_field+=("#$issue names ADR-$adr, and ADR-$adr has no Built by field")
      elif [[ "${adr_names[$adr]}" != *" $issue "* ]]; then
        unnamed_in_adr+=("#$issue names ADR-$adr, and ADR-$adr's Built by field does not name #$issue")
      fi
    done
  done

  local mismatches=$(( ${#unnamed_in_issue[@]} + ${#unnamed_in_adr[@]} + ${#no_field[@]} + ${#no_adr[@]} ))
  if [[ $mismatches -eq 0 ]]; then
    echo "adr-issues: the ADRs and the open issues agree ($checked_adrs ADR(s) with a Built by field, $links link(s) to an open issue read)."
    return 0
  fi
  if [[ ${#unnamed_in_issue[@]} -gt 0 ]]; then
    printf '%s\n' "${unnamed_in_issue[@]}"
    echo "  Do: compare the issue's body and its comments with the ADR's decisions. Where they agree, add '**Built to:** ADR-NNNN decisions …' at the top of the issue's Description. Where they disagree, neither is rewritten: put both sentences to the maintainer and decide which changes. Where the issue is not built to the ADR, take it out of the ADR's field."
  fi
  if [[ ${#unnamed_in_adr[@]} -gt 0 ]]; then
    printf '%s\n' "${unnamed_in_adr[@]}"
    echo "  Do: compare the issue's body and its comments with the ADR's decisions. Where they agree, add the issue to the ADR's Built by field (a header edit, not a decision). Where they disagree, put both sentences to the maintainer and decide which changes."
  fi
  if [[ ${#no_field[@]} -gt 0 ]]; then
    printf '%s\n' "${no_field[@]}"
    echo "  Do: compare the issue's body with the ADR's decisions. Where they agree, give the ADR a '**Built by:**' field naming every issue built to it (a header edit, not a decision). Where they disagree, put both sentences to the maintainer and decide which changes."
  fi
  if [[ ${#no_adr[@]} -gt 0 ]]; then
    printf '%s\n' "${no_adr[@]}"
    echo "  Do: find the ADR the line means and name it; the line points at nothing."
  fi
  echo "adr-issues: $mismatches mismatch(es) between the ADRs and the open issues."
  return 1
}

command -v jq >/dev/null || die "jq is required"
[[ -d "$ADR_DIR" ]] || die "no decisions directory at $ADR_DIR"

case "${1:-}" in
  for) shift; cmd_for "$@" ;;
  check) shift; cmd_check "$@" ;;
  *) usage ;;
esac
