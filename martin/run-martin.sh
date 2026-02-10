#!/bin/bash
# =============================================================================
# Martin Tile Server - Standalone Runner
# =============================================================================
# Run Martin tile server outside of Docker Compose for development.
#
# Usage:
#   ./run-martin.sh              # Uses active database (from .active-db or .env)
#   ./run-martin.sh --help       # Show Martin help
#
# The script automatically detects the active database using the same mechanism
# as `npm run db:use` - it reads from .active-db file and .env.
#
# Requirements:
#   - Martin installed: cargo install martin (or download binary from GitHub)
#   - PostgreSQL with PostGIS running
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$SCRIPT_DIR/config.yaml"
ACTIVE_DB_FILE="$PROJECT_ROOT/.active-db"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables from .env
load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
    elif [[ -f "$ENV_EXAMPLE" ]]; then
        echo -e "${YELLOW}Warning: .env not found, using .env.example defaults${NC}"
        set -a
        source "$ENV_EXAMPLE"
        set +a
    fi
}

# Get active database name (same logic as db-cli.sh)
get_active_db() {
    # First check .active-db file
    if [[ -f "$ACTIVE_DB_FILE" ]]; then
        cat "$ACTIVE_DB_FILE"
        return
    fi

    # Fall back to DB_NAME from environment
    echo "${DB_NAME:-track_regions}"
}

# Load env first
load_env

# Get active database
ACTIVE_DB=$(get_active_db)

# Override DB_NAME with active database
DB_NAME="$ACTIVE_DB"

# Set defaults for other variables
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# Build connection string
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo -e "${BLUE}🗺️  Starting Martin Tile Server${NC}"
echo -e "   Database: ${GREEN}${DB_NAME}${NC} @ ${DB_HOST}:${DB_PORT}"
echo -e "   Config: ${CONFIG_FILE}"
echo ""

# Check if martin is installed
if ! command -v martin &> /dev/null; then
    echo "❌ Martin is not installed."
    echo ""

    # Detect OS and suggest appropriate installation method
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        echo "Detected: macOS"
        echo ""
        echo "Recommended installation:"
        echo -e "  ${GREEN}brew install maplibre/martin/martin${NC}"
        echo ""
        echo "Alternative:"
        echo "  cargo install martin"
    elif [[ -f /etc/debian_version ]] || [[ -f /etc/ubuntu_version ]] || command -v apt &> /dev/null; then
        # Debian/Ubuntu
        echo "Detected: Debian/Ubuntu Linux"
        echo ""
        echo "Recommended installation:"
        echo -e "  ${GREEN}# Download latest release${NC}"
        echo -e "  ${GREEN}curl -LO https://github.com/maplibre/martin/releases/latest/download/martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "  ${GREEN}tar -xzf martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "  ${GREEN}sudo mv martin /usr/local/bin/${NC}"
        echo ""
        echo "Alternative (requires Rust):"
        echo "  cargo install martin"
    elif [[ -f /etc/fedora-release ]] || [[ -f /etc/redhat-release ]]; then
        # Fedora/RHEL
        echo "Detected: Fedora/RHEL Linux"
        echo ""
        echo "Recommended installation:"
        echo -e "  ${GREEN}# Download latest release${NC}"
        echo -e "  ${GREEN}curl -LO https://github.com/maplibre/martin/releases/latest/download/martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "  ${GREEN}tar -xzf martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "  ${GREEN}sudo mv martin /usr/local/bin/${NC}"
        echo ""
        echo "Alternative (requires Rust):"
        echo "  cargo install martin"
    elif [[ -f /etc/arch-release ]]; then
        # Arch Linux
        echo "Detected: Arch Linux"
        echo ""
        echo "Recommended installation:"
        echo -e "  ${GREEN}yay -S martin${NC}  # or paru -S martin"
        echo ""
        echo "Alternative:"
        echo "  cargo install martin"
    else
        # Generic Linux or unknown
        echo "Detected: Linux"
        echo ""
        echo "Installation options:"
        echo ""
        echo "1. Download binary (recommended):"
        echo -e "   ${GREEN}curl -LO https://github.com/maplibre/martin/releases/latest/download/martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "   ${GREEN}tar -xzf martin-x86_64-unknown-linux-gnu.tar.gz${NC}"
        echo -e "   ${GREEN}sudo mv martin /usr/local/bin/${NC}"
        echo ""
        echo "2. Using Cargo (requires Rust):"
        echo "   cargo install martin"
    fi

    echo ""
    echo "Releases: https://github.com/maplibre/martin/releases"
    echo ""
    exit 1
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Config file not found: $CONFIG_FILE"
    exit 1
fi

# Run Martin
exec martin --config "$CONFIG_FILE" "$@"
