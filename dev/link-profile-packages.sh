#!/usr/bin/env bash
# Point this checkout's @deepseek-ai packages at a local dsh installation, which
# is what dev/verify.mjs needs to boot a real profile. The repo's own
# dependencies stay under node_modules/.deepseek-ai-repo so the keyless tests
# (npm test) can still run against the pinned build dependencies.
#
#   dev/link-profile-packages.sh [path-to-@deepseek-ai]
#
# Default source: $DSH_HOME/profiles/node_modules/@deepseek-ai
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-${DSH_HOME:-$HOME/.dsh}/profiles/node_modules/@deepseek-ai}"

if [ ! -d "$source_dir" ]; then
  echo "no @deepseek-ai packages at $source_dir" >&2
  echo "run 'dsh plugin --profile <name> add <something>' once so the profile fallback exists" >&2
  exit 1
fi

cd "$root/node_modules"
if [ -d "@deepseek-ai" ] && [ ! -d ".deepseek-ai-repo" ] && [ ! -L "@deepseek-ai" ]; then
  mv "@deepseek-ai" ".deepseek-ai-repo"
fi
rm -rf "@deepseek-ai"
mkdir -p "@deepseek-ai"
for package in "$source_dir"/*; do
  ln -sfn "$package" "@deepseek-ai/$(basename "$package")"
done
echo "linked $(ls -1 "@deepseek-ai" | wc -l | tr -d ' ') packages from $source_dir"
echo "run 'npm install' to restore the repo's own dependencies"
