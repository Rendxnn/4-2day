import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const migration = resolve(repoRoot, "supabase/migrations/20260813100000_fix_normalized_inbound_manifest_json.sql");
const databaseUrl = process.env.HEADLESS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test("local migration preserves nested manifest and postconditions", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, () => {
  assert.equal(existsSync(migration), true);

  const applied = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", migration], {
    encoding: "utf8",
    env: { ...process.env, PAGER: "cat" },
  });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);

  const sql = String.raw`
begin;
do $$
declare
  conversation_id uuid;
  message_id uuid;
  manifest jsonb := jsonb_build_object(
    'version', 1,
    'digest', repeat('a', 64),
    'operationTypes', jsonb_build_array('add_product'),
    'canonicalIds', jsonb_build_array('menu-test'),
    'idempotencyKeys', jsonb_build_array('headless:integration:manifest'),
    'preconditions', jsonb_build_array('conversation.state:awaiting_mode_selection'),
    'postconditionFingerprints', jsonb_build_array('draft_order:' || repeat('b', 64))
  );
  stored_payload jsonb;
  older_id uuid;
  latest_id uuid;
  claim_result jsonb;
  older_status text;
  latest_status text;
begin
  select c.id into conversation_id
    from tenant_headless_demo.conversations c
    order by c.created_at desc
    limit 1;
  if conversation_id is null then raise exception 'no_conversation_fixture'; end if;

  insert into tenant_headless_demo.messages
    (conversation_id, direction, provider, provider_message_id, message_type, text, payload, status)
  values
    (conversation_id, 'inbound', 'headless', 'headless:integration:manifest', 'text', 'integration', '{}'::jsonb, 'logged')
  returning id into message_id;

  perform control.claim_normalized_inbound('tenant_headless_demo', message_id, manifest);
  select payload into stored_payload from tenant_headless_demo.messages where id = message_id;
  if stored_payload->'internal'->'execution_manifest' <> manifest then
    raise exception 'manifest_not_nested';
  end if;

  perform control.finalize_normalized_inbound(
    'tenant_headless_demo',
    message_id,
    jsonb_build_object(
      'manifestDigest', manifest->>'digest',
      'postconditionFingerprints', manifest->'postconditionFingerprints',
      'effectIds', jsonb_build_array(message_id::text),
      'conversationState', 'awaiting_more_items',
      'responseCount', 1
    )
  );
  select payload into stored_payload from tenant_headless_demo.messages where id = message_id;
  if stored_payload->'internal'->'postconditions'->>'manifestDigest' <> repeat('a', 64) then
    raise exception 'postconditions_not_nested';
  end if;

  insert into tenant_headless_demo.messages
      (conversation_id, direction, provider, provider_message_id, message_type, text, payload, status, created_at)
  values
      (conversation_id, 'inbound', 'headless', 'headless:integration:pending:old', 'text', 'old', '{}'::jsonb, 'logged', now() - interval '2 seconds')
  returning id into older_id;
  insert into tenant_headless_demo.messages
      (conversation_id, direction, provider, provider_message_id, message_type, text, payload, status, created_at)
  values
      (conversation_id, 'inbound', 'headless', 'headless:integration:pending:new', 'text', 'new', '{}'::jsonb, 'logged', now())
  returning id into latest_id;

  claim_result := control.claim_pending_headless_inbound('tenant_headless_demo', conversation_id);
  if claim_result->>'status' <> 'claimed' or (claim_result->>'id')::uuid <> latest_id then
    raise exception 'pending_claim_wrong:%', claim_result;
  end if;
  select status into older_status from tenant_headless_demo.messages where id = older_id;
  select status into latest_status from tenant_headless_demo.messages where id = latest_id;
  if older_status <> 'superseded' or latest_status <> 'processing' then
    raise exception 'pending_claim_states:%:%', older_status, latest_status;
  end if;
end $$;
rollback;
`;
  const checked = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PAGER: "cat" },
  });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});
