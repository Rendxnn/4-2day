#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

description_for() {
  case "$1" in
    show-helpers.sh) printf '%s' "Lists the available helpers." ;;
    install-workspace-deps.sh) printf '%s' "Installs or repairs workspace dependencies." ;;
    set-cf-worker-secret.sh) printf '%s' "Updates any Cloudflare Worker secret." ;;
    set-worker-secrets.sh) printf '%s' "Validates and bulk uploads all Worker secrets for one environment." ;;
    set-meta-access-token.sh) printf '%s' "Updates META_ACCESS_TOKEN in Cloudflare." ;;
    set-meta-phone-number-id.sh) printf '%s' "Updates META_PHONE_NUMBER_ID in Cloudflare." ;;
    set-gemini-api-key.sh) printf '%s' "Updates GEMINI_API_KEY in Cloudflare." ;;
    deploy-api.sh) printf '%s' "Deploys the API to Cloudflare." ;;
    test-api-health.sh) printf '%s' "Tests the deployed Worker /health endpoint." ;;
    start-api-dev.sh) printf '%s' "Starts the API locally with Wrangler." ;;
    start-dashboard-dev.sh) printf '%s' "Starts the dashboard locally with Vite." ;;
    start-local-stack.sh) printf '%s' "Starts API and dashboard for local dev." ;;
    tail-worker-logs.sh) printf '%s' "Tails Cloudflare Worker logs in real time." ;;
    publish-staging.sh) printf '%s' "Deploys staging and runs the health check." ;;
    publish-production.sh) printf '%s' "Deploys production and runs the health check." ;;
    *) printf '%s' "" ;;
  esac
}

for helper in "$script_dir"/*.sh; do
  name="$(basename "$helper")"
  [[ "$name" == "lib.sh" ]] && continue
  printf '%-28s %s\n' "$name" "$(description_for "$name")"
done | sort
