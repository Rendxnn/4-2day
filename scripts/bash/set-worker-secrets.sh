#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$script_dir/lib.sh"

environment="${1:-}"
check_only="false"

if [[ "$environment" != "staging" && "$environment" != "production" ]]; then
  die "Usage: $0 staging|production [--check]"
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      check_only="true"
      shift
      ;;
    *)
      die "Usage: $0 staging|production [--check]"
      ;;
  esac
done

root="$(repo_root)"
ensure_repo_root "$root"
secrets_file="$root/apps/api/.worker-secrets.$environment"

[[ -f "$secrets_file" ]] || die "Missing $secrets_file"

required_keys=(
  META_VERIFY_TOKEN
  META_ACCESS_TOKEN
  META_PHONE_NUMBER_ID
  META_WABA_ID
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  GEMINI_API_KEY
  OPENROUTER_API_KEY
  HUGGINGFACE_API_KEY
  GOOGLE_MAPS_GEOCODING_API_KEY
)

allowed_optional_keys=(
  OPENAI_API_KEY
  DATABASE_URL
  AI_CONFIG_ENCRYPTION_KEY
)

read_value() {
  local key="$1"
  awk -v expected_key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      separator = index($0, "=")
      if (separator == 0) next
      key = substr($0, 1, separator - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == expected_key) {
        print substr($0, separator + 1)
      }
    }
  ' "$secrets_file"
}

count_key() {
  local key="$1"
  awk -v expected_key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      separator = index($0, "=")
      if (separator == 0) next
      key = substr($0, 1, separator - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == expected_key) count += 1
    }
    END { print count + 0 }
  ' "$secrets_file"
}

for key in "${required_keys[@]}"; do
  match_count="$(count_key "$key")"
  [[ "$match_count" -eq 1 ]] || die "$key must appear exactly once in $secrets_file"
  value="$(read_value "$key" | tr -d '\r')"
  [[ -n "$value" ]] || die "$key is empty in $secrets_file"
  [[ "$value" != "replace-me" ]] || die "$key still contains replace-me in $secrets_file"
done

allowed_keys=("${required_keys[@]}" "${allowed_optional_keys[@]}")
while IFS= read -r configured_key; do
  is_allowed="false"
  for allowed_key in "${allowed_keys[@]}"; do
    if [[ "$configured_key" == "$allowed_key" ]]; then
      is_allowed="true"
      break
    fi
  done
  [[ "$is_allowed" == "true" ]] || die "Unknown key $configured_key in $secrets_file. Public variables belong in apps/api/wrangler.toml."
  [[ "$(count_key "$configured_key")" -eq 1 ]] || die "$configured_key must appear exactly once in $secrets_file"

  configured_value="$(read_value "$configured_key" | tr -d '\r')"
  [[ -n "$configured_value" ]] || die "$configured_key is empty in $secrets_file"
  [[ "$configured_value" != "replace-me" ]] || die "$configured_key still contains replace-me in $secrets_file"
done < <(
  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      separator = index($0, "=")
      if (separator == 0) next
      key = substr($0, 1, separator - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      print key
    }
  ' "$secrets_file"
)

chmod 600 "$secrets_file"
printf 'Validated Worker secrets for %s (%s).\n' "$environment" "$secrets_file"

if [[ "$check_only" == "true" ]]; then
  exit 0
fi

wrangler_bin="$root/apps/api/node_modules/.bin/wrangler"
printf 'Uploading Worker secrets to Cloudflare (%s)...\n' "$environment"
if [[ -x "$wrangler_bin" ]]; then
  (
    cd "$root/apps/api"
    "$wrangler_bin" secret bulk "$secrets_file" --env "$environment"
  )
else
  (
    cd "$root"
    pnpm_exec --filter @42day/api exec wrangler secret bulk "$secrets_file" --env "$environment"
  )
fi

printf 'Configured secret names:\n'
if [[ -x "$wrangler_bin" ]]; then
  (
    cd "$root/apps/api"
    "$wrangler_bin" secret list --env "$environment" --format pretty
  )
else
  (
    cd "$root"
    pnpm_exec --filter @42day/api exec wrangler secret list --env "$environment" --format pretty
  )
fi
