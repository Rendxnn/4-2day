import assert from "node:assert/strict";
import test from "node:test";
import {
  DynamicLinkValidationError,
  buildDynamicLinkUrl,
  generateDynamicLinkCode,
  validateDynamicLinkDestination,
} from "../../../packages/core/src/dynamic-links.ts";
import app from "../src/index.ts";

const env = {
  APP_ENV: "test",
  DYNAMIC_LINK_BASE_URL: "https://go.thaledon.com",
  DASHBOARD_ALLOWED_ORIGINS: "",
  META_VERIFY_TOKEN: "test",
  META_ACCESS_TOKEN: "test",
  META_PHONE_NUMBER_ID: "test",
  META_WABA_ID: "test",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "test",
  SUPABASE_SERVICE_ROLE_KEY: "test",
};

test("the permanent URL uses a safe, normalized code", () => {
  const code = generateDynamicLinkCode(new Uint8Array(12).fill(31));
  assert.equal(code, "ZZZZZZZZZZZZ");
  assert.equal(buildDynamicLinkUrl("https://go.thaledon.com", code), "https://go.thaledon.com/r/ZZZZZZZZZZZZ");
  assert.throws(() => buildDynamicLinkUrl("http://go.thaledon.com", code), DynamicLinkValidationError);
});

test("destinations only allow public HTTPS and official hosts for typed destinations", () => {
  assert.equal(
    validateDynamicLinkDestination({ type: "whatsapp", url: "https://wa.me/573001234567", redirectHost: "go.thaledon.com" }),
    "https://wa.me/573001234567",
  );
  assert.throws(
    () => validateDynamicLinkDestination({ type: "whatsapp", url: "https://example.com/redirect", redirectHost: "go.thaledon.com" }),
    /host_not_allowed/,
  );
  assert.throws(
    () => validateDynamicLinkDestination({ type: "website", url: "https://127.0.0.1/private", redirectHost: "go.thaledon.com" }),
    /unsafe/,
  );
  assert.throws(
    () => validateDynamicLinkDestination({ type: "website", url: "javascript:alert(1)", redirectHost: "go.thaledon.com" }),
    /unsafe/,
  );
});

test("a public active link redirects temporarily without caching a prior destination", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("dynamic_link_units")) {
      return jsonResponse([{
        id: "unit-1",
        public_code: "0123456789AB",
        label: "Pilot",
        status: "active",
        revision: 1,
        destination_type: "website",
        destination_url: "https://example.com/new-target",
        created_at: "2026-09-07T00:00:00Z",
        updated_at: "2026-09-07T00:00:00Z",
      }]);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await app.request("https://go.thaledon.com/r/0123456789ab", undefined, env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://example.com/new-target");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("unconfigured and unknown public links use safe fallbacks", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([]);
  try {
    const response = await app.request("https://go.thaledon.com/r/0123456789AB", undefined, env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.doesNotMatch(await response.text(), /destination|0123456789AB/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("inventory endpoints require a system administrator", async () => {
  const unauthenticated = await app.request("https://api.test/dashboard/admin/dynamic-links", undefined, env);
  assert.equal(unauthenticated.status, 401);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /auth\/v1\/user/);
    return jsonResponse({ id: "ordinary-user", app_metadata: {} });
  };
  try {
    const ordinaryUser = await app.request(
      "https://api.test/dashboard/admin/dynamic-links",
      { headers: { Authorization: "Bearer test-token" } },
      env,
    );
    assert.equal(ordinaryUser.status, 403);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}
