#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="$repo_root/apps/api/.env.headless.local"
config_file="$repo_root/supabase/config.toml"
journal_dir="$repo_root/apps/api/.headless-journal"

usage() {
  cat >&2 <<'EOF'
Uso:
  scripts/bash/reset-local-headless-chat.sh --check
  scripts/bash/reset-local-headless-chat.sh --reset --confirm local-headless-reset

--check valida el único objetivo permitido y no cambia nada.
--reset requiere una confirmación explícita, ejecuta únicamente `supabase db reset --local`
y mueve el journal local exacto a un archivo recuperable dentro del mismo directorio.
EOF
}

read_env_value() {
  local key="$1"
  sed -n -E "s/^${key}=(.*)$/\1/p" "$env_file" | head -n 1 | sed -E "s/^['\"]|['\"]$//g"
}

read_section_value() {
  local section="$1"
  local key="$2"
  awk -v wanted_section="$section" -v wanted_key="$key" '
    $0 == "[" wanted_section "]" { inside=1; next }
    /^\[/ { inside=0 }
    inside && $1 == wanted_key {
      value=$0
      sub(/^[^=]*=[[:space:]]*/, "", value)
      gsub(/["[:space:]]/, "", value)
      print value
      exit
    }
  ' "$config_file"
}

fail() {
  echo "local_headless_reset_rejected:$1" >&2
  exit 2
}

[[ -f "$env_file" ]] || fail "missing_env_file"
[[ -f "$config_file" ]] || fail "missing_supabase_config"

app_env="$(read_env_value APP_ENV)"
debug="$(read_env_value PARAHOY_HEADLESS_DEBUG)"
local_project="$(read_env_value PARAHOY_HEADLESS_LOCAL_PROJECT_ID)"
supabase_url="$(read_env_value SUPABASE_URL)"
database_url="$(read_env_value DATABASE_URL)"
config_project="$(sed -n -E 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)".*$/\1/p' "$config_file" | head -n 1)"
api_port="$(read_section_value api port)"
db_port="$(read_section_value db port)"

[[ "$app_env" == "local" ]] || fail "APP_ENV_must_be_local"
[[ "$debug" == "true" ]] || fail "headless_debug_must_be_true"
[[ "$local_project" == "42day" && "$config_project" == "42day" ]] || fail "project_id_mismatch"

case "$supabase_url" in
  http://127.0.0.1:"$api_port"|http://localhost:"$api_port") ;;
  *) fail "supabase_url_must_be_loopback_and_match_config" ;;
esac

if [[ -n "$database_url" ]]; then
  case "$database_url" in
    postgresql://*127.0.0.1:"$db_port"/*|postgres://*127.0.0.1:"$db_port"/*|postgresql://*localhost:"$db_port"/*|postgres://*localhost:"$db_port"/*) ;;
    *) fail "database_url_must_be_loopback_and_match_config" ;;
  esac
fi

case "${1:---check}" in
  --check)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    echo "headless_local_reset_target_validated project_id=42day api=loopback db=loopback tenants=headless-demo,headless-isolation-b"
    echo "reset_command=supabase db reset --local"
    echo "no_reset_performed=true"
    ;;
  --reset)
    [[ $# -eq 3 && "${2:-}" == "--confirm" && "${3:-}" == "local-headless-reset" ]] || { usage; exit 2; }
    (
      cd "$repo_root"
      supabase db reset --local
    )
    if [[ -d "$journal_dir" ]]; then
      archive_dir="$journal_dir/archive-$(date -u +%Y%m%dT%H%M%SZ)"
      mv "$journal_dir" "$archive_dir"
      mkdir -m 700 "$journal_dir"
      echo "journal_archived=$archive_dir"
    else
      echo "journal_archived=none"
    fi
    echo "headless_local_reset_completed project_id=42day tenants=headless-demo,headless-isolation-b"
    ;;
  *)
    usage
    exit 2
    ;;
esac
