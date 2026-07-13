#!/bin/bash
set -e

#===========================================
# Larkup — Auto Publish All Packages
#===========================================
# Usage:
#   ./auto-publish.sh                  # Publish everything (npm + pypi, skip docker)
#   ./auto-publish.sh --npm-only       # Only publish npm packages
#   ./auto-publish.sh --pypi-only      # Only publish Python SDK to PyPI
#   ./auto-publish.sh --docker-only    # Only build/push Docker image
#   ./auto-publish.sh --with-docker    # Publish npm + pypi + docker
#   ./auto-publish.sh --bump patch     # Bump version before publishing (patch|minor|major)
#   ./auto-publish.sh --version 0.2.0  # Set explicit version before publishing

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"

# ---- Parse arguments ----
PUBLISH_NPM=true
PUBLISH_PYPI=true
PUBLISH_DOCKER=false
BUMP_TYPE=""
CUSTOM_VERSION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --npm-only)
            PUBLISH_NPM=true
            PUBLISH_PYPI=false
            PUBLISH_DOCKER=false
            shift
            ;;
        --pypi-only)
            PUBLISH_NPM=false
            PUBLISH_PYPI=true
            PUBLISH_DOCKER=false
            shift
            ;;
        --docker-only)
            PUBLISH_NPM=false
            PUBLISH_PYPI=false
            PUBLISH_DOCKER=true
            shift
            ;;
        --with-docker)
            PUBLISH_DOCKER=true
            shift
            ;;
        --bump)
            BUMP_TYPE="$2"
            shift 2
            ;;
        --version)
            CUSTOM_VERSION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./auto-publish.sh [--npm-only|--pypi-only|--docker-only|--with-docker] [--bump patch|minor|major] [--version X.Y.Z]"
            exit 1
            ;;
    esac
done

# ---- Version bumping ----
bump_version() {
    local current="$1"
    local type="$2"
    
    IFS='.' read -r major minor patch <<< "$current"
    
    case "$type" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) echo "Invalid bump type: $type (use patch|minor|major)"; exit 1 ;;
    esac
    
    echo "${major}.${minor}.${patch}"
}

update_npm_version() {
    local file="$1"
    local new_version="$2"
    # Use node to update package.json version
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$file', 'utf8'));
        pkg.version = '$new_version';
        fs.writeFileSync('$file', JSON.stringify(pkg, null, 2) + '\n');
    "
}

update_pypi_version() {
    local file="$1"
    local new_version="$2"
    sed -i '' "s/^version = \".*\"/version = \"$new_version\"/" "$file"
}

if [ -n "$BUMP_TYPE" ] || [ -n "$CUSTOM_VERSION" ]; then
    echo "========================================="
    echo "  Updating Versions                      "
    echo "========================================="
    
    # Get current version from root package.json
    CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)")
    
    if [ -n "$CUSTOM_VERSION" ]; then
        NEW_VERSION="$CUSTOM_VERSION"
    else
        NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$BUMP_TYPE")
    fi
    
    echo "Version: $CURRENT_VERSION → $NEW_VERSION"
    echo ""
    
    # Update all package.json files
    NPM_PACKAGES=(
        "package.json"
        "apps/web/package.json"
        "apps/cli/package.json"
        "packages/core/package.json"
        "packages/vector-stores/package.json"
        "packages/scraper/package.json"
    )
    
    for pkg in "${NPM_PACKAGES[@]}"; do
        if [ -f "$pkg" ]; then
            update_npm_version "$pkg" "$NEW_VERSION"
            echo "  ✅ Updated $pkg"
        fi
    done
    
    # Update JS SDK separately (might have different versioning)
    update_npm_version "apps/sdk/js-sdk/package.json" "$NEW_VERSION"
    echo "  ✅ Updated apps/sdk/js-sdk/package.json"
    
    # Update Python SDK
    update_pypi_version "apps/sdk/py-sdk/pyproject.toml" "$NEW_VERSION"
    echo "  ✅ Updated apps/sdk/py-sdk/pyproject.toml"
    
    echo ""
fi

echo "========================================="
echo "  Larkup — Auto Publish              "
echo "========================================="
echo "  NPM:    $([ "$PUBLISH_NPM" = true ] && echo "✅" || echo "⏭️  skip")"
echo "  PyPI:   $([ "$PUBLISH_PYPI" = true ] && echo "✅" || echo "⏭️  skip")"
echo "  Docker: $([ "$PUBLISH_DOCKER" = true ] && echo "✅" || echo "⏭️  skip")"
echo "========================================="
echo ""

STEP=0
TOTAL=0
[ "$PUBLISH_NPM" = true ] && TOTAL=$((TOTAL + 1))
[ "$PUBLISH_PYPI" = true ] && TOTAL=$((TOTAL + 1))
[ "$PUBLISH_DOCKER" = true ] && TOTAL=$((TOTAL + 1))

# ---- NPM Packages ----
if [ "$PUBLISH_NPM" = true ]; then
    STEP=$((STEP + 1))
    echo "[$STEP/$TOTAL] Publishing NPM packages..."
    bash "$SCRIPTS_DIR/publish-npm.sh"
    echo ""
fi

# ---- PyPI ----
if [ "$PUBLISH_PYPI" = true ]; then
    STEP=$((STEP + 1))
    echo "[$STEP/$TOTAL] Publishing Python SDK to PyPI..."
    bash "$SCRIPTS_DIR/publish-pypi.sh"
    echo ""
fi

# ---- Docker ----
if [ "$PUBLISH_DOCKER" = true ]; then
    STEP=$((STEP + 1))
    echo "[$STEP/$TOTAL] Publishing Docker image..."
    bash "$SCRIPTS_DIR/publish-docker.sh"
    echo ""
fi

echo "========================================="
echo "🎉 All done! Published packages:"
[ "$PUBLISH_NPM" = true ] && echo "  📦 npm: @larkup/sdk, @larkup/cli, larkup"
[ "$PUBLISH_PYPI" = true ] && echo "  🐍 PyPI: larkup"
[ "$PUBLISH_DOCKER" = true ] && echo "  🐳 Docker: aboneda/larkup"
echo "========================================="
