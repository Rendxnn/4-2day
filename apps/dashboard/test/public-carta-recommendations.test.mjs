import assert from "node:assert/strict";
import test from "node:test";
import { resolveCartaRecommendationIds } from "../src/features/public-carta/recommendations.ts";

const menuItems = [
  {
    id: "water-menu",
    product: { id: "water", name: "Agua", category: "Bebidas" },
  },
  {
    id: "argentina-menu",
    product: { id: "argentina", name: "Hamburguesa Argentina", category: "Hamburguesas" },
  },
  {
    id: "colombiana-menu",
    product: { id: "colombiana", name: "Hamburguesa Colombiana", category: "Hamburguesas" },
  },
];

test("uses only visible API recommendation IDs", () => {
  const ids = resolveCartaRecommendationIds({
    apiItemIds: ["removed-menu", "argentina-menu", "argentina-menu"],
    answer: "Te recomiendo la Argentina.",
    menuItems,
    question: "¿Qué recomiendas?",
  });

  assert.deepEqual(ids, ["argentina-menu"]);
});

test("recovers visual recommendations from product names when an older API returns only text", () => {
  const ids = resolveCartaRecommendationIds({
    answer: "Te recomiendo la Hamburguesa Argentina y la Hamburguesa Colombiana.",
    menuItems,
    question: "¿Qué hamburguesas me recomiendas?",
  });

  assert.deepEqual(ids, ["argentina-menu", "colombiana-menu"]);
});

test("recovers category recommendations without showing unrelated products", () => {
  const ids = resolveCartaRecommendationIds({
    answer: "Tenemos opciones deliciosas.",
    menuItems,
    question: "¿Qué hamburguesas me recomiendas?",
  });

  assert.deepEqual(ids, ["argentina-menu", "colombiana-menu"]);
});

test("does not add product cards to ordinary informational answers", () => {
  const ids = resolveCartaRecommendationIds({
    answer: "La dirección del restaurante está en la carta.",
    menuItems,
    question: "¿Dónde están ubicados?",
  });

  assert.deepEqual(ids, []);
});
