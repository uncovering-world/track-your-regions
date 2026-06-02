#!/usr/bin/env bash
# Interactive optional-integrations wizard for first-run setup.
#
# Sourced by setup.sh; relies on helpers/vars it defines: set_kv(), $ENV_FILE and
# the colour vars $GREEN/$YELLOW/$NC. Prompts only for integrations that are still
# unset, so re-running `npm run setup` lets you fill in ones you skipped earlier.
# Everything here is TTY-guarded — non-interactive runs (CI, pipes) skip silently.
# The inherited vars ($ENV_FILE, $GREEN/$YELLOW/$NC) are all-caps, so shellcheck
# treats them as environment vars and does not flag SC2154 — no suppression needed.

# Current value of KEY in .env (empty if unset/absent). Sourced in a subshell so
# quoting matches how setup.sh / db-cli.sh read it.
env_value() { # $1=key
  # shellcheck source=/dev/null
  (set -a; . "$ENV_FILE" 2>/dev/null || true; printf '%s' "${!1:-}")
}

# Prompt for one value. $1=label $2=hidden(1 hides input). Echoes the entry.
prompt_value() { # $1=label $2=hidden
  local val=""
  if [ "${2:-0}" = "1" ]; then
    read -r -s -p "    $1: " val; echo >&2
  else
    read -r -p "    $1: " val
  fi
  printf '%s' "$val"
}

# Ask a y/N question, default No. Returns 0 on yes.
confirm() { # $1=question
  local ans=""
  read -r -p "$1 (y/N): " ans
  case "$ans" in [yY] | [yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# Offer GADM, which loads via `npm run db:load-gadm` (a command, not an env var).
# Only offered when the boundaries table is empty; the db service is already up.
offer_gadm() {
  local dbname count
  dbname="$(env_value DB_NAME)"; dbname="${dbname:-track_regions}"
  count="$(docker compose exec -T db psql -U "${DB_USER:-postgres}" -d "$dbname" \
    -tAc 'SELECT count(*) FROM administrative_divisions' 2>/dev/null || echo '')"
  if [ -n "$count" ] && [ "$count" != "0" ]; then
    echo -e "  ${GREEN}\xe2\x9c\x93${NC} Map data (GADM) already loaded ($count divisions)."
    return 0
  fi
  echo ""
  echo "  Map data (GADM) — world administrative boundaries; the map is empty without it."
  echo "    Downloads + loads a large dataset; takes tens of minutes."
  if confirm "  Load GADM now?"; then
    npm run db:load-gadm
  else
    echo -e "    Skipped. Load later with: ${YELLOW}npm run db:load-gadm${NC}"
  fi
}

run_integrations_wizard() {
  # Non-interactive (CI, piped stdin): skip the whole wizard.
  [ -t 0 ] || return 0

  echo ""
  echo -e "${YELLOW}Optional integrations${NC} (all off by default — answer N to skip any):"

  # --- Google OAuth ---
  if [ -n "$(env_value GOOGLE_CLIENT_ID)" ]; then
    echo -e "  ${GREEN}\xe2\x9c\x93${NC} Google login already configured."
  else
    echo ""
    echo "  Google login — sign in with a Google account."
    echo "    Get credentials: https://console.cloud.google.com/apis/credentials"
    echo "    Authorized redirect URI: http://localhost:3001/api/auth/google/callback"
    if confirm "  Configure Google login now?"; then
      local gid gsecret
      gid="$(prompt_value 'GOOGLE_CLIENT_ID')"
      gsecret="$(prompt_value 'GOOGLE_CLIENT_SECRET' 1)"
      if [ -n "$gid" ] && [ -n "$gsecret" ]; then
        set_kv GOOGLE_CLIENT_ID "$gid"
        set_kv GOOGLE_CLIENT_SECRET "$gsecret"
        echo -e "  ${GREEN}\xe2\x9c\x93 Saved Google credentials.${NC}"
      else
        echo -e "    ${YELLOW}Skipped — both fields are required.${NC}"
      fi
    fi
  fi

  # --- OpenAI ---
  if [ -n "$(env_value OPENAI_API_KEY)" ]; then
    echo -e "  ${GREEN}\xe2\x9c\x93${NC} OpenAI (AI features) already configured."
  else
    echo ""
    echo "  AI features — region grouping, descriptions, geocoding, image matching."
    echo "    Get an API key: https://platform.openai.com/api-keys"
    if confirm "  Configure OpenAI now?"; then
      local key
      key="$(prompt_value 'OPENAI_API_KEY' 1)"
      if [ -n "$key" ]; then
        set_kv OPENAI_API_KEY "$key"
        echo -e "  ${GREEN}\xe2\x9c\x93 Saved OpenAI key.${NC}"
      else
        echo -e "    ${YELLOW}Skipped — no key entered.${NC}"
      fi
    fi
  fi

  # --- GADM map data ---
  offer_gadm

  echo ""
  echo -e "  ${YELLOW}Note:${NC} newly added keys take effect on the next ${YELLOW}npm run dev${NC}."
  echo "  SMTP email and Apple Sign-In are configured manually — see .env.example / README."
}
