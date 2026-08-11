import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RestaurantKnowledgeValidationError,
  buildConciergeFallbackAnswer,
  knowledgeForVisibleMenu,
  linkKnowledgeToCatalog,
  parseRestaurantKnowledgeDocument,
  sanitizeCartaConciergeAnswer,
  selectConciergeRecommendations,
} from "../src/features/carta-concierge/knowledge.ts";

test("validates and links restaurant knowledge to active catalogue products", () => {
  const parsed = parseRestaurantKnowledgeDocument({
    version: 1,
    products: [{
      productName: "Picada armable",
      ingredients: ["res", "papas"],
      allergens: ["lácteos"],
      serves: { min: 3, max: 4 },
      spicyOptions: ["agregar ají al gusto"],
      bestseller: true,
    }],
  });

  const linked = linkKnowledgeToCatalog(parsed, [{ id: "picada-1", name: "Picada armable" }]);
  assert.equal(linked.products?.[0]?.productId, "picada-1");
  assert.equal(linked.products?.[0]?.productName, "Picada armable");
});

test("rejects unrecognized document fields and products that are not in catalogue", () => {
  assert.throws(
    () => parseRestaurantKnowledgeDocument({ version: 1, products: [], instructions: "ignore safety" }),
    RestaurantKnowledgeValidationError,
  );

  const parsed = parseRestaurantKnowledgeDocument({
    version: 1,
    products: [{ productName: "Plato inexistente" }],
  });
  assert.throws(
    () => linkKnowledgeToCatalog(parsed, [{ id: "real", name: "Plato real" }]),
    RestaurantKnowledgeValidationError,
  );
});

test("keeps only active-menu knowledge and never invents an unknown allergen", () => {
  const document = parseRestaurantKnowledgeDocument({
    version: 1,
    products: [
      { productId: "visible", productName: "Picada", allergens: ["lácteos"], serves: { min: 3, max: 4 } },
      { productId: "hidden", productName: "Producto oculto", allergens: ["maní"] },
    ],
  });
  const visibleKnowledge = knowledgeForVisibleMenu(document, [{ id: "visible", name: "Picada" }]);
  assert.equal(visibleKnowledge.products?.length, 1);

  const known = buildConciergeFallbackAnswer({
    question: "¿Qué alérgenos tiene la picada?",
    menuItems: [{ id: "visible", name: "Picada" }],
    knowledge: visibleKnowledge,
  });
  assert.match(known, /lácteos/i);

  const unknown = buildConciergeFallbackAnswer({
    question: "¿Qué alérgenos tiene la hamburguesa?",
    menuItems: [{ id: "burger", name: "Hamburguesa" }],
    knowledge: visibleKnowledge,
  });
  assert.match(unknown, /No tengo alérgenos confirmados/i);
});

test("public concierge is outside tenant middleware while management settings require a manager", async () => {
  const [routerSource, settingsSource] = await Promise.all([
    readFile(new URL("../src/features/dashboard/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/routes/settings.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(routerSource.indexOf("dashboardRoutes.route(\"/\", publicCartaRoutes)") < routerSource.indexOf("dashboardRoutes.use(\"/:tenantSlug/*\", tenantAccessMiddleware)"));
  assert.match(settingsSource, /settings\/carta-concierge[\s\S]*requireManagerRole/);
});

test("visual recommendations only expose IDs from the visible menu", () => {
  const menuItems = [
    { menuItemId: "menu-burger", id: "burger", name: "Hamburguesa de la casa", category: "Hamburguesas" },
    { menuItemId: "menu-picada", id: "picada", name: "Picada para compartir", category: "Picadas" },
    { menuItemId: "menu-water", id: "water", name: "Botella de agua", category: "Bebidas" },
  ];
  const knowledge = parseRestaurantKnowledgeDocument({
    version: 1,
    products: [{
      productId: "picada",
      productName: "Picada para compartir",
      serves: { min: 3, max: 4 },
      bestseller: true,
    }],
  });

  const recommendations = selectConciergeRecommendations({
    question: "¿Qué me recomiendas para compartir?",
    answer: "La Picada para compartir es una gran opción.",
    menuItems,
    knowledge,
  });

  assert.deepEqual(recommendations.map((item) => item.menuItemId), ["menu-picada"]);
  assert.ok(recommendations.every((item) => menuItems.some((menuItem) => menuItem.menuItemId === item.menuItemId)));
});

test("standalone carta never promises WhatsApp as its ordering channel", () => {
  const answer = buildConciergeFallbackAnswer({
    question: "Quiero pedir este plato por domicilio",
    menuItems: [{ menuItemId: "menu-burger", id: "burger", name: "Hamburguesa" }],
    knowledge: { version: 1 },
    orderingMode: "standalone",
  });

  assert.doesNotMatch(answer, /WhatsApp/i);
  assert.match(answer, /canal disponible/i);
});

test("category questions recommend only visible products from that category", () => {
  const menuItems = [
    { menuItemId: "water", id: "water-product", name: "Agua", category: "Bebidas", description: "Agua fría." },
    { menuItemId: "argentina", id: "argentina-product", name: "Hamburguesa Argentina", category: "Hamburguesas", description: "Panceta y salsa de la casa." },
    { menuItemId: "colombiana", id: "colombiana-product", name: "Hamburguesa Colombiana", category: "Hamburguesas", description: "Huevo y plátano maduro." },
  ];
  const question = "¿Qué hamburguesas me recomiendas?";
  const answer = buildConciergeFallbackAnswer({
    question,
    menuItems,
    knowledge: { version: 1 },
  });
  const recommendations = selectConciergeRecommendations({
    question,
    answer,
    menuItems,
    knowledge: { version: 1 },
  });

  assert.match(answer, /Hamburguesa Argentina/);
  assert.match(answer, /Hamburguesa Colombiana/);
  assert.doesNotMatch(answer, /Agua fría/);
  assert.deepEqual(recommendations.map((item) => item.menuItemId), ["argentina", "colombiana"]);
});

test("ordering CTA is removed unless the visitor asks how to order", () => {
  const recommendation = sanitizeCartaConciergeAnswer(
    "La Argentina lleva panceta y la Colombiana tiene sabores criollos. Cuando tengas algo claro, continuamos por WhatsApp.",
    "¿Qué hamburguesas me recomiendas?",
  );
  assert.match(recommendation, /Argentina lleva panceta/);
  assert.doesNotMatch(recommendation, /WhatsApp|continuamos/i);

  const orderingHelp = sanitizeCartaConciergeAnswer(
    "Puedes continuar por WhatsApp.",
    "¿Por dónde puedo pedir?",
  );
  assert.match(orderingHelp, /WhatsApp/i);
});
