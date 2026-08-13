#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
worker_dir="$repo_root/apps/api"
wrangler="$worker_dir/node_modules/.bin/wrangler"

if [[ ! -x "$wrangler" ]]; then
  echo "wrangler_not_installed" >&2
  exit 2
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/parahoy-headless-deploy.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

(
  cd "$worker_dir"
  WRANGLER_LOG_PATH="$temporary_dir/wrangler.log" \
    "$wrangler" deploy --dry-run --outdir "$temporary_dir" --config wrangler.toml >/dev/null
)

if rg -n --hidden --glob '*.js' --glob '*.map' --glob '*.json' \
  'headless/cli|headless-chat|\.env\.headless|headless-journal|FIXTURE_NOT_FOUND|PARAHOY_HEADLESS' \
  "$temporary_dir"; then
  echo "headless_surface_in_worker_bundle" >&2
  exit 1
fi

echo "headless_surface_absent"
