do $$
declare
  target_schema text;
begin
  for target_schema in
    select 'tenant_template'
    union
    select schema_name
    from control.tenants
    where schema_name like 'tenant_%'
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = target_schema
        and table_name = 'locations'
    ) then
      execute format(
        'alter table %I.locations
          add column if not exists public_profile_enabled boolean not null default true,
          add column if not exists public_profile_headline text,
          add column if not exists whatsapp_contact text,
          add column if not exists instagram_url text,
          add column if not exists facebook_url text,
          add column if not exists tiktok_url text,
          add column if not exists website_url text,
          add column if not exists maps_url text,
          add column if not exists survey_url text',
        target_schema
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
