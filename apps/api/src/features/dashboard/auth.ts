import type { MiddlewareHandler } from "hono";
import type { ApiBindings } from "../../lib/bindings";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import type { AuthUser, DashboardContext, DashboardVariables, TenantRow, TenantUserRow } from "./types";

export async function requireAuthUser(c: DashboardContext): Promise<AuthUser | Response> {
  const anonKey = c.env.SUPABASE_ANON_KEY;
  if (!anonKey || anonKey === "replace-me") {
    return c.json(
      {
        error: "supabase_anon_not_configured",
        message: c.env.APP_ENV === "local"
          ? "Set SUPABASE_ANON_KEY in apps/api/.dev.vars and restart wrangler dev."
          : "Set SUPABASE_ANON_KEY in the Worker environment.",
      },
      503,
    );
  }

  const authorization = c.req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const response = await fetch(`${c.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return c.json({ error: "unauthorized" }, 401);
  }

  return (await response.json()) as AuthUser;
}

export function isSystemAdmin(user: AuthUser) {
  return user.app_metadata?.system_admin === true || user.app_metadata?.role === "system_admin";
}

export async function requireSystemAdmin(c: DashboardContext): Promise<AuthUser | Response> {
  const authUser = await requireAuthUser(c);
  if (authUser instanceof Response) return authUser;
  if (!isSystemAdmin(authUser)) return c.json({ error: "admin_forbidden" }, 403);
  return authUser;
}

export async function getAuthorizedTenants(env: ApiBindings, userId: string): Promise<TenantRow[]> {
  const supabase = createSupabaseRestClient(env);
  const tenantUsers = await supabase.select<TenantUserRow>({
    schema: "control",
    table: "tenant_users",
    query: {
      select: "tenant_id,user_id,role,status",
      user_id: `eq.${userId}`,
      status: "eq.active",
    },
  });

  if (tenantUsers.length === 0) {
    return [];
  }

  const tenantIds = tenantUsers.map((row) => row.tenant_id).join(",");
  const tenants = await supabase.select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,timezone",
      id: `in.(${tenantIds})`,
      status: "eq.active",
      order: "name.asc",
    },
  });

  const roleByTenantId = new Map(tenantUsers.map((row) => [row.tenant_id, row.role]));
  return tenants.map((tenant) => ({
    ...tenant,
    role: roleByTenantId.get(tenant.id),
  }));
}

export async function getTenantUserRole(
  env: ApiBindings,
  userId: string,
  tenantId: string,
): Promise<TenantUserRow["role"] | undefined> {
  const [tenantUser] = await createSupabaseRestClient(env).select<TenantUserRow>({
    schema: "control",
    table: "tenant_users",
    query: {
      select: "tenant_id,user_id,role,status",
      tenant_id: `eq.${tenantId}`,
      user_id: `eq.${userId}`,
      status: "eq.active",
      limit: 1,
    },
  });

  return tenantUser?.role;
}

export const tenantAccessMiddleware: MiddlewareHandler<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}> = async (c, next) => {
  const authUser = await requireAuthUser(c as DashboardContext);
  if (authUser instanceof Response) return authUser;

  const tenants = await getAuthorizedTenants(c.env, authUser.id);
  const tenant = tenants.find((entry) => entry.slug === c.req.param("tenantSlug"));

  if (!tenant) {
    return c.json({ error: "tenant_not_found" }, 404);
  }

  c.set("authUser", authUser);
  c.set("authorizedTenants", tenants);
  c.set("tenant", tenant);
  await next();
};
