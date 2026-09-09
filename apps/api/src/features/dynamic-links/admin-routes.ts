import { DynamicLinkValidationError } from "@42day/core";
import { Hono, type Context } from "hono";
import type { ApiBindings } from "../../lib/bindings.ts";
import { SupabaseRestError } from "../../lib/supabase-rest.ts";
import { requireSystemAdmin } from "../dashboard/auth.ts";
import { listAdminRestaurants } from "../dashboard/support/admin.ts";
import type { DashboardContext, DashboardVariables } from "../dashboard/types.ts";
import {
  createDynamicLinkBatch,
  findDynamicLinkUnitByCode,
  findDynamicLinkUnitById,
  findTenantStatus,
  listDynamicLinkAuditEvents,
  listDynamicLinkBatches,
  listDynamicLinkUnits,
  updateDynamicLinkUnit,
} from "./repository.ts";
import { createDynamicLinkCode, inferDestinationType, isDestinationType, normalizePublicCode, toDynamicLinkUnit, validateDestination } from "./service.ts";

type UpdateBody = {
  revision?: number;
  label?: string;
  tenantId?: string | null;
  locationId?: string | null;
  locationLabelSnapshot?: string | null;
  destinationType?: string | null;
  destinationUrl?: string | null;
  nfcUid?: string | null;
};

type QuickConfigurationBody = {
  revision?: number;
  label?: string;
  destinationUrl?: string;
  tenantId?: string | null;
};

export const dynamicLinkAdminRoutes = new Hono<{ Bindings: ApiBindings; Variables: DashboardVariables }>();

dynamicLinkAdminRoutes.get("/admin/dynamic-links", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const limit = clampInteger(c.req.query("limit"), 1, 200, 50);
  const offset = clampInteger(c.req.query("offset"), 0, 10_000, 0);
  const units = await listDynamicLinkUnits(c.env, {
    query: c.req.query("query")?.trim() || undefined,
    status: isStatus(c.req.query("status")) ? c.req.query("status") : undefined,
    tenantId: c.req.query("tenantId") || undefined,
    batchId: c.req.query("batchId") || undefined,
    limit,
    offset,
  });
  return c.json({ units: units.map((unit) => toDynamicLinkUnit(unit, c.env)), limit, offset });
});

dynamicLinkAdminRoutes.get("/admin/dynamic-links/batches", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const batches = await listDynamicLinkBatches(c.env);
  return c.json({ batches: batches.map((batch) => ({
    id: batch.id,
    label: batch.label,
    supplierReference: batch.supplier_reference ?? undefined,
    notes: batch.notes ?? undefined,
    createdAt: batch.created_at,
  })) });
});

dynamicLinkAdminRoutes.post("/admin/dynamic-links/batches", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const body = await c.req.json().catch(() => ({})) as { requestId?: string; label?: string; count?: number; supplierReference?: string; notes?: string };
  const requestId = String(body.requestId ?? "").trim();
  const label = String(body.label ?? "").trim();
  const count = clampInteger(body.count, 1, 500, 0);
  if (!isUuid(requestId) || !label || !count) return c.json({ error: "dynamic_link_batch_invalid" }, 400);
  const units = Array.from({ length: count }, (_, index) => ({
    publicCode: createDynamicLinkCode(),
    label: count === 1 ? label : `${label} ${String(index + 1).padStart(3, "0")}`,
  }));
  try {
    const payload = await createDynamicLinkBatch(c.env, {
      requestId,
      label,
      supplierReference: body.supplierReference,
      notes: body.notes,
      actorUserId: authUser.id,
      units,
    });
    return c.json(payload, 201);
  } catch (error) {
    return dynamicLinkError(c, error);
  }
});

dynamicLinkAdminRoutes.get("/admin/dynamic-links/by-code/:code", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const publicCode = normalizePublicCode(c.req.param("code"));
  if (!publicCode) return c.json({ error: "dynamic_link_code_invalid" }, 400);
  let unit;
  try {
    unit = await findDynamicLinkUnitByCode(c.env, publicCode);
  } catch (error) {
    return dynamicLinkError(c, error);
  }
  if (!unit) return c.json({ error: "dynamic_link_not_found" }, 404);
  return c.json({ unit: toDynamicLinkUnit(unit, c.env) });
});

dynamicLinkAdminRoutes.patch("/admin/dynamic-links/:id/quick-configuration", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const body = await c.req.json().catch(() => ({})) as QuickConfigurationBody;
  if (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1) return c.json({ error: "dynamic_link_revision_invalid" }, 400);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 160) return c.json({ error: "dynamic_link_label_invalid" }, 400);
  if (typeof body.destinationUrl !== "string" || !body.destinationUrl.trim()) return c.json({ error: "dynamic_link_destination_invalid" }, 400);

  let current;
  try {
    current = await findDynamicLinkUnitById(c.env, c.req.param("id"));
  } catch (error) {
    return dynamicLinkError(c, error);
  }
  if (!current) return c.json({ error: "dynamic_link_not_found" }, 404);
  if (current.status === "archived") return c.json({ error: "dynamic_link_archived" }, 409);

  let destinationType: ReturnType<typeof inferDestinationType>;
  let destinationUrl: string;
  try {
    destinationType = inferDestinationType(body.destinationUrl, c.env);
    destinationUrl = validateDestination(destinationType, body.destinationUrl, c.env);
  } catch (error) {
    if (error instanceof DynamicLinkValidationError) return c.json({ error: error.code }, 400);
    throw error;
  }

  const patch: Record<string, unknown> = {
    label,
    destination_type: destinationType,
    destination_url: destinationUrl,
    status: "active",
  };
  if (body.tenantId !== undefined) {
    if (body.tenantId === null) {
      patch.tenant_id = null;
      patch.location_id = null;
      patch.location_label_snapshot = null;
    } else if (typeof body.tenantId === "string" && isUuid(body.tenantId)) {
      let restaurant;
      try {
        restaurant = (await listAdminRestaurants(c.env)).find((candidate) => candidate.id === body.tenantId);
      } catch (error) {
        return dynamicLinkError(c, error);
      }
      if (!restaurant) return c.json({ error: "dynamic_link_tenant_not_found" }, 400);
      patch.tenant_id = restaurant.id;
      patch.location_id = restaurant.location?.id ?? null;
      patch.location_label_snapshot = restaurant.location?.name ?? null;
    } else {
      return c.json({ error: "dynamic_link_tenant_invalid" }, 400);
    }
  }

  try {
    const updated = await updateDynamicLinkUnit(c.env, {
      unitId: current.id,
      revision: body.revision,
      actorUserId: authUser.id,
      eventType: current.status === "active" ? "updated" : "activated",
      patch,
    });
    return c.json({ unit: toDynamicLinkUnit(updated, c.env) });
  } catch (error) {
    return dynamicLinkError(c, error);
  }
});

dynamicLinkAdminRoutes.patch("/admin/dynamic-links/:id", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const body = await c.req.json().catch(() => ({})) as UpdateBody;
  const revision = body.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return c.json({ error: "dynamic_link_revision_invalid" }, 400);
  const current = await findDynamicLinkUnitById(c.env, c.req.param("id"));
  if (!current) return c.json({ error: "dynamic_link_not_found" }, 404);

  const patch = await normalizeUpdatePatch(c.env, current, body);
  if (patch instanceof Response) return patch;
  try {
    const updated = await updateDynamicLinkUnit(c.env, {
      unitId: current.id,
      revision,
      actorUserId: authUser.id,
      eventType: "updated",
      patch,
    });
    return c.json({ unit: toDynamicLinkUnit(updated, c.env) });
  } catch (error) {
    return dynamicLinkError(c, error);
  }
});

dynamicLinkAdminRoutes.post("/admin/dynamic-links/:id/:action", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const body = await c.req.json().catch(() => ({})) as { revision?: number; nfcUid?: string };
  const revision = body.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return c.json({ error: "dynamic_link_revision_invalid" }, 400);
  const action = c.req.param("action");
  const actions: Record<string, { eventType: string; patch: Record<string, unknown> }> = {
    activate: { eventType: "activated", patch: { status: "active" } },
    suspend: { eventType: "suspended", patch: { status: "suspended" } },
    archive: { eventType: "archived", patch: { status: "archived" } },
    "mark-qr-printed": { eventType: "qr_printed", patch: { qr_printed_at: new Date().toISOString() } },
    "mark-nfc-programmed": { eventType: "nfc_programmed", patch: { nfc_programmed_at: new Date().toISOString(), ...(body.nfcUid ? { nfc_uid: body.nfcUid.trim() } : {}) } },
    "mark-nfc-verified": { eventType: "nfc_verified", patch: { nfc_verified_at: new Date().toISOString() } },
    "mark-nfc-locked": { eventType: "nfc_locked", patch: { nfc_locked_at: new Date().toISOString() } },
  };
  const command = actions[action];
  if (!command) return c.json({ error: "dynamic_link_action_invalid" }, 400);
  try {
    const updated = await updateDynamicLinkUnit(c.env, {
      unitId: c.req.param("id"),
      revision,
      actorUserId: authUser.id,
      eventType: command.eventType,
      patch: command.patch,
    });
    return c.json({ unit: toDynamicLinkUnit(updated, c.env) });
  } catch (error) {
    return dynamicLinkError(c, error);
  }
});

dynamicLinkAdminRoutes.get("/admin/dynamic-links/:id/audit", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const unit = await findDynamicLinkUnitById(c.env, c.req.param("id"));
  if (!unit) return c.json({ error: "dynamic_link_not_found" }, 404);
  const events = await listDynamicLinkAuditEvents(c.env, unit.id);
  return c.json({ events });
});

dynamicLinkAdminRoutes.get("/admin/dynamic-links/export", async (c) => {
  const authUser = await requireSystemAdmin(c as DashboardContext);
  if (authUser instanceof Response) return authUser;
  const units = await listDynamicLinkUnits(c.env, { limit: 500, offset: 0 });
  const csv = [
    "code,url,label,status,batch_id,tenant_id,location,nfc_uid",
    ...units.map((unit) => [unit.public_code, toDynamicLinkUnit(unit, c.env).publicUrl, unit.label, unit.status, unit.batch_id ?? "", unit.tenant_id ?? "", unit.location_label_snapshot ?? "", unit.nfc_uid ?? ""].map(csvCell).join(",")),
  ].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="dynamic-links.csv"', "Cache-Control": "no-store" } });
});

async function normalizeUpdatePatch(env: ApiBindings, current: NonNullable<Awaited<ReturnType<typeof findDynamicLinkUnitById>>>, body: UpdateBody) {
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) {
    const label = body.label.trim();
    if (!label || label.length > 160) return new Response(JSON.stringify({ error: "dynamic_link_label_invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
    patch.label = label;
  }
  if (body.tenantId !== undefined) {
    if (body.tenantId) {
      const tenant = await findTenantStatus(env, body.tenantId);
      if (!tenant) return new Response(JSON.stringify({ error: "dynamic_link_tenant_not_found" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    patch.tenant_id = body.tenantId;
  }
  if (body.locationId !== undefined) patch.location_id = body.locationId;
  if (body.locationLabelSnapshot !== undefined) patch.location_label_snapshot = body.locationLabelSnapshot;
  if (body.nfcUid !== undefined) patch.nfc_uid = body.nfcUid;

  const destinationType = body.destinationType === undefined ? current.destination_type : body.destinationType;
  const destinationUrl = body.destinationUrl === undefined ? current.destination_url : body.destinationUrl;
  if (body.destinationType !== undefined || body.destinationUrl !== undefined) {
    if ((destinationType === null || destinationType === "") && (destinationUrl === null || destinationUrl === "")) {
      patch.destination_type = null;
      patch.destination_url = null;
    } else if (!isDestinationType(destinationType) || typeof destinationUrl !== "string") {
      return new Response(JSON.stringify({ error: "dynamic_link_destination_invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
    } else {
      try {
        patch.destination_type = destinationType;
        patch.destination_url = validateDestination(destinationType, destinationUrl, env);
      } catch (error) {
        if (error instanceof DynamicLinkValidationError) return new Response(JSON.stringify({ error: error.code }), { status: 400, headers: { "Content-Type": "application/json" } });
        throw error;
      }
    }
  }
  return patch;
}

function dynamicLinkError(c: Context<{ Bindings: ApiBindings; Variables: DashboardVariables }>, error: unknown) {
  const message = error instanceof SupabaseRestError ? error.body : error instanceof Error ? error.message : "dynamic_link_update_failed";
  if (message.includes("dynamic_link_stale")) return c.json({ error: "dynamic_link_stale" }, 409);
  if (message.includes("dynamic_link_archived")) return c.json({ error: "dynamic_link_archived" }, 409);
  if (message.includes("dynamic_link_not_found")) return c.json({ error: "dynamic_link_not_found" }, 404);
  if (error instanceof SupabaseRestError) return c.json({ error: "dynamic_link_storage_failed" }, 502);
  return c.json({ error: "dynamic_link_invalid" }, 400);
}

function isStatus(value: string | undefined): value is "available" | "active" | "suspended" | "archived" {
  return value === "available" || value === "active" || value === "suspended" || value === "archived";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
