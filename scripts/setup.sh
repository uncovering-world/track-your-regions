#!/usr/bin/env bash
# Interactive first-run setup: writes .env (gitignored) and creates the first admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

prompt_default() { # $1=label $2=default -> echoes chosen value
  local val=""
  if [ -t 0 ]; then
    read -r -p "$1 [$2]: " val
  fi
  echo "${val:-$2}"
}

gen_secret() { node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"; }

set_kv() { # $1=key $2=value : replace-or-append KEY='value' in .env
  local key="$1" value="$2" tmp escaped
  # Single-quote the value (escaping embedded single quotes via '\'') so values
  # with spaces or shell metacharacters ($, `, ') survive `source` in db-cli.sh
  # / run-martin.sh. Single quotes round-trip cleanly through bash, dotenv, and
  # Docker Compose; double quotes leave literal backslashes in dotenv.
  # The RHS is intentionally unquoted: wrapping it in "" remangles the escape.
  escaped=${value//\'/\'\\\'\'}
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$ENV_FILE"; then
    grep -v "^${key}=" "$ENV_FILE" >"$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    rm -f "$tmp"
  fi
  printf "%s='%s'\n" "$key" "$escaped" >>"$ENV_FILE"
}

# Optional-integrations wizard (defines run_integrations_wizard).
# shellcheck source=scripts/setup-integrations.sh
. "$SCRIPT_DIR/setup-integrations.sh"

if [ -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}.env already exists — leaving it untouched.${NC}"
else
  echo "Creating .env (first-run setup)..."
  ADMIN_EMAIL_IN="$(prompt_default 'Admin email' 'admin@example.com')"
  ADMIN_NAME_IN="$(prompt_default 'Admin display name' "${ADMIN_EMAIL_IN%@*}")"
  DB_NAME_IN="$(prompt_default 'Database name' 'track_regions')"
  DB_PASSWORD_IN="$(prompt_default 'Database password' 'postgres')"
  JWT_IN="$(gen_secret)"

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  set_kv JWT_SECRET "$JWT_IN"
  set_kv DB_NAME "$DB_NAME_IN"
  set_kv DB_PASSWORD "$DB_PASSWORD_IN"
  set_kv ADMIN_EMAIL "$ADMIN_EMAIL_IN"
  set_kv ADMIN_DISPLAY_NAME "$ADMIN_NAME_IN"
  set_kv NODE_ENV development

  echo -e "${GREEN}Wrote .env${NC} (jwt rotated: yes; admin: ${ADMIN_EMAIL_IN}; db: ${DB_NAME_IN})"
fi

# Bring up the database and wait for health.
echo "Starting database..."
docker compose up -d db
echo -n "Waiting for database to be healthy"
for _ in $(seq 1 60); do
  status="$(docker compose ps db --format '{{.Health}}' 2>/dev/null || echo '')"
  if [ "$status" = "healthy" ]; then
    echo " done"
    break
  fi
  echo -n "."
  sleep 2
done
if [ "${status:-}" != "healthy" ]; then
  echo ""
  echo "Warning: database did not become healthy in time." >&2
  echo "Check 'docker compose logs db'; continuing anyway." >&2
fi

# Create the admin. Password is read from stdin so it never appears in argv.
ADMIN_PW=""
if [ -t 0 ]; then
  read -r -s -p "Admin password (blank = generate): " ADMIN_PW
  echo
fi
GENERATED_PW=""
if [ -z "$ADMIN_PW" ]; then
  ADMIN_PW="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  GENERATED_PW="$ADMIN_PW"
fi

# Read the values back by sourcing .env in a subshell, so quoting (e.g. a
# two-word display name) is handled the same way db-cli.sh sources it.
# shellcheck source=/dev/null
ADMIN_EMAIL_VAL="$(set -a; . "$ENV_FILE"; printf '%s' "${ADMIN_EMAIL:-}")"
# shellcheck source=/dev/null
ADMIN_NAME_VAL="$(set -a; . "$ENV_FILE"; printf '%s' "${ADMIN_DISPLAY_NAME:-}")"
if [ -z "$ADMIN_EMAIL_VAL" ]; then
  echo -e "${YELLOW}ADMIN_EMAIL is not set in ${ENV_FILE}.${NC}" >&2
  echo "Set it (or delete .env and re-run) before creating the admin." >&2
  exit 1
fi
printf '%s' "$ADMIN_PW" | docker compose run --rm -T \
  -e ADMIN_EMAIL="$ADMIN_EMAIL_VAL" \
  -e ADMIN_DISPLAY_NAME="$ADMIN_NAME_VAL" \
  backend npx tsx src/scripts/createAdmin.ts

# Walk through optional integrations (Google, OpenAI, GADM) — prompts only for
# ones still unset. SMTP / Apple stay manual (see .env.example / README).
run_integrations_wizard

echo -e "${GREEN}Setup complete.${NC} Next: ${YELLOW}npm run dev${NC}, then log in."
if [ -n "$GENERATED_PW" ]; then
  echo -e "${YELLOW}Generated admin password (shown once):${NC} $GENERATED_PW"
fi
