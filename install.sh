#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
TARGET_SKILL_DIR="$CODEX_HOME_DIR/skills/codex-quota-optimizer"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing OpenAI Codex Skill: codex-quota-optimizer"
mkdir -p "$TARGET_SKILL_DIR"
cp -R "$REPO_ROOT/skills/codex-quota-optimizer/"* "$TARGET_SKILL_DIR/"
chmod +x "$TARGET_SKILL_DIR/scripts/check_quota.mjs"
chmod +x "$TARGET_SKILL_DIR/scripts/optimize_work_plan.mjs"
chmod +x "$TARGET_SKILL_DIR/scripts/mcp_server.mjs"

# Also link into .agents/skills/ for repo-scoped discovery
mkdir -p "$REPO_ROOT/.agents/skills/codex-quota-optimizer"
cp -R "$REPO_ROOT/skills/codex-quota-optimizer/"* "$REPO_ROOT/.agents/skills/codex-quota-optimizer/"

# Append global AGENTS.md instructions if not already present
GLOBAL_AGENTS_MD="$CODEX_HOME_DIR/AGENTS.md"
if [ ! -f "$GLOBAL_AGENTS_MD" ] || ! grep -q "codex-quota-optimizer" "$GLOBAL_AGENTS_MD" 2>/dev/null; then
  cat "$REPO_ROOT/AGENTS.md" >> "$GLOBAL_AGENTS_MD"
  echo "==> Updated $GLOBAL_AGENTS_MD with codex-quota-optimizer lifecycle rules"
fi

# Register optional MCP server in ~/.codex/config.toml
CONFIG_TOML="$CODEX_HOME_DIR/config.toml"
if [ ! -f "$CONFIG_TOML" ] || ! grep -q "mcp_servers.codex_quota_optimizer" "$CONFIG_TOML" 2>/dev/null; then
  cat <<EOF >> "$CONFIG_TOML"

[mcp_servers.codex_quota_optimizer]
command = "node"
args = ["$TARGET_SKILL_DIR/scripts/mcp_server.mjs"]
EOF
  echo "==> Registered [mcp_servers.codex_quota_optimizer] in $CONFIG_TOML"
fi

echo "==> Installed successfully to: $TARGET_SKILL_DIR"
echo "==> Test the skill output now:"
node "$TARGET_SKILL_DIR/scripts/check_quota.mjs" --format=agent
