#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
config_path="$repo_root/supabase/config.toml"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase_cli_missing" >&2
  exit 2
fi

if ! supabase status >/dev/null 2>&1; then
  echo "supabase_local_stack_unavailable" >&2
  exit 2
fi

schema_output="$(supabase db query --local --output json \
  "select schema_name from control.tenants where schema_name like 'tenant_%' order by schema_name;" 2>/dev/null)"

tenant_schemas="$(printf '%s' "$schema_output" | sed -nE 's/.*"schema_name"[[:space:]]*:[[:space:]]*"([a-z0-9_]+)".*/\1/p' | sort -u)"
if [[ -z "$tenant_schemas" ]]; then
  echo "no_local_tenant_schemas" >&2
  exit 2
fi

# Keep PostgREST's authoritative role setting aligned with control.tenants.
# Without this refresh a newly provisioned schema exists in Postgres but is
# rejected by the REST gateway before the application can resolve the tenant.
if ! supabase db query --local --output json \
  "select control.refresh_postgrest_tenant_schemas();" >/dev/null 2>&1; then
  echo "postgrest_schema_refresh_failed" >&2
  exit 2
fi

required='"public", "graphql_public", "control", "tenant_template"'
for schema in $tenant_schemas; do
  required+=", \"$schema\""
done

temporary_path="${config_path}.tmp.$$.headless"
sed -E "s/^schemas = .*/schemas = [$required]/" "$config_path" > "$temporary_path"
mv "$temporary_path" "$config_path"

echo "schemas_synchronized_restart_required"
