import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const apiDirectory = resolve(import.meta.dirname, "..");
const cliArguments = [
  "--experimental-loader", "./headless/resolve-loader.mjs",
  "--experimental-strip-types", "headless/cli.mjs",
];
const configuredGeminiModel = readConfiguredGeminiModel();

function readConfiguredGeminiModel() {
  try {
    return readFileSync(join(apiDirectory, ".env.headless.local"), "utf8")
      .match(/^GEMINI_MODEL\s*=\s*(.+)\s*$/m)?.[1]
      ?.replace(/^['"]|['"]$/g, "") ?? "gemini-2.5-flash";
  } catch {
    return "gemini-2.5-flash";
  }
}

test("real Gemini flow without fixed doubles completes a headless order", { skip: process.env.HEADLESS_REAL_E2E !== "1" }, (t) => {
  const journalDirectory = mkdtempSync(join(tmpdir(), "parahoy-headless-e2e-"));
  const journalPath = join(journalDirectory, "journal.json");
    const tenant = process.env.HEADLESS_REAL_TENANT ?? "headless-demo";
    const transcript = [];

  try {
    const run = (command) => {
      const result = spawnSync("node", cliArguments, {
        cwd: apiDirectory,
        input: `${JSON.stringify(command)}\n`,
        encoding: "utf8",
        env: { ...process.env, PARAHOY_HEADLESS_JOURNAL_PATH: journalPath },
      });
      assert.ok(result.stdout.trim(), result.stderr);
      const envelope = JSON.parse(result.stdout);
      return { envelope, stderr: result.stderr, exitCode: result.status };
    };

    const started = run({ version: 1, command: "start", tenant });
    assert.equal(started.envelope.status, "started", started.stderr);
    const sessionId = started.envelope.session.id;
    const turns = [
      ["real-e2e-001", "Hola, muéstrame el menú", "show_menu"],
      ["real-e2e-002", "Quiero una hamburguesa clásica", "add_product"],
      ["real-e2e-003", "¿Qué tengo en el pedido?", "get_order_status"],
      ["real-e2e-004", "Prefiero recogerlo en el local", "set_fulfillment"],
      ["real-e2e-005", "Mi nombre completo es Carlos E2E", "set_billing"],
      ["real-e2e-006", "Quiero pagar por transferencia", "set_payment_method"],
      ["real-e2e-007", "¿Cuál es el estado de mi pedido?", "get_order_status"],
      ["real-e2e-008", "Sí, confirma el pedido", "confirm_order"],
    ];

    for (const [turnId, text, operationType] of turns) {
      const result = run({ version: 1, command: "turn", tenant, sessionId, turnId, text });
      if (/provider_quota_exceeded|RESOURCE_EXHAUSTED/.test(result.stderr)) {
        if (result.envelope.status === "applied") {
          assert.equal(result.envelope.routing.ai.used, false);
          assert.equal(result.envelope.after?.order, null);
        }
        if (result.envelope.status === "indeterminate") {
          const recovered = run({ version: 1, command: "reconcile", tenant, sessionId, turnId, observedOutcome: "no_effects" });
          assert.notEqual(recovered.envelope.status, "rejected", `${JSON.stringify(recovered.envelope)}\n${recovered.stderr}`);
        }
        const inspectedAfterQuota = run({ version: 1, command: "inspect", tenant, sessionId });
        assert.equal(inspectedAfterQuota.envelope.after?.order ?? null, null);
        assert.equal(inspectedAfterQuota.envelope.effects?.every((effect) => effect.type !== "meta_message"), true);
        t.skip("Gemini quota exhausted; rerun HEADLESS_REAL_E2E=1 when provider quota is available.");
        return;
      }
      assert.equal(result.envelope.status, "applied", result.stderr);
      assert.equal(result.envelope.routing.ai.provider, "gemini", result.stderr);
      assert.equal(result.envelope.routing.ai.model, configuredGeminiModel);
      assert.deepEqual(result.envelope.routing.ai.operationTypes, [operationType], result.stderr);
      assert.equal(result.envelope.responses.every((response) => response.delivery === "captured"), true);
      assert.equal(result.envelope.effects.every((effect) => effect.type !== "meta_message"), true);
      assert.equal(result.envelope.effects.every((effect) => typeof effect.id === "string"), true);
      transcript.push({
        turnId,
        inbound: text,
        routing: result.envelope.routing?.ai,
        responses: result.envelope.responses?.map((response) => ({
          text: response.text,
          delivery: response.delivery,
          captureContext: response.captureContext,
          redacted: response.redacted,
          redactionCodes: response.redactionCodes,
        })),
        before: result.envelope.before,
        after: result.envelope.after,
        effects: result.envelope.effects?.map((effect) => ({ type: effect.type, status: effect.status, id: effect.id })),
      });
    }

    const repeated = run({
      version: 1,
      command: "turn",
      tenant,
      sessionId,
      turnId: "real-e2e-008",
      text: "Sí, confirma el pedido",
    });
    assert.equal(repeated.envelope.status, "repeated");
    assert.doesNotMatch(repeated.stderr, /ai\.provider\.attempt_started/);

    const conflict = run({
      version: 1,
      command: "turn",
      tenant,
      sessionId,
      turnId: "real-e2e-008",
      text: "Quiero cambiarlo",
    });
    assert.equal(conflict.envelope.error?.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(conflict.exitCode, 2);

    const inspected = run({ version: 1, command: "inspect", tenant, sessionId });
    assert.equal(inspected.envelope.status, "inspected");
    assert.equal(inspected.envelope.routing.ai.provider, "gemini");
    assert.equal(inspected.envelope.after?.order?.state, "pending_restaurant_confirmation");
    assert.equal(inspected.envelope.after?.order?.total, 18000);

    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const session = journal.sessions.find((candidate) => candidate.id === sessionId);
    assert.equal(session.turns.length, 8);
    assert.equal(session.turns.at(-1).routing.ai.operationTypes[0], "confirm_order");

    const schema = process.env.HEADLESS_REAL_SCHEMA ?? "tenant_headless_demo";
    assert.match(schema, /^tenant_[a-z0-9_]+$/);
    const databaseUrl = process.env.HEADLESS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const dbEvidence = spawnSync("psql", [
      databaseUrl,
      "-At",
      "-c",
      `select count(*) filter (where provider = 'headless'), count(*) filter (where provider <> 'headless') from ${schema}.messages where conversation_id = '${session.conversationId}';`,
    ], { encoding: "utf8", env: { ...process.env, PAGER: "cat" } });
    assert.equal(dbEvidence.status, 0, dbEvidence.stderr);
    assert.equal(dbEvidence.stdout.trim(), "16|0");

    const closed = run({ version: 1, command: "close", tenant, sessionId });
    assert.equal(closed.envelope.status, "closed");
    if (process.env.HEADLESS_REAL_E2E_TRANSCRIPT === "1") {
      console.error(JSON.stringify({ tenant, turns: transcript, inspect: inspected.envelope, close: closed.envelope }, null, 2));
    }
  } finally {
    rmSync(journalDirectory, { recursive: true, force: true });
  }
});
