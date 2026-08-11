import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import type { ApiBindings } from "../../../lib/bindings";
import { isMissingTableError } from "../../../shared/errors/supabase";
import type { AdminAuthUser, LocationRow, TenantRow, TenantUserRow } from "../types";
import { createAuthAdminUser, findAuthAdminUserByEmail, getAuthAdminUser, updateAuthAdminUser } from "./auth-admin";

export function normalizeTenantSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function buildDefaultRestaurantPassword(slug: string): string {
  const base = slug.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "restaurante";
  return `${base}_42*password`;
}

type AdminRestaurantMetrics = {
  activeProductCount: number;
  todayMenuItemCount: number;
  ordersTodayCount: number;
  pendingOrderCount: number;
  completedTodayCount: number;
  revenueToday: number;
  lastOrderAt?: string;
};

type AdminTenantSnapshot = {
  location?: LocationRow | null;
  metrics?: AdminRestaurantMetrics | null;
};

export function mapAdminRestaurant(
  tenant: TenantRow,
  location?: LocationRow,
  members: ReturnType<typeof mapAdminMember>[] = [],
  metrics?: AdminRestaurantMetrics,
) {
  return {
    id: tenant.id,
    name: tenant.name ?? tenant.slug,
    slug: tenant.slug,
    schemaName: tenant.schema_name,
    status: tenant.status ?? "active",
    timezone: tenant.timezone ?? "America/Bogota",
    currency: tenant.currency ?? "COP",
    automationEnabled: tenant.automation_enabled ?? true,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
    cartaUrlPath: `/carta?tenant=${tenant.slug}`,
    publicProfileUrlPath: `/r/${tenant.slug}`,
    defaultPassword: buildDefaultRestaurantPassword(tenant.slug),
    location: location ? {
      id: location.id,
      name: location.name,
      address: location.address,
      phone: location.phone,
      deliveryFeeFixed: location.delivery_fee_fixed,
      pickupEnabled: location.pickup_enabled ?? true,
      deliveryEnabled: location.delivery_enabled ?? true,
      automationEnabled: location.automation_enabled ?? true,
      isActive: location.is_active,
    } : undefined,
    members,
    metrics: metrics ?? {
      activeProductCount: 0,
      todayMenuItemCount: 0,
      ordersTodayCount: 0,
      pendingOrderCount: 0,
      completedTodayCount: 0,
      revenueToday: 0,
    },
  };
}

export function mapAdminMember(row: TenantUserRow, user?: AdminAuthUser) {
  return {
    userId: row.user_id,
    email: user?.email,
    name: user?.user_metadata?.name ?? user?.user_metadata?.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastSignInAt: user?.last_sign_in_at ?? undefined,
  };
}

export async function listAdminRestaurants(env: ApiBindings) {
  const supabase = createSupabaseRestClient(env);
  const tenants = await supabase.select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,status,timezone,currency,automation_enabled,created_at,updated_at",
      order: "created_at.desc",
    },
  });
  const tenantIds = tenants.map((tenant) => tenant.id);
  const tenantUsers = tenantIds.length > 0
    ? await supabase.select<TenantUserRow>({
        schema: "control",
        table: "tenant_users",
        query: {
          select: "tenant_id,user_id,role,status,created_at",
          tenant_id: `in.(${tenantIds.join(",")})`,
          order: "created_at.asc",
        },
      })
    : [];
  const uniqueUserIds = Array.from(new Set(tenantUsers.map((row) => row.user_id)));
  const authUsers = await Promise.all(uniqueUserIds.map((userId) => getAuthAdminUser(env, userId).catch(() => undefined)));
  const authUserById = new Map(authUsers.filter((user): user is AdminAuthUser => Boolean(user)).map((user) => [user.id, user]));

  const restaurants = await Promise.all(tenants.map(async (tenant) => {
    const snapshot = await getAdminTenantSnapshot(supabase, tenant);

    return mapAdminRestaurant(
      tenant,
      snapshot.location ?? undefined,
      tenantUsers
        .filter((row) => row.tenant_id === tenant.id)
        .map((row) => mapAdminMember(row, authUserById.get(row.user_id))),
      snapshot.metrics ?? undefined,
    );
  }));

  return restaurants;
}

export async function getAdminTenantSnapshot(
  supabase: ReturnType<typeof createSupabaseRestClient>,
  tenant: TenantRow,
): Promise<AdminTenantSnapshot> {
  return supabase.rpc<AdminTenantSnapshot>({
    schema: "control",
    functionName: "get_tenant_admin_snapshot",
    args: {
      p_schema_name: tenant.schema_name,
      p_timezone: tenant.timezone ?? "America/Bogota",
    },
  }).catch((error) => {
    if (isMissingTableError(error)) return {};
    throw error;
  });
}

export async function getTenantById(env: ApiBindings, tenantId: string): Promise<TenantRow | undefined> {
  const [tenant] = await createSupabaseRestClient(env).select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,status,timezone,currency,automation_enabled,created_at,updated_at",
      id: `eq.${tenantId}`,
      limit: 1,
    },
  });

  return tenant;
}

export async function updatePrimaryLocation(
  env: ApiBindings,
  schema: string,
  patch: {
    name?: string;
    address?: string;
    phone?: string;
    deliveryFeeFixed?: number;
    pickupEnabled?: boolean;
    deliveryEnabled?: boolean;
    automationEnabled?: boolean;
  },
) {
  if (Object.values(patch).every((value) => value === undefined)) return;

  await createSupabaseRestClient(env).rpc({
    schema: "control",
    functionName: "update_tenant_primary_location",
    args: {
      p_schema_name: schema,
      p_name: patch.name,
      p_address: patch.address,
      p_phone: patch.phone,
      p_delivery_fee_fixed: patch.deliveryFeeFixed,
      p_pickup_enabled: patch.pickupEnabled,
      p_delivery_enabled: patch.deliveryEnabled,
      p_automation_enabled: patch.automationEnabled,
    },
  });
}

export async function createOrLinkRestaurantMember(
  env: ApiBindings,
  tenant: TenantRow,
  input: {
    email: string;
    name: string;
    password: string;
    role: TenantUserRow["role"];
    resetPasswordIfUserExists?: boolean;
  },
) {
  const existing = await findAuthAdminUserByEmail(env, input.email);
  const user = existing ?? await createAuthAdminUser(env, {
    email: input.email,
    password: input.password,
    name: input.name,
  });

  if (existing && input.resetPasswordIfUserExists) {
    await updateAuthAdminUser(env, existing.id, { password: input.password });
  }

  await createSupabaseRestClient(env).upsert({
    schema: "control",
    table: "tenant_users",
    onConflict: "tenant_id,user_id",
    rows: {
      tenant_id: tenant.id,
      user_id: user.id,
      role: input.role,
      status: "active",
    },
  });

  return {
    member: mapAdminMember({
      tenant_id: tenant.id,
      user_id: user.id,
      role: input.role,
      status: "active",
    }, user),
  };
}
