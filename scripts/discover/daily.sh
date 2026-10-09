#!/usr/bin/env bash
# Daily entry point, run by the Daemon cron card on Chiba (SC-6479).
# Syncs this bot-owned clone to origin/main, loads the Claude OAuth login, then runs the
# discovery bot in commit mode (new/bumped entries land straight on main). Extra args
# pass through (e.g. --max-extract 10).
set -euo pipefail
cd "$(dirname "$0")/../.."
# One run at a time per clone. A second run resets the tree to origin/main and deletes the
# first run's unpublished finds (2026-10-09: the 07:30 cron landed mid bulk-run and wiped
# OoT, Majora's Mask, SM64 and GoldenEye). The lock is held through the exec'd node process.
mkdir -p "$HOME/.local/state/flat2vr-bot"
exec 9>"$HOME/.local/state/flat2vr-bot/run.lock"
if ! flock -n 9; then
  echo "another discovery run holds the lock; skipping this slot"
  exit 0
fi
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
set -a
# shellcheck disable=SC1091
[ -f "$HOME/.secrets/env.local" ] && . "$HOME/.secrets/env.local" >/dev/null 2>&1
set +a
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN # extraction must run on the OAuth login, never API billing

git fetch -q origin main
git checkout -q --force -B main origin/main
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --silent --no-audit --no-fund
fi
exec node scripts/discover/run.mjs --commit --notify "$@"
