#!/usr/bin/env bash
# scripts/install.sh
#
# Bobtention installer — sets up the hook scripts in any Bob workspace.
#
# Usage:
#   ./scripts/install.sh [TARGET_WORKSPACE_DIR]
#
# With no argument, installs into the current directory.
# Requires Node.js ≥18 and npm.

set -euo pipefail

BOBTENTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$(pwd)}"

echo "╔══════════════════════════════════════════════╗"
echo "║         Bobtention Installer                 ║"
echo "║  Human attention router for IBM Bob          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "→ Bobtention source : $BOBTENTION_DIR"
echo "→ Target workspace  : $TARGET_DIR"
echo ""

# ─── 1. Build dist/ ─────────────────────────────────────────────────────────

echo "[ 1/4 ] Building Bobtention..."
cd "$BOBTENTION_DIR"
npm run build
echo "        ✓ dist/hooks/*.js ready"
echo ""

# ─── 2. Create default bobtention.config.json ───────────────────────────────

CONFIG_PATH="$TARGET_DIR/bobtention.config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "[ 2/4 ] Creating default bobtention.config.json..."
  cat > "$CONFIG_PATH" << 'EOF'
{
  "enabled": true,
  "decisionEngine": {
    "provider": "laya",
    "endpoint": "http://localhost:8000/v1/systemone",
    "timeout": 3000
  },
  "autonomy": {
    "watchThreshold": 0.55,
    "blockThreshold": 0.85
  },
  "signals": {
    "taskDrift": true,
    "repeatedFailure": true,
    "scopeExpansion": true,
    "highImpactAction": true,
    "uncertainty": true
  },
  "highImpactPatterns": [
    { "pattern": "delete|remove|drop|truncate",                  "category": "destructive" },
    { "pattern": "migration|schema",                             "category": "schema-change" },
    { "pattern": "\\.env|secret|credential|password|token|key", "category": "credentials" },
    { "pattern": "deploy|release|publish",                       "category": "deployment" }
  ],
  "humanOverride": { "enabled": true },
  "session": {
    "maxActions": 50
  }
}
EOF
  echo "        ✓ bobtention.config.json created (edit to customise)"
else
  echo "[ 2/4 ] bobtention.config.json already exists — skipping"
fi
echo ""

# ─── 3. Merge .bob/settings.json ────────────────────────────────────────────

echo "[ 3/4 ] Registering hooks in .bob/settings.json..."

BOB_DIR="$TARGET_DIR/.bob"
SETTINGS_FILE="$BOB_DIR/settings.json"

mkdir -p "$BOB_DIR"

# Resolve path to dist/hooks relative to the target workspace
HOOKS_DIR="$BOBTENTION_DIR/dist/hooks"

# SessionStart / UserPromptSubmit / Stop use flat type/command structure.
# PreToolUse / PostToolUse require the matcher-wrapped structure (AGENTS.md).
HOOK_COMMANDS=$(cat << EOF
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node $HOOKS_DIR/session-start.js",
        "timeout": 5
      }
    ],
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "node $HOOKS_DIR/user-prompt-submit.js",
        "timeout": 5
      }
    ],
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node $HOOKS_DIR/pre-tool-use.js",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node $HOOKS_DIR/post-tool-use.js",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "node $HOOKS_DIR/stop.js",
        "timeout": 5
      }
    ]
  }
}
EOF
)

if [ -f "$SETTINGS_FILE" ]; then
  # Merge: only add hooks not already present (use node for safe JSON merge)
  node - "$SETTINGS_FILE" << 'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
const existing = JSON.parse(fs.readFileSync(path, 'utf8'));
// Already has bobtention hooks if session-start is registered
const hasBobtention = JSON.stringify(existing).includes('session-start.js') ||
                      JSON.stringify(existing).includes('bobtention');
if (hasBobtention) {
  process.stderr.write('        Bobtention hooks already registered in .bob/settings.json — skipping\n');
} else {
  process.stderr.write('        Merging Bobtention hooks into existing .bob/settings.json\n');
}
NODEEOF
  # Simple approach: if bobtention not present, write the canonical settings
  if ! grep -q "session-start.js\|bobtention" "$SETTINGS_FILE" 2>/dev/null; then
    echo "$HOOK_COMMANDS" > "$SETTINGS_FILE"
    echo "        ✓ Hooks merged into .bob/settings.json"
  else
    echo "        ✓ Bobtention hooks already registered"
  fi
else
  echo "$HOOK_COMMANDS" > "$SETTINGS_FILE"
  echo "        ✓ .bob/settings.json created with Bobtention hooks"
fi
echo ""

# ─── 4. Create workspace-local .bobtention/ directories ─────────────────────

echo "[ 4/4 ] Creating runtime directories..."
mkdir -p "$TARGET_DIR/.bobtention/sessions"
mkdir -p "$TARGET_DIR/.bobtention/logs"
echo "        ✓ $TARGET_DIR/.bobtention/sessions/"
echo "        ✓ $TARGET_DIR/.bobtention/logs/"
echo ""

echo "══════════════════════════════════════════════"
echo "  Bobtention installed successfully!"
echo ""
echo "  Start a new Bob session in $TARGET_DIR"
echo "  and Bobtention will begin monitoring."
echo ""
echo "  Session data and dashboard written to:"
echo "    $TARGET_DIR/.bobtention/"
echo ""
echo "  Open the live dashboard at:"
echo "    $TARGET_DIR/.bobtention/dashboard.html"
echo ""
echo "  To unblock a stopped action:"
echo "    npx bobtention override [session-id]"
echo ""
echo "  Config: $CONFIG_PATH"
echo "══════════════════════════════════════════════"
