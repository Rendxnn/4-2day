import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRestaurantPublicProfilePayload,
  parseRestaurantPublicProfileSettingsUpdate,
} from "../src/features/public-profile/service.ts";

test("normalizes social handles and rejects unsafe public profile links", () => {
  const parsed = parseRestaurantPublicProfileSettingsUpdate({
    profileEnabled: true,
    headline: "Comida para compartir",
    contactPhone: "+57 300 123 4567",
    whatsappPhone: "573001234567",
    instagramUrl: "@restaurante",
    facebookUrl: "restaurante",
    tiktokUrl: "@restaurante",
    websiteUrl: "restaurante.example",
    mapsUrl: "",
    surveyUrl: "https://forms.google.com/example",
  });

  assert.equal(parsed?.instagramUrl, "https://instagram.com/restaurante");
  assert.equal(parsed?.facebookUrl, "https://facebook.com/restaurante");
  assert.equal(parsed?.tiktokUrl, "https://tiktok.com/restaurante");
  assert.equal(parsed?.websiteUrl, "https://restaurante.example/");
  assert.equal(parsed?.surveyUrl, "https://forms.google.com/example");

  assert.equal(parseRestaurantPublicProfileSettingsUpdate({
    profileEnabled: true,
    websiteUrl: "javascript:alert(1)",
  }), undefined);
});

test("builds a safe public link page with directions and optional survey", () => {
  const payload = buildRestaurantPublicProfilePayload(
    {
      id: "tenant",
      name: "Restaurante Demo",
      slug: "demo",
      schema_name: "tenant_demo",
      automation_enabled: false,
    },
    {
      id: "location",
      name: "Sede principal",
      address: "Calle 1 # 2-3",
      phone: "+57 300 123 4567",
      whatsapp_contact: "573001234567",
      public_profile_enabled: true,
      latitude: 6.15,
      longitude: -75.61,
      delivery_fee_fixed: 0,
      is_active: true,
    },
  );

  assert.equal(payload.experience.mode, "standalone");
  assert.equal(payload.links.cartaUrlPath, "/carta?tenant=demo");
  assert.equal(payload.links.phoneUrl, "tel:+573001234567");
  assert.equal(payload.links.whatsappUrl, "https://wa.me/573001234567");
  assert.match(payload.links.mapsUrl ?? "", /google\.com\/maps\/dir/);
  assert.equal(payload.links.surveyUrl, undefined);
});

test("public profile route stays public and settings remain manager-only", async () => {
  const [router, settings, migration, refreshMigration, admin] = await Promise.all([
    readFile(new URL("../src/features/dashboard/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/routes/settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/migrations/20260729184447_add_restaurant_public_profiles.sql", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/migrations/20260729190244_refresh_postgrest_tenant_schemas_for_public_profiles.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/routes/admin.ts", import.meta.url), "utf8"),
  ]);

  assert.ok(router.indexOf("dashboardRoutes.route(\"/\", publicProfileRoutes)") < router.indexOf("dashboardRoutes.use(\"/:tenantSlug/*\", tenantAccessMiddleware)"));
  assert.match(settings, /settings\/public-profile[\s\S]*requireManagerRole/);
  assert.match(migration, /select 'tenant_template'[\s\S]*select schema_name\s+from control\.tenants/);
  assert.match(migration, /public_profile_enabled[\s\S]*survey_url/);
  assert.match(refreshMigration, /control\.refresh_postgrest_tenant_schemas\(\)/);
  assert.match(admin, /automationEnabled: body\.locationAutomationEnabled \?\? body\.automationEnabled/);
});
