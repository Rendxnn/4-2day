import { Hono } from "hono";
import type { ApiBindings } from "../../../lib/bindings";
import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import { isMissingTableError } from "../../../shared/errors/supabase";
import { getAuthorizedTenants, isSystemAdmin, requireAuthUser } from "../auth";
import type { DashboardContext, DashboardVariables, RestaurantAnalyticsSnapshotRow, TenantRow, TenantStatus, TenantUserRow } from "../types";
import {
  buildDefaultRestaurantPassword,
  createOrLinkRestaurantMember,
  getTenantById,
  listAdminRestaurants,
  mapAdminRestaurant,
  normalizeTenantSlug,
  updatePrimaryLocation,
} from "../support/admin";
import { updateAuthAdminUser } from "../support/auth-admin";

async function requireSystemAdmin(c: DashboardContext) {
  const authUser = await requireAuthUser(c);
  if (authUser instanceof Response) return authUser;

  if (!isSystemAdmin(authUser)) {
    return c.json({ error: "admin_forbidden" }, 403);
  }

  return authUser;
}

export const adminDashboardRoutes = new Hono<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}>();

adminDashboardRoutes.get("/tenants", async (c) => {
  const authUser = await requireAuthUser(c);
  if (authUser instanceof Response) return authUser;
  const tenants = await getAuthorizedTenants(c.env, authUser.id);

  return c.json(
    tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      schemaName: tenant.schema_name,
      role: tenant.role,
    })),
  );
});

adminDashboardRoutes.get("/me", async (c) => {
  const authUser = await requireAuthUser(c);
  if (authUser instanceof Response) return authUser;
  const tenants = await getAuthorizedTenants(c.env, authUser.id);

  return c.json({
    user: authUser,
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      schemaName: tenant.schema_name,
      role: tenant.role,
    })),
  });
});

adminDashboardRoutes.get("/admin/overview", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenants = await createSupabaseRestClient(c.env).select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,timezone",
      status: "eq.active",
    },
  });

  return c.json({
    activeRestaurantCount: tenants.length,
  });
});

adminDashboardRoutes.get("/admin/restaurants", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const restaurants = await listAdminRestaurants(c.env);
  return c.json({ restaurants });
});

function parseAnalyticsDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

function getAnalyticsRange(input: { startDate?: string; endDate?: string }) {
  const startDate = parseAnalyticsDate(input.startDate);
  const endDate = parseAnalyticsDate(input.endDate);
  if (!startDate || !endDate || startDate > endDate) return undefined;

  const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 366) return undefined;
  return { startDate, endDate };
}

function mapAnalyticsSnapshot(snapshot: RestaurantAnalyticsSnapshotRow) {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenant_id,
    rangeStart: snapshot.range_start,
    rangeEnd: snapshot.range_end,
    timezone: snapshot.timezone,
    payload: snapshot.payload,
    previousPayload: snapshot.previous_payload,
    calculatedAt: snapshot.calculated_at,
  };
}

adminDashboardRoutes.get("/admin/analytics", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const range = getAnalyticsRange({
    startDate: c.req.query("startDate"),
    endDate: c.req.query("endDate"),
  });
  if (!range) return c.json({ error: "invalid_analytics_range" }, 400);

  const snapshots = await createSupabaseRestClient(c.env).select<RestaurantAnalyticsSnapshotRow>({
    schema: "control",
    table: "restaurant_analytics_snapshots",
    query: {
      select: "id,tenant_id,range_start,range_end,timezone,payload,previous_payload,calculated_at,created_at,updated_at",
      range_start: `eq.${range.startDate}`,
      range_end: `eq.${range.endDate}`,
      order: "calculated_at.desc",
    },
  });

  return c.json({
    range,
    snapshots: snapshots.map(mapAnalyticsSnapshot),
  });
});

adminDashboardRoutes.post("/admin/analytics/restaurants/:tenantId/calculate", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) return c.json({ error: "restaurant_not_found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { startDate?: string; endDate?: string };
  const range = getAnalyticsRange(body);
  if (!range) return c.json({ error: "invalid_analytics_range" }, 400);

  const snapshot = await createSupabaseRestClient(c.env).rpc<RestaurantAnalyticsSnapshotRow>({
    schema: "control",
    functionName: "calculate_restaurant_analytics",
    args: {
      p_tenant_id: tenant.id,
      p_range_start: range.startDate,
      p_range_end: range.endDate,
      p_calculated_by: authUser.id,
    },
  });

  return c.json({ snapshot: mapAnalyticsSnapshot(snapshot) });
});

adminDashboardRoutes.post("/admin/restaurants", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    slug?: string;
    timezone?: string;
    currency?: string;
    status?: TenantStatus;
    automationEnabled?: boolean;
    locationName?: string;
    locationAddress?: string;
    locationPhone?: string;
    deliveryFeeFixed?: number;
    ownerEmail?: string;
    ownerName?: string;
    ownerPassword?: string;
  };
  const name = String(body.name ?? "").trim();
  const slug = normalizeTenantSlug(body.slug || name);

  if (!name || !slug) {
    return c.json({ error: "restaurant_name_required" }, 400);
  }

  const schemaName = `tenant_${slug.replace(/-/g, "_")}`;
  const supabase = createSupabaseRestClient(c.env);
  const [existing] = await supabase.select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,slug,schema_name",
      slug: `eq.${slug}`,
      limit: 1,
    },
  });

  if (existing) {
    return c.json({ error: "restaurant_slug_already_exists" }, 409);
  }

  const provisioned = await supabase.rpc<TenantRow[]>({
    schema: "control",
    functionName: "provision_restaurant_tenant",
    args: {
      p_name: name,
      p_slug: slug,
      p_schema_name: schemaName,
      p_timezone: body.timezone || "America/Bogota",
      p_currency: body.currency || "COP",
      p_status: body.status || "active",
      p_automation_enabled: body.automationEnabled ?? true,
      p_location_name: body.locationName || "Sede principal",
      p_location_address: body.locationAddress || null,
      p_location_phone: body.locationPhone || null,
      p_delivery_fee_fixed: Number(body.deliveryFeeFixed ?? 0),
    },
  });
  const tenant = provisioned[0];

  if (!tenant) {
    return c.json({ error: "restaurant_provision_failed" }, 500);
  }

  let ownerPassword: string | undefined;
  let ownerMember: Awaited<ReturnType<typeof createOrLinkRestaurantMember>> | undefined;
  if (body.ownerEmail) {
    ownerPassword = body.ownerPassword || buildDefaultRestaurantPassword(slug);
    ownerMember = await createOrLinkRestaurantMember(c.env, tenant, {
      email: body.ownerEmail,
      name: body.ownerName || name,
      password: ownerPassword,
      role: "encargado",
      resetPasswordIfUserExists: Boolean(body.ownerPassword),
    });
  }

  const restaurants = await listAdminRestaurants(c.env);
  const restaurant = restaurants.find((entry) => entry.id === tenant.id) ?? mapAdminRestaurant(tenant);

  return c.json({
    restaurant,
    owner: ownerMember?.member,
    temporaryPassword: ownerMember ? ownerPassword : undefined,
  }, 201);
});

adminDashboardRoutes.patch("/admin/restaurants/:tenantId", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    status?: TenantStatus;
    timezone?: string;
    currency?: string;
    automationEnabled?: boolean;
    locationName?: string;
    locationAddress?: string;
    locationPhone?: string;
    deliveryFeeFixed?: number;
    pickupEnabled?: boolean;
    deliveryEnabled?: boolean;
    locationAutomationEnabled?: boolean;
  };
  const tenantPatch: Record<string, unknown> = {};

  if (body.name !== undefined) tenantPatch.name = String(body.name).trim();
  if (body.status !== undefined) tenantPatch.status = body.status;
  if (body.timezone !== undefined) tenantPatch.timezone = String(body.timezone).trim() || "America/Bogota";
  if (body.currency !== undefined) tenantPatch.currency = String(body.currency).trim() || "COP";
  if (body.automationEnabled !== undefined) tenantPatch.automation_enabled = body.automationEnabled;
  if (Object.keys(tenantPatch).length > 0) tenantPatch.updated_at = new Date().toISOString();

  if (tenantPatch.status && !["active", "inactive", "suspended"].includes(String(tenantPatch.status))) {
    return c.json({ error: "invalid_restaurant_status" }, 400);
  }

  const supabase = createSupabaseRestClient(c.env);
  if (Object.keys(tenantPatch).length > 0) {
    await supabase.update({
      schema: "control",
      table: "tenants",
      query: { id: `eq.${tenant.id}` },
      values: tenantPatch,
    });
  }

  await updatePrimaryLocation(c.env, tenant.schema_name, {
    name: body.locationName,
    address: body.locationAddress,
    phone: body.locationPhone,
    deliveryFeeFixed: body.deliveryFeeFixed,
    pickupEnabled: body.pickupEnabled,
    deliveryEnabled: body.deliveryEnabled,
    automationEnabled: body.locationAutomationEnabled ?? body.automationEnabled,
  });

  const restaurants = await listAdminRestaurants(c.env);
  return c.json({ restaurant: restaurants.find((entry) => entry.id === tenant.id) });
});

adminDashboardRoutes.delete("/admin/restaurants/:tenantId", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  const supabase = createSupabaseRestClient(c.env);
  await Promise.all([
    supabase.update({
      schema: "control",
      table: "tenants",
      query: { id: `eq.${tenant.id}` },
      values: { status: "inactive", automation_enabled: false, updated_at: new Date().toISOString() },
    }),
    supabase.update({
      schema: "control",
      table: "tenant_users",
      query: { tenant_id: `eq.${tenant.id}` },
      values: { status: "inactive" },
    }),
    supabase.update({
      schema: "control",
      table: "tenant_channels",
      query: { tenant_id: `eq.${tenant.id}` },
      values: { status: "inactive" },
    }).catch((error) => {
      if (isMissingTableError(error)) return [];
      throw error;
    }),
  ]);

  return c.json({ ok: true });
});

adminDashboardRoutes.post("/admin/restaurants/:tenantId/members", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  const body = await c.req.json().catch(() => ({})) as {
    email?: string;
    name?: string;
    role?: TenantUserRow["role"];
    password?: string;
  };
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return c.json({ error: "member_email_required" }, 400);
  }

  const role = body.role === "trabajador" ? "trabajador" : "encargado";
  const temporaryPassword = body.password || buildDefaultRestaurantPassword(tenant.slug);
  const result = await createOrLinkRestaurantMember(c.env, tenant, {
    email,
    name: body.name || email.split("@")[0] || "Usuario",
    password: temporaryPassword,
    role,
    resetPasswordIfUserExists: Boolean(body.password),
  });

  return c.json({
    member: result.member,
    temporaryPassword,
  }, 201);
});

adminDashboardRoutes.patch("/admin/restaurants/:tenantId/members/:userId", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  const body = await c.req.json().catch(() => ({})) as {
    role?: TenantUserRow["role"];
    status?: TenantUserRow["status"];
    name?: string;
  };
  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) patch.role = body.role;
  if (body.status !== undefined) patch.status = body.status;

  if (patch.role && !["encargado", "trabajador"].includes(String(patch.role))) {
    return c.json({ error: "invalid_member_role" }, 400);
  }

  if (patch.status && !["active", "inactive"].includes(String(patch.status))) {
    return c.json({ error: "invalid_member_status" }, 400);
  }

  if (Object.keys(patch).length > 0) {
    await createSupabaseRestClient(c.env).update({
      schema: "control",
      table: "tenant_users",
      query: {
        tenant_id: `eq.${tenant.id}`,
        user_id: `eq.${c.req.param("userId")}`,
      },
      values: patch,
    });
  }

  if (body.name !== undefined) {
    await updateAuthAdminUser(c.env, c.req.param("userId"), {
      user_metadata: {
        name: String(body.name).trim(),
        source: "admin_console",
      },
    });
  }

  const restaurants = await listAdminRestaurants(c.env);
  const restaurant = restaurants.find((entry) => entry.id === tenant.id);
  return c.json({ restaurant });
});

adminDashboardRoutes.delete("/admin/restaurants/:tenantId/members/:userId", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  await createSupabaseRestClient(c.env).update({
    schema: "control",
    table: "tenant_users",
    query: {
      tenant_id: `eq.${tenant.id}`,
      user_id: `eq.${c.req.param("userId")}`,
    },
    values: { status: "inactive" },
  });

  return c.json({ ok: true });
});

adminDashboardRoutes.post("/admin/restaurants/:tenantId/members/:userId/reset-password", async (c) => {
  const authUser = await requireSystemAdmin(c);
  if (authUser instanceof Response) return authUser;

  const tenant = await getTenantById(c.env, c.req.param("tenantId"));
  if (!tenant) {
    return c.json({ error: "restaurant_not_found" }, 404);
  }

  const body = await c.req.json().catch(() => ({})) as { password?: string };
  const temporaryPassword = body.password || buildDefaultRestaurantPassword(tenant.slug);

  await updateAuthAdminUser(c.env, c.req.param("userId"), {
    password: temporaryPassword,
  });

  return c.json({ temporaryPassword });
});
