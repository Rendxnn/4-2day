import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseHeadlessCommand } from "../src/features/headless-chat/contracts.ts";
import { assertLocalSupabaseResetTarget } from "./support/headless-chat-harness.mjs";

test("schema cannot select a tenant schema directly", () => {
  assert.throws(() => parseHeadlessCommand({ version: 1, command: "start", tenant: "demo", schema: "tenant_other" }), /INVALID_COMMAND/);
});

test("local cleanup accepts only the configured loopback project", async () => {
  const configText = await readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
  const target = assertLocalSupabaseResetTarget({
    configText,
    env: {
      PARAHOY_HEADLESS_LOCAL_PROJECT_ID: "42day",
      SUPABASE_URL: "http://127.0.0.1:54321",
    },
  });
  assert.deepEqual(target.allowedTenants, ["headless-demo", "headless-isolation-b"]);
  assert.equal(target.resetCommand, "supabase db reset --local");
});

test("local cleanup rejects a remote endpoint", async () => {
  const configText = await readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
  assert.throws(
    () => assertLocalSupabaseResetTarget({
      configText,
      env: { PARAHOY_HEADLESS_LOCAL_PROJECT_ID: "42day", SUPABASE_URL: "https://project.supabase.co" },
    }),
    /LOCAL_RESET_ENDPOINT_REQUIRED/,
  );
});

test("local reset helper validates and remains dry-run by default", () => {
  const script = fileURLToPath(new URL("../../../scripts/bash/reset-local-headless-chat.sh", import.meta.url));
  const checked = spawnSync(script, ["--check"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /headless_local_reset_target_validated/);
  assert.match(checked.stdout, /no_reset_performed=true/);

  const rejected = spawnSync(script, ["--reset", "--confirm", "wrong"], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /local-headless-reset/);
});
