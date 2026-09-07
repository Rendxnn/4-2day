create table control.dynamic_link_batches (
  id uuid primary key default gen_random_uuid(),
  creation_request_id uuid not null unique,
  label text not null check (length(trim(label)) between 1 and 160),
  supplier_reference text,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table control.dynamic_link_units (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique check (public_code ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$'),
  batch_id uuid references control.dynamic_link_batches(id) on delete restrict,
  label text not null check (length(trim(label)) between 1 and 160),
  tenant_id uuid references control.tenants(id) on delete restrict,
  location_id uuid,
  location_label_snapshot text,
  destination_type text check (destination_type in ('google_review', 'website', 'menu', 'whatsapp', 'instagram')),
  destination_url text,
  status text not null default 'available' check (status in ('available', 'active', 'suspended', 'archived')),
  revision integer not null default 1 check (revision > 0),
  nfc_uid text unique,
  qr_printed_at timestamptz,
  nfc_programmed_at timestamptz,
  nfc_verified_at timestamptz,
  nfc_locked_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((destination_type is null) = (destination_url is null)),
  check (status <> 'active' or destination_url is not null)
);

create table control.dynamic_link_audit_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references control.dynamic_link_units(id) on delete restrict,
  batch_id uuid references control.dynamic_link_batches(id) on delete restrict,
  actor_user_id uuid,
  event_type text not null check (event_type in ('created', 'updated', 'activated', 'suspended', 'archived', 'qr_printed', 'nfc_programmed', 'nfc_verified', 'nfc_locked', 'tenant_suspended')),
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index dynamic_link_units_status_updated_idx on control.dynamic_link_units (status, updated_at desc);
create index dynamic_link_units_tenant_status_idx on control.dynamic_link_units (tenant_id, status);
create index dynamic_link_units_batch_idx on control.dynamic_link_units (batch_id, created_at);
create index dynamic_link_audit_events_unit_created_idx on control.dynamic_link_audit_events (unit_id, created_at desc);

create or replace function control.create_dynamic_link_batch(
  p_request_id uuid,
  p_label text,
  p_supplier_reference text,
  p_notes text,
  p_actor_user_id uuid,
  p_units jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch control.dynamic_link_batches%rowtype;
  v_unit record;
  v_unit_row control.dynamic_link_units%rowtype;
begin
  if p_request_id is null or p_actor_user_id is null then
    raise exception 'dynamic_link_request_or_actor_required';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) not between 1 and 500 then
    raise exception 'dynamic_link_batch_size_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_request_id::text));
  select * into v_batch from control.dynamic_link_batches where creation_request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'batch', to_jsonb(v_batch),
      'units', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at, u.public_code) from control.dynamic_link_units u where u.batch_id = v_batch.id), '[]'::jsonb)
    );
  end if;

  if p_label is null or length(trim(p_label)) not between 1 and 160 then
    raise exception 'dynamic_link_batch_label_invalid';
  end if;

  for v_unit in select * from jsonb_to_recordset(p_units) as x(public_code text, label text)
  loop
    if v_unit.public_code !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$' then
      raise exception 'dynamic_link_public_code_invalid';
    end if;
    if v_unit.label is null or length(trim(v_unit.label)) not between 1 and 160 then
      raise exception 'dynamic_link_label_invalid';
    end if;
  end loop;

  insert into control.dynamic_link_batches (creation_request_id, label, supplier_reference, notes, created_by)
  values (p_request_id, trim(p_label), nullif(trim(p_supplier_reference), ''), nullif(trim(p_notes), ''), p_actor_user_id)
  returning * into v_batch;

  for v_unit in select * from jsonb_to_recordset(p_units) as x(public_code text, label text)
  loop
    insert into control.dynamic_link_units (public_code, batch_id, label)
    values (v_unit.public_code, v_batch.id, trim(v_unit.label))
    returning * into v_unit_row;

    insert into control.dynamic_link_audit_events (unit_id, batch_id, actor_user_id, event_type, after_state)
    values (v_unit_row.id, v_batch.id, p_actor_user_id, 'created', to_jsonb(v_unit_row));
  end loop;

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'units', (select jsonb_agg(to_jsonb(u) order by u.created_at, u.public_code) from control.dynamic_link_units u where u.batch_id = v_batch.id)
  );
end;
$$;

create or replace function control.update_dynamic_link_unit(
  p_unit_id uuid,
  p_expected_revision integer,
  p_actor_user_id uuid,
  p_event_type text,
  p_patch jsonb default '{}'::jsonb
) returns control.dynamic_link_units
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current control.dynamic_link_units%rowtype;
  v_updated control.dynamic_link_units%rowtype;
  v_status text;
  v_destination_type text;
  v_destination_url text;
begin
  select * into v_current from control.dynamic_link_units where id = p_unit_id for update;
  if not found then raise exception 'dynamic_link_not_found'; end if;
  if p_actor_user_id is null then raise exception 'dynamic_link_actor_required'; end if;
  if p_expected_revision is distinct from v_current.revision then raise exception 'dynamic_link_stale'; end if;
  if v_current.status = 'archived' then raise exception 'dynamic_link_archived'; end if;
  if p_event_type not in ('updated', 'activated', 'suspended', 'archived', 'qr_printed', 'nfc_programmed', 'nfc_verified', 'nfc_locked') then
    raise exception 'dynamic_link_event_invalid';
  end if;

  v_status := coalesce(nullif(p_patch ->> 'status', ''), v_current.status);
  v_destination_type := case when p_patch ? 'destination_type' then nullif(p_patch ->> 'destination_type', '') else v_current.destination_type end;
  v_destination_url := case when p_patch ? 'destination_url' then nullif(p_patch ->> 'destination_url', '') else v_current.destination_url end;

  if v_status not in ('available', 'active', 'suspended', 'archived') then raise exception 'dynamic_link_status_invalid'; end if;
  if (v_destination_type is null) <> (v_destination_url is null) then raise exception 'dynamic_link_destination_incomplete'; end if;
  if v_status = 'active' and v_destination_url is null then raise exception 'dynamic_link_destination_required'; end if;
  if v_current.status = 'available' and v_status not in ('available', 'active', 'suspended', 'archived') then raise exception 'dynamic_link_transition_invalid'; end if;
  if v_current.status = 'active' and v_status not in ('active', 'suspended', 'archived') then raise exception 'dynamic_link_transition_invalid'; end if;
  if v_current.status = 'suspended' and v_status not in ('suspended', 'active', 'archived') then raise exception 'dynamic_link_transition_invalid'; end if;

  update control.dynamic_link_units
  set
    label = case when p_patch ? 'label' then trim(p_patch ->> 'label') else v_current.label end,
    tenant_id = case when p_patch ? 'tenant_id' then nullif(p_patch ->> 'tenant_id', '')::uuid else v_current.tenant_id end,
    location_id = case when p_patch ? 'location_id' then nullif(p_patch ->> 'location_id', '')::uuid else v_current.location_id end,
    location_label_snapshot = case when p_patch ? 'location_label_snapshot' then nullif(p_patch ->> 'location_label_snapshot', '') else v_current.location_label_snapshot end,
    destination_type = v_destination_type,
    destination_url = v_destination_url,
    status = v_status,
    nfc_uid = case when p_patch ? 'nfc_uid' then nullif(p_patch ->> 'nfc_uid', '') else v_current.nfc_uid end,
    qr_printed_at = case when p_patch ? 'qr_printed_at' then (p_patch ->> 'qr_printed_at')::timestamptz else v_current.qr_printed_at end,
    nfc_programmed_at = case when p_patch ? 'nfc_programmed_at' then (p_patch ->> 'nfc_programmed_at')::timestamptz else v_current.nfc_programmed_at end,
    nfc_verified_at = case when p_patch ? 'nfc_verified_at' then (p_patch ->> 'nfc_verified_at')::timestamptz else v_current.nfc_verified_at end,
    nfc_locked_at = case when p_patch ? 'nfc_locked_at' then (p_patch ->> 'nfc_locked_at')::timestamptz else v_current.nfc_locked_at end,
    activated_at = case when v_status = 'active' and v_current.status <> 'active' then now() else v_current.activated_at end,
    revision = v_current.revision + 1,
    updated_at = now()
  where id = p_unit_id
  returning * into v_updated;

  insert into control.dynamic_link_audit_events (unit_id, batch_id, actor_user_id, event_type, before_state, after_state, metadata)
  values (v_updated.id, v_updated.batch_id, p_actor_user_id, p_event_type, to_jsonb(v_current), to_jsonb(v_updated), coalesce(p_patch -> 'metadata', '{}'::jsonb));

  return v_updated;
end;
$$;

create or replace function control.suspend_dynamic_links_for_inactive_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('inactive', 'suspended') and old.status is distinct from new.status then
    with changed as (
      update control.dynamic_link_units
      set status = 'suspended', revision = revision + 1, updated_at = now()
      where tenant_id = new.id and status = 'active'
      returning *
    )
    insert into control.dynamic_link_audit_events (unit_id, batch_id, actor_user_id, event_type, before_state, after_state, metadata)
    select id, batch_id, null, 'tenant_suspended', jsonb_build_object('status', 'active'), to_jsonb(changed), jsonb_build_object('tenant_id', new.id, 'tenant_status', new.status)
    from changed;
  end if;
  return new;
end;
$$;

drop trigger if exists suspend_dynamic_links_for_inactive_tenant on control.tenants;
create trigger suspend_dynamic_links_for_inactive_tenant
after update of status on control.tenants
for each row execute function control.suspend_dynamic_links_for_inactive_tenant();

alter table control.dynamic_link_batches enable row level security;
alter table control.dynamic_link_units enable row level security;
alter table control.dynamic_link_audit_events enable row level security;
alter table control.dynamic_link_batches force row level security;
alter table control.dynamic_link_units force row level security;
alter table control.dynamic_link_audit_events force row level security;

revoke all on table control.dynamic_link_batches, control.dynamic_link_units, control.dynamic_link_audit_events from anon, authenticated;
grant all on table control.dynamic_link_batches, control.dynamic_link_units, control.dynamic_link_audit_events to service_role;
revoke all on function control.create_dynamic_link_batch(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function control.update_dynamic_link_unit(uuid, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function control.create_dynamic_link_batch(uuid, text, text, text, uuid, jsonb) to service_role;
grant execute on function control.update_dynamic_link_unit(uuid, integer, uuid, text, jsonb) to service_role;
