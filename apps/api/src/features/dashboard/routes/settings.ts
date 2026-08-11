import { Hono } from "hono";
import type { AutomationSettings, RestaurantKnowledgeDocument } from "@42day/types";
import type { ApiBindings } from "../../../lib/bindings";
import { SupabaseRestError, createSupabaseRestClient } from "../../../lib/supabase-rest";
import type { DashboardVariables, LocationRow, TenantRow } from "../types";
import { getTenantUserRole } from "../auth";
import {
  activatePaymentAccount,
  activatePaymentQr,
  createPaymentAccount,
  createPaymentQr,
  deactivatePaymentAccount,
  deactivatePaymentQr,
  deletePaymentAccount,
  deletePaymentQr,
  getPrimaryLocation,
  loadPaymentConfiguration,
  loadPaymentConfigurationHealth,
  updatePaymentAccount,
  updatePaymentQr,
} from "../payment-configuration";
import {
  getDeliveryCoverageSettings,
  parseDeliveryCoverageSettingsUpdate,
} from "../../delivery-coverage/service";
import { linkKnowledgeToCatalog, parseRestaurantKnowledgeDocument, RestaurantKnowledgeValidationError } from "../../carta-concierge/knowledge";
import { loadRestaurantKnowledgeSnapshot, saveRestaurantKnowledgeSnapshot } from "../../carta-concierge/repository";
import { selectProducts } from "../support/catalog";
import {
  mapRestaurantPublicProfileSettings,
  parseRestaurantPublicProfileSettingsUpdate,
  toRestaurantPublicProfileDatabaseValues,
} from "../../public-profile/service";

export const settingsDashboardRoutes = new Hono<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}>();

async function requireManagerRole(c: any) {
  const tenant = c.get("tenant");
  const authUser = c.get("authUser");
  const role = await getTenantUserRole(c.env, authUser.id, tenant.id);

  if (role !== "encargado") {
    return null;
  }

  return role;
}

settingsDashboardRoutes.get("/:tenantSlug/settings/automation", async (c) => {
  const tenant = c.get("tenant");
  const [location] = await createSupabaseRestClient(c.env).select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: "id,name,address,phone,delivery_fee_fixed,automation_enabled,is_active",
      is_active: "eq.true",
      limit: 1,
    },
  });

  const payload: AutomationSettings = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantAutomationEnabled: true,
    locationAutomationEnabled: location?.automation_enabled,
  };

  const [tenantRow] = await createSupabaseRestClient(c.env).select<TenantRow & { automation_enabled: boolean }>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,slug,schema_name,timezone,automation_enabled",
      id: `eq.${tenant.id}`,
      limit: 1,
    },
  });

  payload.tenantAutomationEnabled = tenantRow?.automation_enabled ?? true;

  return c.json(payload);
});

settingsDashboardRoutes.patch("/:tenantSlug/settings/automation", async (c) => {
  const tenant = c.get("tenant");
  const body = await c.req.json<{ enabled: boolean }>();
  const supabase = createSupabaseRestClient(c.env);
  const [location] = await supabase.select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: "id,name,address,phone,delivery_fee_fixed,automation_enabled,is_active",
      is_active: "eq.true",
      limit: 1,
    },
  });

  await Promise.all([
    supabase.update({
      schema: "control",
      table: "tenants",
      values: {
        automation_enabled: body.enabled,
        updated_at: new Date().toISOString(),
      },
      query: {
        id: `eq.${tenant.id}`,
      },
    }),
    location
      ? supabase.update({
          schema: tenant.schema_name,
          table: "locations",
          values: {
            automation_enabled: body.enabled,
            updated_at: new Date().toISOString(),
          },
          query: {
            id: `eq.${location.id}`,
          },
        })
      : Promise.resolve([]),
  ]);

  return c.json({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantAutomationEnabled: body.enabled,
    locationAutomationEnabled: location ? body.enabled : undefined,
  } satisfies AutomationSettings);
});

settingsDashboardRoutes.get("/:tenantSlug/settings/carta-concierge", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  return c.json(await loadRestaurantKnowledgeSnapshot({
    env: c.env,
    schemaName: tenant.schema_name,
  }));
});

settingsDashboardRoutes.put("/:tenantSlug/settings/carta-concierge", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 300_000) {
    return c.json({ error: "carta_concierge_document_too_large" }, 413);
  }

  const body = await c.req.json().catch(() => undefined) as {
    document?: unknown;
    sourceFileName?: unknown;
  } | undefined;
  const sourceFileName = typeof body?.sourceFileName === "string" ? body.sourceFileName.trim().slice(0, 180) : undefined;

  try {
    const document = parseRestaurantKnowledgeDocument(body?.document) as RestaurantKnowledgeDocument;
    const products = await selectProducts(createSupabaseRestClient(c.env), tenant.schema_name);
    const linkedDocument = linkKnowledgeToCatalog(document, products.map((product) => ({ id: product.id, name: product.name })));
    const snapshot = await saveRestaurantKnowledgeSnapshot({
      env: c.env,
      schemaName: tenant.schema_name,
      document: linkedDocument,
      sourceFileName,
    });
    return c.json(snapshot);
  } catch (error) {
    if (error instanceof RestaurantKnowledgeValidationError) {
      return c.json({ error: "invalid_restaurant_knowledge_document", issues: error.issues.slice(0, 12) }, 400);
    }
    throw error;
  }
});

settingsDashboardRoutes.get("/:tenantSlug/settings/public-profile", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const [location] = await createSupabaseRestClient(c.env).select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: [
        "id", "name", "phone", "is_active", "public_profile_enabled",
        "public_profile_headline", "whatsapp_contact", "instagram_url",
        "facebook_url", "tiktok_url", "website_url", "maps_url", "survey_url",
      ].join(","),
      is_active: "eq.true",
      limit: 1,
    },
  });

  return location
    ? c.json(mapRestaurantPublicProfileSettings(location, tenant.slug))
    : c.json({ error: "active_location_not_found" }, 404);
});

settingsDashboardRoutes.patch("/:tenantSlug/settings/public-profile", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = parseRestaurantPublicProfileSettingsUpdate(await c.req.json().catch(() => undefined));
  if (!body) {
    return c.json({ error: "invalid_public_profile_settings" }, 400);
  }

  const supabase = createSupabaseRestClient(c.env);
  const [location] = await supabase.select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: "id,name,phone,is_active",
      is_active: "eq.true",
      limit: 1,
    },
  });
  if (!location) return c.json({ error: "active_location_not_found" }, 404);

  await supabase.update({
    schema: tenant.schema_name,
    table: "locations",
    query: { id: `eq.${location.id}` },
    values: toRestaurantPublicProfileDatabaseValues(body),
  });

  const [updated] = await supabase.select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: [
        "id", "name", "phone", "is_active", "public_profile_enabled",
        "public_profile_headline", "whatsapp_contact", "instagram_url",
        "facebook_url", "tiktok_url", "website_url", "maps_url", "survey_url",
      ].join(","),
      id: `eq.${location.id}`,
      limit: 1,
    },
  });

  return updated
    ? c.json(mapRestaurantPublicProfileSettings(updated, tenant.slug))
    : c.json({ error: "active_location_not_found" }, 404);
});

settingsDashboardRoutes.get("/:tenantSlug/settings/delivery-coverage", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const settings = await getDeliveryCoverageSettings({
    env: c.env,
    schemaName: tenant.schema_name,
  });

  return settings
    ? c.json(settings)
    : c.json({ error: "active_location_not_found" }, 404);
});

settingsDashboardRoutes.patch("/:tenantSlug/settings/delivery-coverage", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = parseDeliveryCoverageSettingsUpdate(await c.req.json().catch(() => undefined));
  if (!body) {
    return c.json({ error: "invalid_delivery_coverage_settings" }, 400);
  }

  const current = await getDeliveryCoverageSettings({
    env: c.env,
    schemaName: tenant.schema_name,
  });
  if (!current) {
    return c.json({ error: "active_location_not_found" }, 404);
  }

  await createSupabaseRestClient(c.env).update({
    schema: tenant.schema_name,
    table: "locations",
    values: {
      delivery_enabled: body.deliveryEnabled,
      delivery_fee_fixed: body.deliveryFeeFixed,
      electronic_billing_enabled: body.electronicBillingEnabled,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      restaurant_city: body.restaurantCity ?? null,
      restaurant_department: body.restaurantDepartment ?? null,
      restaurant_country: body.restaurantCountry,
      delivery_radius_km: body.deliveryRadiusKm,
      allow_written_address_reference: body.allowWrittenAddressReference,
      try_geocode_written_addresses: body.tryGeocodeWrittenAddresses,
      allow_out_of_coverage_orders: body.allowOutOfCoverageOrders,
      request_location_message: body.requestLocationMessage,
      written_address_fallback_message: body.writtenAddressFallbackMessage,
      out_of_coverage_message: body.outOfCoverageMessage,
      updated_at: new Date().toISOString(),
    },
    query: { id: `eq.${current.locationId}` },
  });

  const updated = await getDeliveryCoverageSettings({
    env: c.env,
    schemaName: tenant.schema_name,
    locationId: current.locationId,
  });

  return updated
    ? c.json(updated)
    : c.json({ error: "active_location_not_found" }, 404);
});

settingsDashboardRoutes.get("/:tenantSlug/settings/payment-configuration", async (c) => {
  const tenant = c.get("tenant");
  const snapshot = await loadPaymentConfiguration(c.env, tenant);
  return c.json(snapshot);
});

settingsDashboardRoutes.get("/:tenantSlug/settings/payment-configuration/health", async (c) => {
  const tenant = c.get("tenant");
  const health = await loadPaymentConfigurationHealth(c.env, tenant);
  return c.json(health);
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-accounts", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  const body = await c.req.json().catch(() => ({})) as {
    bankName?: string;
    accountNumber?: string;
    holderName?: string;
    isActive?: boolean;
  };

  if (!String(body.bankName ?? "").trim()) {
    return c.json({ error: "payment_account_bank_name_required" }, 400);
  }
  if (!String(body.accountNumber ?? "").trim()) {
    return c.json({ error: "payment_account_number_required" }, 400);
  }
  if (!String(body.holderName ?? "").trim()) {
    return c.json({ error: "payment_account_holder_name_required" }, 400);
  }

  try {
    await createPaymentAccount({
      env: c.env,
      tenant,
      locationId: location.id,
      bankName: String(body.bankName),
      accountNumber: String(body.accountNumber),
      holderName: String(body.holderName),
      isActive: body.isActive === true,
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true }, 201);
});

settingsDashboardRoutes.patch("/:tenantSlug/settings/payment-accounts/:accountId", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  const body = await c.req.json().catch(() => ({})) as {
    bankName?: string;
    accountNumber?: string;
    holderName?: string;
    isActive?: boolean;
  };

  if (body.bankName !== undefined && !String(body.bankName).trim()) {
    return c.json({ error: "payment_account_bank_name_required" }, 400);
  }
  if (body.accountNumber !== undefined && !String(body.accountNumber).trim()) {
    return c.json({ error: "payment_account_number_required" }, 400);
  }
  if (body.holderName !== undefined && !String(body.holderName).trim()) {
    return c.json({ error: "payment_account_holder_name_required" }, 400);
  }

  try {
    await updatePaymentAccount({
      env: c.env,
      tenant,
      accountId: c.req.param("accountId"),
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      holderName: body.holderName,
      isActive: body.isActive,
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.delete("/:tenantSlug/settings/payment-accounts/:accountId", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    await deletePaymentAccount({
      env: c.env,
      tenant,
      accountId: c.req.param("accountId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-accounts/:accountId/activate", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  try {
    await activatePaymentAccount({
      env: c.env,
      tenant,
      locationId: location.id,
      accountId: c.req.param("accountId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-accounts/:accountId/deactivate", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    await deactivatePaymentAccount({
      env: c.env,
      tenant,
      accountId: c.req.param("accountId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-qrs", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  const form = await c.req.parseBody();
  const label = String(form.label ?? "");
  const isActive = String(form.isActive ?? "false") === "true";
  const file = form.file;

  if (!label.trim()) {
    return c.json({ error: "payment_qr_label_required" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "payment_qr_image_required" }, 400);
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return c.json({ error: "unsupported_qr_image_type" }, 400);
  }

  try {
    await createPaymentQr({
      env: c.env,
      tenant,
      locationId: location.id,
      label,
      file,
      isActive,
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true }, 201);
});

settingsDashboardRoutes.patch("/:tenantSlug/settings/payment-qrs/:qrId", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  const form = await c.req.parseBody();
  const label = form.label;
  const file = form.file;

  if (label !== undefined && !String(label).trim()) {
    return c.json({ error: "payment_qr_label_required" }, 400);
  }
  if (file !== undefined && !(file instanceof File)) {
    return c.json({ error: "payment_qr_image_required" }, 400);
  }
  if (file instanceof File && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return c.json({ error: "unsupported_qr_image_type" }, 400);
  }

  try {
    await updatePaymentQr({
      env: c.env,
      tenant,
      qrId: c.req.param("qrId"),
      label: label !== undefined ? String(label) : undefined,
      file: file instanceof File ? file : undefined,
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.delete("/:tenantSlug/settings/payment-qrs/:qrId", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    await deletePaymentQr({
      env: c.env,
      tenant,
      qrId: c.req.param("qrId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-qrs/:qrId/activate", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const location = await getPrimaryLocation(c.env, tenant);
  if (!location) {
    return c.json({ error: "payment_configuration_location_not_found" }, 409);
  }

  try {
    await activatePaymentQr({
      env: c.env,
      tenant,
      qrId: c.req.param("qrId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

settingsDashboardRoutes.post("/:tenantSlug/settings/payment-qrs/:qrId/deactivate", async (c) => {
  const tenant = c.get("tenant");
  if (!(await requireManagerRole(c))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    await deactivatePaymentQr({
      env: c.env,
      tenant,
      qrId: c.req.param("qrId"),
    });
  } catch (error) {
    return handlePaymentConfigurationError(c, error);
  }

  return c.json({ ok: true });
});

function handlePaymentConfigurationError(c: any, error: unknown) {
  const message = error instanceof Error ? error.message : "payment_configuration_failed";
  const supabaseBody = error instanceof SupabaseRestError ? error.body : "";

  if (message === "accounts_active_limit_reached" || supabaseBody.includes("accounts_active_limit_reached")) {
    return c.json({ error: "accounts_active_limit_reached" }, 409);
  }
  if (message === "active_account_delete_forbidden") {
    return c.json({ error: message }, 409);
  }
  if (message === "payment_qr_active_conflict" || supabaseBody.includes("payment_qrs_single_active_idx")) {
    return c.json({ error: "payment_qr_active_conflict" }, 409);
  }
  if (message === "active_qr_delete_forbidden") {
    return c.json({ error: message }, 409);
  }
  if (message === "payment_account_not_found" || message === "payment_qr_not_found") {
    return c.json({ error: message }, 404);
  }
  if (message === "unsupported_qr_image_type") {
    return c.json({ error: message }, 400);
  }
  if (message.startsWith("supabase_storage_upload_failed:")) {
    return c.json({ error: "payment_qr_upload_failed" }, 502);
  }
  if (message.startsWith("supabase_storage_delete_failed:")) {
    return c.json({ error: "payment_qr_storage_cleanup_failed" }, 502);
  }

  console.error("payment_configuration_failed", { message });
  return c.json({ error: "payment_configuration_failed" }, 502);
}
