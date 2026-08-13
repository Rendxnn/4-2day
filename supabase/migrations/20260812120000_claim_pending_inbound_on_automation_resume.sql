-- Shared normalized-chat checkpoints. No headless tables or schemas are created.
-- The functions are invoked only by the privileged backend and keep the tenant
-- schema derived from control.tenants rather than accepting an arbitrary schema.

do $$
declare
  tenant_record record;
begin
  for tenant_record in
    select schema_name from control.tenants where schema_name like 'tenant_%'
  loop
    execute format($sql$
      update %I.messages
      set status = 'processed'
      where direction = 'inbound' and status = 'logged'
        and coalesce(payload->'internal'->>'execution_manifest', '') = ''
    $sql$, tenant_record.schema_name);
  end loop;
end $$;

create or replace function control.claim_normalized_inbound(
  p_schema_name text,
  p_message_id uuid,
  p_manifest jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  tenant_exists boolean;
  message_id uuid;
  message_status text;
  message_payload jsonb;
begin
  select exists (
    select 1 from control.tenants
    where schema_name = p_schema_name and schema_name like 'tenant_%'
  ) into tenant_exists;
  if not tenant_exists then
    raise exception 'tenant_not_found';
  end if;

  execute format(
    'select id, status, payload from %I.messages where id = $1 for update',
    p_schema_name
  ) into message_id, message_status, message_payload using p_message_id;
  if message_id is null then
    raise exception 'message_not_found';
  end if;
  if message_status = 'processed' then
    return jsonb_build_object('status', 'repeated', 'message_id', message_id);
  end if;
  if message_status not in ('logged', 'processing') then
    raise exception 'message_not_claimable';
  end if;

  execute format(
    'update %I.messages set status = ''processing'', payload = jsonb_set(coalesce(payload, ''{}''::jsonb), ''{internal,execution_manifest}'', $1, true) where id = $2',
    p_schema_name
  ) using p_manifest, p_message_id;
  return jsonb_build_object('status', 'claimed', 'message_id', p_message_id);
end;
$$;

create or replace function control.finalize_normalized_inbound(
  p_schema_name text,
  p_message_id uuid,
  p_postconditions jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  message_id uuid;
  message_status text;
begin
  execute format('select id, status, payload from %I.messages where id = $1 for update', p_schema_name)
    into message_id, message_status using p_message_id;
  if message_id is null then raise exception 'message_not_found'; end if;
  if message_status = 'processed' then
    return jsonb_build_object('status', 'repeated', 'message_id', p_message_id);
  end if;
  execute format(
    'update %I.messages set status = ''processed'', payload = jsonb_set(coalesce(payload, ''{}''::jsonb), ''{internal,postconditions}'', $1, true) where id = $2',
    p_schema_name
  ) using p_postconditions, p_message_id;
  return jsonb_build_object('status', 'processed', 'message_id', p_message_id);
end;
$$;

create or replace function control.reconcile_normalized_inbound(
  p_schema_name text,
  p_message_id uuid,
  p_observed_outcome text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  message_id uuid;
  message_status text;
  message_payload jsonb;
  manifest jsonb;
  postconditions jsonb;
begin
  execute format('select id, status, payload from %I.messages where id = $1 for update', p_schema_name)
    into message_id, message_status, message_payload using p_message_id;
  if message_id is null then raise exception 'message_not_found'; end if;
  manifest := message_payload->'internal'->'execution_manifest';
  postconditions := message_payload->'internal'->'postconditions';
  if manifest is null then
    return jsonb_build_object('status', 'indeterminate', 'reason_code', 'MANIFEST_UNAVAILABLE');
  end if;
  if message_status = 'processed' and postconditions is not null then
    return jsonb_build_object('status', 'applied', 'reason_code', 'ALL_POSTCONDITIONS_SATISFIED');
  end if;
  if p_observed_outcome = 'no_effects' and message_status = 'processing' then
    execute format('update %I.messages set status = ''failed'' where id = $1', p_schema_name)
      using p_message_id;
    return jsonb_build_object('status', 'failed', 'reason_code', 'NO_POSTCONDITIONS_SATISFIED');
  end if;
  return jsonb_build_object('status', 'indeterminate', 'reason_code', 'EVIDENCE_INSUFFICIENT');
end;
$$;

revoke execute on function control.claim_normalized_inbound(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function control.finalize_normalized_inbound(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function control.reconcile_normalized_inbound(text, uuid, text) from public, anon, authenticated;
grant execute on function control.claim_normalized_inbound(text, uuid, jsonb) to service_role;
grant execute on function control.finalize_normalized_inbound(text, uuid, jsonb) to service_role;
grant execute on function control.reconcile_normalized_inbound(text, uuid, text) to service_role;
