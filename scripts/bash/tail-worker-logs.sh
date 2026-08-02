#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$script_dir/lib.sh"

environment="staging"
worker_name="42day-api"
tail_args=()
raw_output="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment|-e)
      environment="${2:?Missing environment value}"
      shift 2
      ;;
    --worker-name|-w)
      worker_name="${2:?Missing worker name}"
      shift 2
      ;;
    --format|--status|--method|--header|--sampling-rate|--search|--ip|--version-id)
      tail_args+=("$1" "${2:?Missing value for $1}")
      shift 2
      ;;
    --raw)
      raw_output="true"
      shift
      ;;
    --)
      shift
      tail_args+=("$@")
      break
      ;;
    *)
      tail_args+=("$1")
      shift
      ;;
  esac
done

root="$(repo_root)"
ensure_repo_root "$root"

printf 'Tailing logs for %s (%s)...\n' "$worker_name" "$environment"
(
  cd "$root/apps/api"
  wrangler_bin="$root/apps/api/node_modules/.bin/wrangler"
  cmd=(tail "$worker_name" --env "$environment" --format json)
  if [[ ${#tail_args[@]} -gt 0 ]]; then
    cmd+=("${tail_args[@]}")
  fi
  run_tail() {
    if [[ -x "$wrangler_bin" ]]; then
      "$wrangler_bin" "${cmd[@]}"
      return
    fi
    pnpm_exec --filter @42day/api exec wrangler "${cmd[@]}"
  }
  if [[ "$raw_output" == "true" ]] || ! command -v jq >/dev/null 2>&1; then
    run_tail
    exit
  fi

  run_tail | jq --unbuffered -r '
    def short_time:
      (. // "") | if length >= 19 then .[11:19] else . end;
    def level_label:
      (. // "info") | ascii_upcase;
    def structured_line($log; $entry):
      [
        (($entry.timestamp // ($log.timestamp / 1000 | todateiso8601)) | short_time),
        (($entry.level // $log.level) | level_label),
        ($entry.traceId // "--------"),
        ($entry.message // $entry.event // "Evento del Worker"),
        (if $entry.provider then "provider=" + ($entry.provider | tostring) else empty end),
        (if $entry.model then "model=" + ($entry.model | tostring) else empty end),
        (if $entry.durationMs then "duration=" + ($entry.durationMs | tostring) + "ms" else empty end),
        (if $entry.error.reason then "reason=" + ($entry.error.reason | tostring) else empty end),
        (if $entry.error.httpStatus then "http=" + ($entry.error.httpStatus | tostring) else empty end),
        (if $entry.error.action then "action=" + ($entry.error.action | tostring) else empty end),
        (if $entry.error.safeDetail then "detail=" + ($entry.error.safeDetail | tostring) else empty end)
      ] | map(select(. != null and . != "")) | join(" · ");
    .logs[]? as $log
    | ($log.message[0] // null) as $entry
    | if ($entry | type) == "object" and ($entry.event // null) != null
      then structured_line($log; $entry)
      else
        [
          (($log.timestamp / 1000 | todateiso8601) | short_time),
          ($log.level | level_label),
          "--------",
          ($log.message | map(if type == "string" then . else tojson end) | join(" "))
        ] | join(" · ")
      end
  '
)
