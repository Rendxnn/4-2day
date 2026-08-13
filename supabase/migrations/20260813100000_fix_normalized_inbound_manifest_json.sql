-- Fix nested JSON writes for normalized-chat checkpoints.
-- jsonb_set does not create missing intermediate objects, so initialize
-- payload.internal before writing execution_manifest or postconditions.

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
  message_direction text;
  message_provider text;
  message_payload jsonb;
begin
  if jsonb_typeof(p_manifest) <> 'object'
     or p_manifest->>'version' <> '1'
     or length(coalesce(p_manifest->>'digest', '')) <> 64
     or jsonb_typeof(p_manifest->'operationTypes') <> 'array'
     or jsonb_typeof(p_manifest->'canonicalIds') <> 'array'
     or jsonb_typeof(p_manifest->'idempotencyKeys') <> 'array'
     or jsonb_typeof(p_manifest->'preconditions') <> 'array'
     or jsonb_typeof(p_manifest->'postconditionFingerprints') <> 'array' then
    raise exception 'manifest_invalid';
  end if;
  select exists (
    select 1 from control.tenants
    where schema_name = p_schema_name and schema_name like 'tenant_%'
  ) into tenant_exists;
  if not tenant_exists then
    raise exception 'tenant_not_found';
  end if;

  execute format(
    'select id, status, direction, provider, payload from %I.messages where id = $1 for update',
    p_schema_name
  ) into message_id, message_status, message_direction, message_provider, message_payload using p_message_id;
  if message_id is null then
    raise exception 'message_not_found';
  end if;
  if message_direction <> 'inbound' or message_provider not in ('headless', 'whatsapp_cloud') then
    raise exception 'message_not_claimable';
  end if;
  if message_status = 'processed' then
    return jsonb_build_object('status', 'repeated', 'message_id', message_id);
  end if;
  if message_status not in ('logged', 'processing') then
    raise exception 'message_not_claimable';
  end if;
  if message_status = 'processing'
     and message_payload->'internal'->'execution_manifest' is not null
     and message_payload->'internal'->'execution_manifest' <> p_manifest then
    raise exception 'manifest_conflict';
  end if;

  execute format(
    'update %I.messages
        set status = ''processing'',
            payload = jsonb_set(
              jsonb_set(coalesce(payload, ''{}''::jsonb), ''{internal}'', coalesce(payload->''internal'', ''{}''::jsonb), true),
              ''{internal,execution_manifest}'', $1, true
            )
      where id = $2',
    p_schema_name
  ) using p_manifest, p_message_id;
  return jsonb_build_object('status', 'claimed', 'message_id', p_message_id);
end;
$$;

-- Claim exactly one pending headless inbound when automation resumes. The row
-- lock makes concurrent dashboard requests converge on the same message; all
-- older pending messages are explicitly superseded rather than replayed.
create or replace function control.claim_pending_headless_inbound(
  p_schema_name text,
  p_conversation_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  tenant_exists boolean;
  latest_id uuid;
  latest_provider_message_id text;
  latest_message_type text;
  latest_text text;
  latest_payload jsonb;
begin
  select exists (
    select 1 from control.tenants
    where schema_name = p_schema_name and schema_name like 'tenant_%'
  ) into tenant_exists;
  if not tenant_exists then raise exception 'tenant_not_found'; end if;

  execute format($sql$
    update %I.messages
       set status = 'superseded'
     where conversation_id = $1
       and direction = 'inbound'
       and provider = 'headless'
       and status = 'logged'
       and id <> coalesce((
         select id from %I.messages
          where conversation_id = $1
            and direction = 'inbound'
            and provider = 'headless'
            and status = 'logged'
            and text is not null
          order by created_at desc, id desc
          limit 1
       ), '00000000-0000-0000-0000-000000000000'::uuid)
  $sql$, p_schema_name, p_schema_name) using p_conversation_id;

  execute format($sql$
    select id, provider_message_id, message_type, text, payload, status
      from %I.messages
     where conversation_id = $1
       and direction = 'inbound'
       and provider = 'headless'
       and status = 'logged'
       and text is not null
     order by created_at desc, id desc
     limit 1
     for update
  $sql$, p_schema_name)
    into latest_id, latest_provider_message_id, latest_message_type, latest_text, latest_payload
    using p_conversation_id;

  if latest_id is null then
    return jsonb_build_object('status', 'none');
  end if;

  execute format($sql$
    update %I.messages
       set status = 'processing',
           payload = jsonb_set(
             jsonb_set(coalesce(payload, '{}'::jsonb), '{internal}', coalesce(payload->'internal', '{}'::jsonb), true),
             '{internal,pending_claim}', jsonb_build_object('source', 'manual_resume', 'claimed_at', now()), true
           )
     where id = $1 and status = 'logged'
  $sql$, p_schema_name) using latest_id;

  return jsonb_build_object(
    'status', 'claimed',
    'id', latest_id,
    'provider_message_id', latest_provider_message_id,
    'message_type', latest_message_type,
    'text', latest_text,
    'payload', latest_payload
  );
end;
$$;

revoke execute on function control.claim_pending_headless_inbound(text, uuid) from public, anon, authenticated;
grant execute on function control.claim_pending_headless_inbound(text, uuid) to service_role;

-- Reconciliation must validate durable evidence instead of trusting the caller's
-- observation or a caller-supplied postconditions object.
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
  message_conversation_id uuid;
  message_payload jsonb;
  manifest jsonb;
  effect_ids jsonb;
  invalid_effect boolean;
begin
  execute format('select id, status, conversation_id, payload from %I.messages where id = $1 for update', p_schema_name)
    into message_id, message_status, message_conversation_id, message_payload using p_message_id;
  if message_id is null then raise exception 'message_not_found'; end if;
  if message_status = 'processed' then
    return jsonb_build_object('status', 'repeated', 'message_id', p_message_id);
  end if;
  if message_status <> 'processing' then raise exception 'message_not_finalizable'; end if;
  manifest := message_payload->'internal'->'execution_manifest';
  effect_ids := p_postconditions->'effectIds';
  if manifest is null
     or p_postconditions->>'manifestDigest' <> manifest->>'digest'
     or p_postconditions->'postconditionFingerprints' <> manifest->'postconditionFingerprints'
     or jsonb_typeof(effect_ids) <> 'array'
     or jsonb_array_length(effect_ids) = 0 then
    raise exception 'postconditions_invalid';
  end if;

  select exists (
    select 1 from jsonb_array_elements_text(effect_ids) value
    where value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) into invalid_effect;
  if invalid_effect then raise exception 'postconditions_invalid'; end if;

  execute format($sql$
    select count(*) <> jsonb_array_length($1)
      from %I.messages
     where id = any(array(select value::uuid from jsonb_array_elements_text($1)))
       and conversation_id = $2
  $sql$, p_schema_name) into invalid_effect using effect_ids, message_conversation_id;
  if invalid_effect then raise exception 'postconditions_effect_missing'; end if;

  execute format(
    'update %I.messages set status = ''processed'', payload = jsonb_set(jsonb_set(coalesce(payload, ''{}''::jsonb), ''{internal}'', coalesce(payload->''internal'', ''{}''::jsonb), true), ''{internal,postconditions}'', $1, true) where id = $2',
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
  message_conversation_id uuid;
  message_payload jsonb;
  manifest jsonb;
  postconditions jsonb;
  effect_ids jsonb;
  effect_count integer := 0;
  invalid_effect boolean := false;
begin
  if p_observed_outcome not in ('effects_applied', 'no_effects') then
    raise exception 'invalid_observation';
  end if;
  execute format('select id, status, conversation_id, payload from %I.messages where id = $1 for update', p_schema_name)
    into message_id, message_status, message_conversation_id, message_payload using p_message_id;
  if message_id is null then raise exception 'message_not_found'; end if;
  manifest := message_payload->'internal'->'execution_manifest';
  postconditions := message_payload->'internal'->'postconditions';
  if jsonb_typeof(manifest) <> 'object'
     or manifest->>'version' <> '1'
     or length(coalesce(manifest->>'digest', '')) <> 64
     or jsonb_typeof(manifest->'postconditionFingerprints') <> 'array' then
    return jsonb_build_object('status', 'indeterminate', 'reason_code', 'MANIFEST_UNAVAILABLE');
  end if;
  if message_status = 'processed' and jsonb_typeof(postconditions) = 'object' then
    effect_ids := postconditions->'effectIds';
    if postconditions->>'manifestDigest' = manifest->>'digest'
       and postconditions->'postconditionFingerprints' = manifest->'postconditionFingerprints'
       and jsonb_typeof(effect_ids) = 'array'
       and jsonb_array_length(effect_ids) > 0 then
      select exists (
        select 1 from jsonb_array_elements_text(effect_ids) value
        where value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ) into invalid_effect;
      if not invalid_effect then
        execute format($sql$
          select count(*)
            from %I.messages
           where id = any(array(select value::uuid from jsonb_array_elements_text($1)))
             and conversation_id = $2
        $sql$, p_schema_name) into effect_count using effect_ids, message_conversation_id;
        if effect_count = jsonb_array_length(effect_ids) then
          return jsonb_build_object('status', 'applied', 'reason_code', 'ALL_POSTCONDITIONS_SATISFIED');
        end if;
      end if;
    end if;
    return jsonb_build_object('status', 'indeterminate', 'reason_code', 'EVIDENCE_CONTRADICTORY');
  end if;
  if p_observed_outcome = 'no_effects' and message_status = 'processing' and postconditions is null then
    execute format('update %I.messages set status = ''failed'' where id = $1', p_schema_name) using p_message_id;
    return jsonb_build_object('status', 'failed', 'reason_code', 'NO_POSTCONDITIONS_SATISFIED');
  end if;
  return jsonb_build_object('status', 'indeterminate', 'reason_code', 'EVIDENCE_INSUFFICIENT');
end;
$$;

revoke execute on function control.reconcile_normalized_inbound(text, uuid, text) from public, anon, authenticated;
grant execute on function control.reconcile_normalized_inbound(text, uuid, text) to service_role;
