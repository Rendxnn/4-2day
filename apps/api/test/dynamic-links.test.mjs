import assert from "node:assert/strict";
import test from "node:test";
import {
  DynamicLinkValidationError,
  buildDynamicLinkUrl,
  generateDynamicLinkCode,
  inferDynamicLinkDestinationType,
  parseDynamicLinkReference,
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

test("quick setup only accepts ParaHoy codes or canonical permanent URLs and infers destination types", () => {
  assert.equal(parseDynamicLinkReference("0123456789ab", "https://go.thaledon.com"), "0123456789AB");
  assert.equal(parseDynamicLinkReference("https://go.thaledon.com/r/0123456789ab", "https://go.thaledon.com"), "0123456789AB");
  assert.throws(() => parseDynamicLinkReference("https://example.com/r/0123456789AB", "https://go.thaledon.com"), /reference_invalid/);
  assert.throws(() => parseDynamicLinkReference("https://go.thaledon.com/r/0123456789AB?next=https://bad.example", "https://go.thaledon.com"), /reference_invalid/);
  assert.equal(inferDynamicLinkDestinationType({ url: "https://maps.app.goo.gl/example", publicMenuHost: "parahoy.thaledon.com" }), "google_review");
  assert.equal(inferDynamicLinkDestinationType({ url: "https://wa.me/573001234567", publicMenuHost: "parahoy.thaledon.com" }), "whatsapp");
  assert.equal(inferDynamicLinkDestinationType({ url: "https://instagram.com/parahoy", publicMenuHost: "parahoy.thaledon.com" }), "instagram");
  assert.equal(inferDynamicLinkDestinationType({ url: "https://parahoy.thaledon.com/carta?tenant=demo", publicMenuHost: "parahoy.thaledon.com" }), "menu");
  assert.equal(inferDynamicLinkDestinationType({ url: "https://example.com/menu", publicMenuHost: "parahoy.thaledon.com" }), "website");
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

test("quick setup resolves exactly by code and saves activation in one audited RPC", async () => {
  const previousFetch = globalThis.fetch;
  const unit = {
    id: "11111111-1111-4111-8111-111111111111",
    public_code: "0123456789AB",
    label: "Antes",
    status: "suspended",
    revision: 3,
    destination_type: "website",
    destination_url: "https://example.com/old",
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("auth/v1/user")) return jsonResponse({ id: "admin-user", app_metadata: { system_admin: true } });
    if (url.includes("dynamic_link_units") && url.includes("public_code=eq.0123456789AB")) return jsonResponse([unit]);
    if (url.includes("dynamic_link_units") && url.includes("id=eq.11111111-1111-4111-8111-111111111111")) return jsonResponse([unit]);
    if (url.includes("rpc/update_dynamic_link_unit")) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_event_type, "activated");
      assert.deepEqual(payload.p_patch, {
        label: "Café piloto",
        destination_type: "whatsapp",
        destination_url: "https://wa.me/573001234567",
        status: "active",
        tenant_id: null,
        location_id: null,
        location_label_snapshot: null,
      });
      return jsonResponse([{ ...unit, label: "Café piloto", status: "active", revision: 4, destination_type: "whatsapp", destination_url: "https://wa.me/573001234567" }]);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const lookup = await app.request("https://api.test/dashboard/admin/dynamic-links/by-code/0123456789ab", { headers: { Authorization: "Bearer test-token" } }, env);
    assert.equal(lookup.status, 200);
    const response = await app.request("https://api.test/dashboard/admin/dynamic-links/11111111-1111-4111-8111-111111111111/quick-configuration", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 3, label: " Café piloto ", destinationUrl: "https://wa.me/573001234567", tenantId: null }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).unit.status, "active");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("quick setup rejects archived units and returns a revision conflict without a partial update", async () => {
  const previousFetch = globalThis.fetch;
  const baseUnit = {
    id: "22222222-2222-4222-8222-222222222222",
    public_code: "0123456789AB",
    label: "Pilot",
    status: "archived",
    revision: 5,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };
  let status = "archived";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("auth/v1/user")) return jsonResponse({ id: "admin-user", app_metadata: { system_admin: true } });
    if (url.includes("dynamic_link_units")) return jsonResponse([{ ...baseUnit, status }]);
    if (url.includes("rpc/update_dynamic_link_unit")) return new Response("dynamic_link_stale", { status: 409 });
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const archived = await app.request("https://api.test/dashboard/admin/dynamic-links/22222222-2222-4222-8222-222222222222/quick-configuration", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 5, label: "Pilot", destinationUrl: "https://example.com" }),
    }, env);
    assert.equal(archived.status, 409);
    assert.equal((await archived.json()).error, "dynamic_link_archived");

    status = "available";
    const stale = await app.request("https://api.test/dashboard/admin/dynamic-links/22222222-2222-4222-8222-222222222222/quick-configuration", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 5, label: "Pilot", destinationUrl: "https://example.com" }),
    }, env);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, "dynamic_link_stale");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("quick setup can assign the selected business and its primary location", async () => {
  const previousFetch = globalThis.fetch;
  const unit = {
    id: "33333333-3333-4333-8333-333333333333", public_code: "0123456789AB", label: "Pilot", status: "available", revision: 1,
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("auth/v1/user")) return jsonResponse({ id: "admin-user", app_metadata: { system_admin: true } });
    if (url.includes("dynamic_link_units")) return jsonResponse([unit]);
    if (url.includes("rest/v1/tenants")) return jsonResponse([{
      id: "44444444-4444-4444-8444-444444444444", name: "Café Central", slug: "cafe-central", schema_name: "tenant_cafe", status: "active",
      timezone: "America/Bogota", currency: "COP", automation_enabled: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }]);
    if (url.includes("rest/v1/tenant_users")) return jsonResponse([]);
    if (url.includes("rpc/get_tenant_admin_snapshot")) return jsonResponse({ location: { id: "55555555-5555-4555-8555-555555555555", name: "Principal", is_active: true } });
    if (url.includes("rpc/update_dynamic_link_unit")) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_patch.tenant_id, "44444444-4444-4444-8444-444444444444");
      assert.equal(payload.p_patch.location_id, "55555555-5555-4555-8555-555555555555");
      assert.equal(payload.p_patch.location_label_snapshot, "Principal");
      return jsonResponse([{ ...unit, status: "active", revision: 2 }]);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await app.request("https://api.test/dashboard/admin/dynamic-links/33333333-3333-4333-8333-333333333333/quick-configuration", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, label: "Café Central", destinationUrl: "https://example.com", tenantId: "44444444-4444-4444-8444-444444444444" }),
    }, env);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}
