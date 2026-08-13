import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { validateHeadlessEnvironment } from "../src/features/headless-chat/tenant.ts";

test("the worker entrypoint does not import the local CLI", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /headless\/cli|\.env\.headless/);
});

test("headless environment accepts only the dedicated local target", async () => {
  const config = `[project]\nproject_id = "42day"\n[api]\nport = 54321\nschemas = ["public", "control", "tenant_template", "tenant_demo"]\n[db]\nport = 54322\n`;
  const env = {
    APP_ENV: "local",
    PARAHOY_HEADLESS_DEBUG: "true",
    PARAHOY_HEADLESS_LOCAL_PROJECT_ID: "42day",
    SUPABASE_URL: "http://127.0.0.1:54321",
  };
  assert.equal(validateHeadlessEnvironment({ env, configText: config }).dbPort, 54322);
  assert.throws(() => validateHeadlessEnvironment({ env: { ...env, SUPABASE_URL: "https://remote.example" }, configText: config }), /UNAUTHORIZED_TARGET_ENV/);
  assert.throws(() => validateHeadlessEnvironment({ env: { ...env, PARAHOY_HEADLESS_DEBUG: "false" }, configText: config }), /HEADLESS_DISABLED/);
  assert.throws(() => validateHeadlessEnvironment({ env: { ...env, SUPABASE_URL: "http://127.0.0.1:54399" }, configText: config }), /UNAUTHORIZED_TARGET_ENV/);
});

test("the dedicated environment template contains no operational secret", async () => {
  const template = await readFile(new URL("../.env.headless.local.example", import.meta.url), "utf8");
  assert.match(template, /APP_ENV=local/);
  assert.match(template, /PARAHOY_HEADLESS_DEBUG=true/);
  assert.doesNotMatch(template, /AIza[\w-]{20,}/);
});

test("the worker dry-run bundle contains no headless entrypoint, journal, fixture or debug surface", () => {
  const script = resolve(import.meta.dirname, "../../../scripts/bash/verify-no-headless-deploy.sh");
  const result = spawnSync(script, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "headless_surface_absent");
});
