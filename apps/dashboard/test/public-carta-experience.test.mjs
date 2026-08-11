import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../src/App.tsx", import.meta.url);
const conciergePath = new URL("../src/features/public-carta/PublicCartaConcierge.tsx", import.meta.url);
const detailPath = new URL("../src/features/public-carta/PublicCartaProductDetail.tsx", import.meta.url);
const landingPath = new URL("../src/LandingPage.tsx", import.meta.url);

test("the public carta opens every product in a reusable detail", async () => {
  const [app, detail] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(detailPath, "utf8"),
  ]);

  assert.match(app, /<PublicCartaCard[\s\S]*onOpen=\{\(\) => setSelectedCartaItem\(item\)\}/);
  assert.match(app, /<PublicCartaProductDetail/);
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /Preguntarle al mesero/);
  assert.match(detail, /Opciones del plato/);
});

test("the carta remains renderable while an older API has no experience field", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /payload\?\.experience\?\.mode \?\? "connected"/);
  assert.doesNotMatch(app, /payload\?\.experience\.mode/);
});

test("concierge renders only API-linked menu recommendations and supports inspection", async () => {
  const concierge = await readFile(conciergePath, "utf8");

  assert.match(concierge, /response\.recommendedItemIds/);
  assert.match(concierge, /menuItemById\.get\(itemId\)/);
  assert.match(concierge, /<ConciergeProductRow/);
  assert.match(concierge, /setInspectedItem\(item\)/);
  assert.match(concierge, /<ConciergeInlineProductDetail/);
  assert.match(concierge, /Volver a la conversación/);
  assert.match(concierge, /Preguntar por este plato/);
});

test("mobile carta uses a compact two-column grid that expands for tablet and desktop", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /grid grid-cols-2[^"]*md:grid-cols-3[^"]*xl:grid-cols-4/);
  assert.match(app, /relative aspect-square[^"]*sm:aspect-\[4\/3\]/);
  assert.match(app, /hidden line-clamp-2[^"]*md:block/);
});

test("waiter messages do not push WhatsApp unless the visitor explicitly asks how to order", async () => {
  const concierge = await readFile(conciergePath, "utf8");

  assert.doesNotMatch(concierge, /cuando (?:ya )?tengas algo claro|continuamos por WhatsApp/i);
  assert.match(concierge, /Pregunta con confianza: ingredientes, porciones, sabores o recomendaciones/);
});

test("the waiter nudge is delayed and limited to the visitor session", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /window\.sessionStorage\.getItem\(storageKey\)/);
  assert.match(app, /window\.setTimeout\(\(\) => \{/);
  assert.match(app, /9_000/);
});

test("landing presents the AI menu as a standalone product", async () => {
  const landing = await readFile(landingPath, "utf8");

  assert.match(landing, /id="carta-ia"/);
  assert.match(landing, /También disponible por separado/);
  assert.match(landing, /Una carta digital que sabe vender/);
  assert.match(landing, /producto independiente/i);
});

test("admin can provision a restaurant in menu-only mode without a new database role", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /experienceMode: "connected" \| "standalone"/);
  assert.match(app, /Solo carta digital \+ mesero IA/);
  assert.match(app, /automationEnabled: createForm\.experienceMode === "connected"/);
});
