#!/bin/bash
set -euo pipefail

# Usage: ./scripts/create-tool.sh <tool-id> "<Tool Name>" "<Short description>"
# Example: ./scripts/create-tool.sh contract-search "Contract Search" "Search corporate contracts with AI."

TOOL_ID="${1:?Usage: $0 <tool-id> \"<Tool Name>\" \"<Short description>\"}"
TOOL_NAME="${2:?Missing tool name}"
TOOL_DESC="${3:?Missing tool description}"

TOOL_DIR="packages/marketplace-tools/${TOOL_ID}"
PKG_NAME="@larkup/tool-${TOOL_ID}"
DATE=$(date +%Y-%m-%d)

if [ -d "$TOOL_DIR" ]; then
  echo "❌ Directory $TOOL_DIR already exists."
  exit 1
fi

echo "🔧 Creating marketplace tool: ${TOOL_NAME} (${TOOL_ID})"
echo ""

mkdir -p "${TOOL_DIR}/src"

# --- package.json ---
cat > "${TOOL_DIR}/package.json" << EOF
{
  "name": "${PKG_NAME}",
  "version": "0.1.0",
  "type": "module",
  "description": "Larkup marketplace tool: ${TOOL_DESC}",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "src", "tool.manifest.json", "README.md"],
  "scripts": {
    "build": "tsc --outDir dist",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@larkup/core": "workspace:*"
  },
  "peerDependencies": {
    "@larkup/marketplace": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "@larkup/marketplace": { "optional": true }
  },
  "devDependencies": {
    "@larkup/marketplace": "workspace:*",
    "typescript": "5.7.3"
  },
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/Larkup-AI/larkup",
    "directory": "packages/marketplace-tools/${TOOL_ID}"
  }
}
EOF

# --- tsconfig.json ---
cat > "${TOOL_DIR}/tsconfig.json" << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
EOF

# --- tool.manifest.json ---
cat > "${TOOL_DIR}/tool.manifest.json" << EOF
{
  "\$schema": "https://hub.larkup.de/schemas/tool-manifest.v3.json",
  "manifestVersion": "3.0",
  "kind": "tool",
  "id": "${TOOL_ID}",
  "name": "${TOOL_NAME}",
  "description": "${TOOL_DESC}",
  "category": "utility",
  "version": "0.1.0",
  "pricing": "free",
  "emoji": "🔧",
  "icon": "Wrench",
  "packageName": "${PKG_NAME}",
  "installSize": "~5 MB",
  "author": "Larkup",
  "capabilities": ["${TOOL_ID}"],
  "tags": [],
  "downloads": 0,
  "repositoryUrl": "https://github.com/Larkup-AI/larkup",
  "license": "Apache-2.0",
  "updatedAt": "${DATE}",
  "entrypoints": {
    "server": "./src/index.ts"
  },
  "runtime": {
    "protocolVersion": "1.0",
    "defaultMode": "local-docker",
    "modes": [
      {
        "id": "local-docker",
        "label": "Local",
        "description": "Run locally with Docker."
      }
    ]
  },
  "billing": {
    "model": "free",
    "meters": [],
    "entitlementVersion": "1.0"
  },
  "configSchema": [],
  "permissions": {
    "fsRead": false,
    "fsWrite": false,
    "exec": false,
    "httpAllow": []
  }
}
EOF

# --- src/index.ts ---
cat > "${TOOL_DIR}/src/index.ts" << EOF
export const TOOL_META = {
  id: '${TOOL_ID}',
  name: '${TOOL_NAME}',
  version: '0.1.0',
} as const;

/**
 * System prompt injected into the agent when this tool is active.
 * Keep it concise — the agent sees this alongside other tool prompts.
 */
export function getPrompt(): string {
  return \`You have access to the "${TOOL_NAME}" tool. ${TOOL_DESC} Use it when the user's request matches this capability.\`;
}

/**
 * Core tool logic. Called by the agent runtime when this tool is invoked.
 *
 * @param args - The arguments passed by the agent.
 * @param context - Runtime context (organization, config, etc.)
 * @returns The tool result displayed to the user.
 */
export async function execute(
  args: { query?: string },
  context: { organizationName?: string; config?: Record<string, string> },
): Promise<{ success: boolean; summary: string; data?: unknown }> {
  const query = args.query?.trim() || '';

  // TODO: Implement your tool logic here
  return {
    success: true,
    summary: \`${TOOL_NAME} executed successfully for query: "\${query}"\`,
    data: { query, timestamp: new Date().toISOString() },
  };
}
EOF

# --- README.md ---
cat > "${TOOL_DIR}/README.md" << EOF
# ${TOOL_NAME}

${TOOL_DESC}

## Installation

\`\`\`bash
# Via Larkup Marketplace
larkup marketplace install ${TOOL_ID}

# Or in monorepo dev
pnpm install
\`\`\`

## Configuration

Add any required environment variables or API keys in the Larkup Settings > Tools section.

## Development

\`\`\`bash
cd packages/marketplace-tools/${TOOL_ID}
pnpm exec tsc --noEmit   # Type check
pnpm build                # Build
\`\`\`
EOF

echo "✅ Tool scaffolded at ${TOOL_DIR}/"
echo ""
echo "📁 Files created:"
echo "   ${TOOL_DIR}/package.json"
echo "   ${TOOL_DIR}/tsconfig.json"
echo "   ${TOOL_DIR}/tool.manifest.json"
echo "   ${TOOL_DIR}/src/index.ts"
echo "   ${TOOL_DIR}/README.md"
echo ""
echo "📋 Next steps:"
echo "   1. cd ${TOOL_DIR}"
echo "   2. Edit src/index.ts with your tool logic"
echo "   3. Update tool.manifest.json (configSchema, billing, permissions)"
echo "   4. Run: pnpm install && pnpm exec tsc --noEmit"
echo "   5. Add as a private tool in apps/ee/private-tools/registry.ts (for EE)"
echo "      OR publish to Hub for public marketplace"
