#!/usr/bin/env bash
# Rebuilds the Recovery Desk and republishes the gh-pages branch.
# The main working tree is never touched: the build is staged in a
# throwaway worktree that is removed afterwards.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bun run showcase
(cd web && bun install --silent && bun run build)

tmp="$(mktemp -d)"
git worktree add --force "$tmp" gh-pages >/dev/null
rm -rf "${tmp:?}"/assets "${tmp:?}"/index.html
cp -r web/dist/* "$tmp"/
touch "$tmp"/.nojekyll

cd "$tmp"
git add -A
git commit -q -m "Deploy Recovery Desk" || echo "nothing changed"
git push -q origin gh-pages

cd "$root"
git worktree remove "$tmp" --force
echo "published to gh-pages"
