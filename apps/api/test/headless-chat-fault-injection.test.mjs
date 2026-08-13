import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { deriveReconciliationEvidence, reconcileNormalizedChatTurn } from "../src/features/chat-routing/reconcile-normalized-chat-turn.ts";

const databaseUrl = process.env.HEADLESS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test("CLI and dashboard use the same all/none/partial decision", () => {
  const manifest = {
    version: 1,
    digest: "a".repeat(64),
    operationTypes: ["add_product"],
    canonicalIds: ["menu-1"],
    idempotencyKeys: ["headless:fault:1"],
    preconditions: ["conversation.state:awaiting_mode_selection"],
    postconditionFingerprints: ["draft_order:" + "b".repeat(64)],
  };
  const payload = (postconditions) => ({ internal: { execution_manifest: manifest, ...(postconditions ? { postconditions } : {}) } });
  const scenarios = [
    ["processed", payload({ manifestDigest: manifest.digest, postconditionFingerprints: manifest.postconditionFingerprints, effectIds: ["message-1"] }), "effects_applied"],
    ["failed", payload(null), "no_effects"],
    ["processing", payload({ manifestDigest: manifest.digest, postconditionFingerprints: ["draft_order:" + "c".repeat(64)] }), "effects_applied"],
  ];

  for (const [status, data, observation] of scenarios) {
    const evidence = deriveReconciliationEvidence({ messageStatus: status, payload: data });
    const cliDecision = reconcileNormalizedChatTurn({ observation, evidence });
    const dashboardDecision = reconcileNormalizedChatTurn({ observation, evidence });
    assert.deepEqual(dashboardDecision, cliDecision);
  }
});

test("local RPC fault injection preserves none/partial/all boundaries", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, () => {
  const migration = new URL("../../../supabase/migrations/20260813100000_fix_normalized_inbound_manifest_json.sql", import.meta.url).pathname;
  const applied = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", migration], { encoding: "utf8", env: { ...process.env, PAGER: "cat" } });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);

  const sql = String.raw`
begin;
do $$
declare
  conversation_id uuid;
  message_id uuid;
  outbound_id uuid;
  decision jsonb;
  manifest jsonb := jsonb_build_object(
    'version', 1,
    'digest', repeat('d', 64),
    'operationTypes', jsonb_build_array('add_product'),
    'canonicalIds', jsonb_build_array('menu-fault'),
    'idempotencyKeys', jsonb_build_array('headless:fault:rpc'),
    'preconditions', jsonb_build_array('conversation.state:awaiting_mode_selection'),
    'postconditionFingerprints', jsonb_build_array('draft_order:' || repeat('e', 64))
  );
begin
  select c.id into conversation_id from tenant_headless_demo.conversations c order by c.created_at desc limit 1;
  if conversation_id is null then raise exception 'no_conversation_fixture'; end if;

  insert into tenant_headless_demo.messages (conversation_id,direction,provider,provider_message_id,message_type,text,payload,status)
    values (conversation_id,'inbound','headless','headless:fault:none','text','fault','{}'::jsonb,'logged') returning id into message_id;
  perform control.claim_normalized_inbound('tenant_headless_demo', message_id, manifest);
  decision := control.reconcile_normalized_inbound('tenant_headless_demo', message_id, 'no_effects');
  if decision->>'status' <> 'failed' then raise exception 'none_not_failed:%', decision; end if;

  insert into tenant_headless_demo.messages (conversation_id,direction,provider,provider_message_id,message_type,text,payload,status)
    values (conversation_id,'inbound','headless','headless:fault:partial','text','fault','{}'::jsonb,'logged') returning id into message_id;
  perform control.claim_normalized_inbound('tenant_headless_demo', message_id, manifest);
  update tenant_headless_demo.messages
    set payload = jsonb_set(jsonb_set(payload,'{internal}',jsonb_build_object(),true),'{internal,postconditions}',jsonb_build_object('partial',true),true)
    where id = message_id;
  decision := control.reconcile_normalized_inbound('tenant_headless_demo', message_id, 'effects_applied');
  if decision->>'status' <> 'indeterminate' then raise exception 'partial_not_indeterminate:%', decision; end if;

  insert into tenant_headless_demo.messages (conversation_id,direction,provider,provider_message_id,message_type,text,payload,status)
    values (conversation_id,'inbound','headless','headless:fault:all','text','fault','{}'::jsonb,'logged') returning id into message_id;
  perform control.claim_normalized_inbound('tenant_headless_demo', message_id, manifest);
  insert into tenant_headless_demo.messages (conversation_id,direction,provider,provider_message_id,message_type,text,payload,status)
    values (conversation_id,'outbound','headless','headless:fault:all:response','text','captured','{}'::jsonb,'captured') returning id into outbound_id;
  perform control.finalize_normalized_inbound('tenant_headless_demo', message_id, jsonb_build_object('manifestDigest',manifest->>'digest','postconditionFingerprints',manifest->'postconditionFingerprints','effectIds',jsonb_build_array(message_id::text, outbound_id::text)));
  decision := control.reconcile_normalized_inbound('tenant_headless_demo', message_id, 'effects_applied');
  if decision->>'status' <> 'applied' then raise exception 'all_not_applied:%', decision; end if;
end $$;
rollback;
`;
  const checked = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: { ...process.env, PAGER: "cat" } });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});
