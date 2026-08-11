import { Hono } from "hono";
import type { ApiBindings } from "../../../lib/bindings";
import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import { buildRestaurantPublicProfilePayload } from "../../public-profile/service";
import type { DashboardVariables, LocationRow, TenantRow } from "../types";

export const publicProfileRoutes = new Hono<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}>();

publicProfileRoutes.get("/public/:tenantSlug/profile", async (c) => {
  const supabase = createSupabaseRestClient(c.env);
  const [tenant] = await supabase.select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,status,automation_enabled",
      slug: `eq.${c.req.param("tenantSlug")}`,
      status: "eq.active",
      limit: 1,
    },
  });
  if (!tenant) return c.json({ error: "tenant_not_found" }, 404);

  const [location] = await supabase.select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: [
        "id", "name", "address", "phone", "latitude", "longitude", "is_active",
        "public_profile_enabled", "public_profile_headline", "whatsapp_contact",
        "instagram_url", "facebook_url", "tiktok_url", "website_url", "maps_url", "survey_url",
      ].join(","),
      is_active: "eq.true",
      limit: 1,
    },
  });

  if (!location || location.public_profile_enabled === false) {
    return c.json({ error: "public_profile_not_found" }, 404);
  }

  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.json(buildRestaurantPublicProfilePayload(tenant, location));
});
