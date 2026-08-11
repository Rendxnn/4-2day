-- Keep every registered tenant schema available to the Worker through
-- PostgREST. This is idempotent and also repairs tenants created before the
-- automatic refresh hook was introduced.
select control.refresh_postgrest_tenant_schemas();
