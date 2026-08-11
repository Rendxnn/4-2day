import { Hono } from "hono";
import type { MenuItem, PublicCartaConciergeReply, PublicCartaPayload } from "@42day/types";
import type { ApiBindings } from "../../../lib/bindings";
import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import type {
  LocationRow,
  MenuItemRow,
  MenuRow,
  TenantRow,
  DashboardVariables,
} from "../types";
import {
  selectProductOptions,
  selectProducts,
} from "../support/catalog";
import { resolveBusinessDate } from "../support/date";
import { mapLocation, mapMenu, mapMenuItem, mapProduct } from "../support/mappers";
import { loadRestaurantKnowledgeSnapshot } from "../../carta-concierge/repository";
import { answerCartaConciergeQuestion, parseCartaConciergeHistory, parseCartaConciergeQuestion } from "../../carta-concierge/service";

export const publicCartaRoutes = new Hono<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}>();

publicCartaRoutes.get("/public/:tenantSlug/carta", async (c) => {
  const context = await loadPublicCartaContext(c.env, c.req.param("tenantSlug"), c.req.query("date"));

  if (!context) {
    return c.json({ error: "tenant_not_found" }, 404);
  }

  const payload: PublicCartaPayload = {
    tenant: {
      name: context.tenant.name ?? context.tenant.slug,
      slug: context.tenant.slug,
    },
    experience: {
      mode: context.tenant.automation_enabled === false ? "standalone" : "connected",
      whatsappAutomationEnabled: context.tenant.automation_enabled !== false,
    },
    requestedDate: context.date,
    generatedAt: new Date().toISOString(),
    location: context.location ? mapLocation(context.location) : undefined,
    menu: context.menu ? mapMenu(context.menu) : undefined,
    items: context.items,
  };

  return c.json(payload);
});

publicCartaRoutes.post("/public/:tenantSlug/carta/concierge", async (c) => {
  const body = await c.req.json().catch(() => undefined) as { question?: unknown; history?: unknown } | undefined;
  const question = parseCartaConciergeQuestion(body?.question);
  if (!question) {
    return c.json({ error: "invalid_carta_concierge_question" }, 400);
  }

  const context = await loadPublicCartaContext(c.env, c.req.param("tenantSlug"));
  if (!context) {
    return c.json({ error: "tenant_not_found" }, 404);
  }

  const knowledge = await loadRestaurantKnowledgeSnapshot({
    env: c.env,
    schemaName: context.tenant.schema_name,
  });
  const reply = await answerCartaConciergeQuestion({
    env: c.env,
    tenantId: context.tenant.id,
    restaurantName: context.tenant.name ?? context.tenant.slug,
    question,
    history: parseCartaConciergeHistory(body?.history),
    orderingMode: context.tenant.automation_enabled === false ? "standalone" : "connected",
    menuItems: context.items.map((item) => ({
      menuItemId: item.id,
      id: item.productId,
      name: item.displayName ?? item.product?.name ?? "Producto",
      description: item.product?.description,
      price: item.priceOverride ?? item.product?.basePrice,
      category: item.product?.category,
    })),
    knowledge: knowledge.document,
  });

  c.header("Cache-Control", "no-store");
  return c.json({
    answer: reply.answer,
    recommendedItemIds: reply.recommendedItemIds,
  } satisfies PublicCartaConciergeReply);
});

async function loadPublicCartaContext(
  env: ApiBindings,
  tenantSlug: string,
  requestedDate?: string,
): Promise<{
  tenant: TenantRow;
  date: string;
  location?: LocationRow;
  menu?: MenuRow;
  items: MenuItem[];
} | null> {
  const supabase = createSupabaseRestClient(env);
  const [tenant] = await supabase.select<TenantRow>({
    schema: "control",
    table: "tenants",
    query: {
      select: "id,name,slug,schema_name,timezone,automation_enabled",
      slug: `eq.${tenantSlug}`,
      status: "eq.active",
      limit: 1,
    },
  });

  if (!tenant) return null;

  const date = resolveBusinessDate(requestedDate, tenant.timezone);
  const [location] = await supabase.select<LocationRow>({
    schema: tenant.schema_name,
    table: "locations",
    query: {
      select: "id,name,address,phone,delivery_fee_fixed,is_active",
      is_active: "eq.true",
      limit: 1,
    },
  });

  const [menu] = location
    ? await supabase.select<MenuRow>({
        schema: tenant.schema_name,
        table: "menus",
        query: {
          select: "id,location_id,date,name,status,published_at",
          location_id: `eq.${location.id}`,
          date: `eq.${date}`,
          status: "eq.published",
          limit: 1,
        },
      })
    : [];

  const itemRows = menu
    ? await supabase.select<MenuItemRow>({
        schema: tenant.schema_name,
        table: "menu_items",
        query: {
          select: "id,menu_id,product_id,combo_id,display_name,price_override,available_quantity,is_available,sort_order",
          menu_id: `eq.${menu.id}`,
          is_available: "eq.true",
          removed_at: "is.null",
          order: "sort_order.asc",
        },
      })
    : [];

  const productIds = itemRows
    .map((item) => item.product_id)
    .filter((productId): productId is string => Boolean(productId));
  const products = productIds.length > 0
    ? await selectProducts(supabase, tenant.schema_name, {
        id: `in.(${productIds.join(",")})`,
        is_active: "eq.true",
      })
    : [];
  const productOptions = await selectProductOptions(supabase, tenant.schema_name, products.map((product) => product.id));
  const productById = new Map(products.map((product) => [product.id, mapProduct(product, productOptions.get(product.id))]));

  return {
    tenant,
    date,
    location,
    menu,
    items: itemRows
      .filter((item) => !item.product_id || productById.has(item.product_id))
      .map((item) => mapMenuItem(item, productById.get(item.product_id ?? "")))
      .filter((item) => item.product?.isActive !== false),
  };
}
