import type { RestaurantKnowledgeDocument, RestaurantKnowledgeProduct } from "@42day/types";

const ROOT_KEYS = new Set(["version", "restaurant", "products", "faq"]);
const RESTAURANT_KEYS = new Set(["assistantName", "voice", "culinaryStyle", "highlights", "serviceNotes"]);
const PRODUCT_KEYS = new Set([
  "productId",
  "productName",
  "aliases",
  "ingredients",
  "allergens",
  "dietaryNotes",
  "pairings",
  "recommendations",
  "spicyOptions",
  "servingNotes",
  "facts",
  "serves",
  "bestseller",
]);
const SERVES_KEYS = new Set(["min", "max", "label"]);
const FAQ_KEYS = new Set(["question", "answer"]);
const MAX_PRODUCTS = 250;
const MAX_TEXT_LENGTH = 320;
const MAX_LIST_ITEMS = 20;

export type CatalogKnowledgeProduct = {
  id: string;
  name: string;
};

export type PublicCartaKnowledgeItem = {
  menuItemId: string;
  id?: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
};

export class RestaurantKnowledgeValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("invalid_restaurant_knowledge_document");
    this.issues = issues;
  }
}

export function emptyRestaurantKnowledgeDocument(): RestaurantKnowledgeDocument {
  return { version: 1 };
}

/**
 * Validates the uploaded JSON before it reaches the database. The schema is
 * intentionally closed so a typo cannot silently become a fact the concierge
 * later presents to a diner.
 */
export function parseRestaurantKnowledgeDocument(input: unknown): RestaurantKnowledgeDocument {
  const issues: string[] = [];
  const root = readObject(input, "root", issues);
  if (!root) throw new RestaurantKnowledgeValidationError(issues);
  rejectUnknownKeys(root, ROOT_KEYS, "root", issues);

  if (root.version !== 1) {
    issues.push("root.version debe ser 1.");
  }

  const restaurant = parseRestaurant(root.restaurant, issues);
  const products = parseProducts(root.products, issues);
  const faq = parseFaq(root.faq, issues);

  if (issues.length > 0) throw new RestaurantKnowledgeValidationError(issues);

  return {
    version: 1,
    ...(restaurant ? { restaurant } : {}),
    ...(products.length > 0 ? { products } : {}),
    ...(faq.length > 0 ? { faq } : {}),
  };
}

export function linkKnowledgeToCatalog(
  document: RestaurantKnowledgeDocument,
  catalogProducts: CatalogKnowledgeProduct[],
): RestaurantKnowledgeDocument {
  const issues: string[] = [];
  const catalogById = new Map(catalogProducts.map((product) => [product.id, product]));
  const catalogByName = new Map<string, CatalogKnowledgeProduct[]>();

  for (const product of catalogProducts) {
    const key = normalizeText(product.name);
    const matches = catalogByName.get(key) ?? [];
    matches.push(product);
    catalogByName.set(key, matches);
  }

  const products = (document.products ?? []).map((entry, index) => {
    let product = entry.productId ? catalogById.get(entry.productId) : undefined;
    if (!product && entry.productName) {
      const matches = catalogByName.get(normalizeText(entry.productName)) ?? [];
      if (matches.length === 1) product = matches[0];
      if (matches.length > 1) issues.push(`products[${index}] coincide con varios productos del catalogo; usa productId.`);
    }

    if (!product) {
      issues.push(`products[${index}] no coincide con un producto activo del catalogo.`);
      return entry;
    }

    return {
      ...entry,
      productId: product.id,
      productName: product.name,
    };
  });

  if (issues.length > 0) throw new RestaurantKnowledgeValidationError(issues);
  return { ...document, ...(products.length > 0 ? { products } : {}) };
}

export function knowledgeForVisibleMenu(
  document: RestaurantKnowledgeDocument,
  menuItems: PublicCartaKnowledgeItem[],
): RestaurantKnowledgeDocument {
  const menuIds = new Set(menuItems.map((item) => item.id).filter((id): id is string => Boolean(id)));
  const menuNames = new Set(menuItems.map((item) => normalizeText(item.name)));
  const products = (document.products ?? []).filter((entry) => (
    (entry.productId ? menuIds.has(entry.productId) : false)
    || (entry.productName ? menuNames.has(normalizeText(entry.productName)) : false)
  ));

  return {
    version: 1,
    ...(document.restaurant ? { restaurant: document.restaurant } : {}),
    ...(products.length > 0 ? { products } : {}),
    ...(document.faq && document.faq.length > 0 ? { faq: document.faq } : {}),
  };
}

export function findKnowledgeForMenuItem(
  document: RestaurantKnowledgeDocument,
  item: PublicCartaKnowledgeItem | undefined,
): RestaurantKnowledgeProduct | undefined {
  if (!item) return undefined;
  const normalizedName = normalizeText(item.name);
  return (document.products ?? []).find((entry) => (
    (item.id && entry.productId === item.id)
    || (entry.productName && normalizeText(entry.productName) === normalizedName)
    || (entry.aliases ?? []).some((alias) => normalizeText(alias) === normalizedName)
  ));
}

export function buildConciergeFallbackAnswer(input: {
  question: string;
  menuItems: PublicCartaKnowledgeItem[];
  knowledge: RestaurantKnowledgeDocument;
  orderingMode?: "connected" | "standalone";
}): string {
  const question = input.question.trim();
  const matchedItem = findMentionedMenuItem(question, input.menuItems);
  const knowledge = findKnowledgeForMenuItem(input.knowledge, matchedItem);
  const normalizedQuestion = normalizeText(question);

  if (/(whatsapp|como (?:puedo |hago para )?pedir|donde (?:puedo )?pedir|por donde (?:puedo )?pedir|quiero pedir|quiero (?:hacer |poner )?(?:un )?pedido|hacer (?:un )?pedido|quiero ordenar)/.test(normalizedQuestion)) {
    return input.orderingMode === "standalone"
      ? "¡De una! Este mesero digital te ayuda a elegir y conocer la carta. Cuando tengas tu favorito, consulta con el restaurante el canal disponible para hacer tu pedido."
      : "¡De una! Este chat te ayuda a elegir y conocer la carta. Cuando tengas tu favorito, escríbele al restaurante por WhatsApp para tomar el pedido con todos los detalles.";
  }

  const faq = (input.knowledge.faq ?? []).find((entry) => hasMeaningfulOverlap(normalizedQuestion, normalizeText(entry.question)));
  if (faq) return faq.answer;

  if (/(alerg|gluten|lactosa|lacteos|vegano|vegetariano)/.test(normalizedQuestion)) {
    if (matchedItem && knowledge?.allergens && knowledge.allergens.length > 0) {
      return `Sobre ${matchedItem.name}: el restaurante reporta ${joinNatural(knowledge.allergens)}. Si tienes una alergia importante, confírmala también directamente con el restaurante antes de pedirlo.`;
    }
    if (matchedItem) {
      return `No tengo alérgenos confirmados para ${matchedItem.name}. Para una alergia o restricción importante, mejor confírmalo directamente con el restaurante antes de hacer el pedido.`;
    }
    return "Puedo revisar alérgenos por plato si me dices cuál estás mirando. Si tu alergia es importante, confirma siempre con el restaurante antes de pedir.";
  }

  if (/(cuantas personas|para cuantas|compartir|porciones|rinde)/.test(normalizedQuestion)) {
    if (matchedItem && knowledge?.serves) {
      return `Sí, ${matchedItem.name} ${formatServes(knowledge.serves)}. ${knowledge.servingNotes?.[0] ?? "Suena como una elección muy rica para compartir."}`;
    }
    if (matchedItem) return `No tengo una porción confirmada para ${matchedItem.name}. Si me dices cuántas personas son, te ayudo a comparar opciones de la carta.`;
  }

  if (/(picante|picoso|aj[ií]|salsa)/.test(normalizedQuestion)) {
    if (matchedItem && knowledge?.spicyOptions && knowledge.spicyOptions.length > 0) {
      return `Con ${matchedItem.name} puedes ${joinNatural(knowledge.spicyOptions)}. Si te gusta el fuego, vale mucho la pena confirmarlo con el restaurante al momento de pedir.`;
    }
    if (matchedItem && knowledge?.pairings && knowledge.pairings.length > 0) {
      return `${matchedItem.name} suele ir muy bien con ${joinNatural(knowledge.pairings)}. Sobre picante no tengo una opción confirmada, así que es mejor validarla con el restaurante.`;
    }
  }

  if (matchedItem) {
    const details = [
      matchedItem.description?.trim(),
      knowledge?.ingredients && knowledge.ingredients.length > 0 ? `Viene con ${joinNatural(knowledge.ingredients)}.` : undefined,
      knowledge?.serves ? formatServes(knowledge.serves, true) : undefined,
      knowledge?.bestseller ? "Es uno de los platos más pedidos del restaurante." : undefined,
      knowledge?.recommendations?.[0],
    ].filter((value): value is string => Boolean(value));
    return `Sii, ${matchedItem.name} suena delicioso. ${details.join(" ") || "Está disponible hoy en la carta."} Te lo recomiendo mucho.`;
  }

  const categoryItems = findMentionedCategoryItems(question, input.menuItems);
  if (categoryItems.length > 0) {
    const category = categoryItems[0]?.category?.trim() || "esta categoría";
    const descriptions = categoryItems.slice(0, 3).map((item) => {
      const description = item.description?.trim();
      return description
        ? `${item.name}: ${description}`
        : `${item.name}, disponible hoy en la carta`;
    });
    return `¡Claro que sí! En ${category} hay opciones muy ricas. Te recomiendo ${joinNatural(descriptions)}. Si me dices qué sabores prefieres, te ayudo a escoger entre ellas.`;
  }

  if (input.menuItems.length === 0) {
    return "Aún no veo platos disponibles en esta carta. Puedes volver a cargarla en un momento o consultar directamente con el restaurante.";
  }

  const suggestions = input.menuItems.slice(0, 3).map((item) => item.name);
  return `¡Claro! Estoy para ayudarte a elegir. Hoy puedes mirar ${joinNatural(suggestions)}. Dime cuál te llamó la atención y te cuento lo que el restaurante ha confirmado.`;
}

export function findMentionedMenuItem(question: string, menuItems: PublicCartaKnowledgeItem[]): PublicCartaKnowledgeItem | undefined {
  const normalizedQuestion = normalizeText(question);
  const matches = menuItems
    .map((item) => ({ item, name: normalizeText(item.name) }))
    .filter(({ name }) => name.length >= 3 && normalizedQuestion.includes(name))
    .sort((left, right) => right.name.length - left.name.length);
  return matches[0]?.item;
}

function findMentionedCategoryItems(
  question: string,
  menuItems: PublicCartaKnowledgeItem[],
): PublicCartaKnowledgeItem[] {
  const normalizedQuestion = normalizeText(question);
  const mentionedCategory = menuItems
    .map((item) => item.category?.trim())
    .filter((category): category is string => Boolean(category))
    .sort((left, right) => right.length - left.length)
    .find((category) => normalizedQuestion.includes(normalizeText(category)));

  if (!mentionedCategory) return [];
  const normalizedCategory = normalizeText(mentionedCategory);
  return menuItems.filter((item) => item.category && normalizeText(item.category) === normalizedCategory);
}

/**
 * Selects only real, visible menu items for the visual recommendation rail.
 * The model never supplies IDs, so a hallucinated product cannot become a
 * clickable card in the public carta.
 */
export function selectConciergeRecommendations(input: {
  question: string;
  answer: string;
  menuItems: PublicCartaKnowledgeItem[];
  knowledge: RestaurantKnowledgeDocument;
  limit?: number;
}): PublicCartaKnowledgeItem[] {
  const limit = Math.max(1, Math.min(input.limit ?? 3, 3));
  const normalizedQuestion = normalizeText(input.question);
  const normalizedAnswer = normalizeText(input.answer);
  const recommendationIntent = /(recom|suger|favorit|popular|vendid|especial|compartir|opcion|que (?:hay|pido|escojo)|cual)/.test(normalizedQuestion);

  const ranked = input.menuItems
    .map((item, index) => {
      const normalizedName = normalizeText(item.name);
      const productKnowledge = findKnowledgeForMenuItem(input.knowledge, item);
      let score = 0;

      if (normalizedQuestion.includes(normalizedName)) score += 120;
      if (normalizedAnswer.includes(normalizedName)) score += 100;
      if (item.category && normalizedQuestion.includes(normalizeText(item.category))) score += 80;
      if (productKnowledge?.bestseller && recommendationIntent) score += 35;
      if (recommendationIntent && productKnowledge?.recommendations?.length) score += 18;
      if (recommendationIntent && productKnowledge?.facts?.length) score += 8;
      if (/(compartir|personas|porciones|rinde)/.test(normalizedQuestion) && productKnowledge?.serves) score += 30;

      return { index, item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (ranked.length > 0) return ranked.slice(0, limit).map(({ item }) => item);
  if (!recommendationIntent) return [];
  return input.menuItems.slice(0, limit);
}

export function sanitizeCartaConciergeAnswer(value: string, question: string): string {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 520);
  if (shouldMentionOrderingChannel(question)) return cleaned;

  return cleaned
    .replace(/(?:[.!?]\s*)?(?:si|cuando)\s+(?:ya\s+)?(?:tengas|tienes)[^.!?]{0,90}(?:whatsapp|pedido|pedir)[.!?]?/gi, "")
    .replace(/(?:[.!?]\s*)?(?:puedes|podemos|contin[uú]a|continuamos|escr[ií]benos)[^.!?]{0,80}(?:por\s+)?whatsapp[^.!?]*[.!?]?/gi, "")
    .replace(/(?:[.!?]\s*)?consulta[^.!?]{0,60}canal[^.!?]{0,30}(?:pedido|pedir)[^.!?]*[.!?]?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function shouldMentionOrderingChannel(question: string): boolean {
  const normalized = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /(whatsapp|como (?:puedo |hago para )?pedir|donde (?:puedo )?pedir|por donde (?:puedo )?pedir|quiero pedir|quiero (?:hacer |poner )?(?:un )?pedido|hacer (?:un )?pedido|quiero ordenar)/.test(normalized);
}

function parseRestaurant(value: unknown, issues: string[]): RestaurantKnowledgeDocument["restaurant"] | undefined {
  if (value === undefined) return undefined;
  const restaurant = readObject(value, "restaurant", issues);
  if (!restaurant) return undefined;
  rejectUnknownKeys(restaurant, RESTAURANT_KEYS, "restaurant", issues);
  return compactObject({
    assistantName: readOptionalText(restaurant.assistantName, "restaurant.assistantName", issues),
    voice: readOptionalText(restaurant.voice, "restaurant.voice", issues),
    culinaryStyle: readOptionalText(restaurant.culinaryStyle, "restaurant.culinaryStyle", issues),
    highlights: readStringList(restaurant.highlights, "restaurant.highlights", issues),
    serviceNotes: readStringList(restaurant.serviceNotes, "restaurant.serviceNotes", issues),
  });
}

function parseProducts(value: unknown, issues: string[]): RestaurantKnowledgeProduct[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push("products debe ser una lista.");
    return [];
  }
  if (value.length > MAX_PRODUCTS) issues.push(`products no puede tener más de ${MAX_PRODUCTS} elementos.`);

  return value.slice(0, MAX_PRODUCTS).flatMap((source, index) => {
    const product = readObject(source, `products[${index}]`, issues);
    if (!product) return [];
    rejectUnknownKeys(product, PRODUCT_KEYS, `products[${index}]`, issues);
    const productId = readOptionalText(product.productId, `products[${index}].productId`, issues);
    const productName = readOptionalText(product.productName, `products[${index}].productName`, issues);
    if (!productId && !productName) issues.push(`products[${index}] requiere productId o productName.`);

    const entry = compactObject({
      productId,
      productName,
      aliases: readStringList(product.aliases, `products[${index}].aliases`, issues),
      ingredients: readStringList(product.ingredients, `products[${index}].ingredients`, issues),
      allergens: readStringList(product.allergens, `products[${index}].allergens`, issues),
      dietaryNotes: readStringList(product.dietaryNotes, `products[${index}].dietaryNotes`, issues),
      pairings: readStringList(product.pairings, `products[${index}].pairings`, issues),
      recommendations: readStringList(product.recommendations, `products[${index}].recommendations`, issues),
      spicyOptions: readStringList(product.spicyOptions, `products[${index}].spicyOptions`, issues),
      servingNotes: readStringList(product.servingNotes, `products[${index}].servingNotes`, issues),
      facts: readStringList(product.facts, `products[${index}].facts`, issues),
      serves: parseServes(product.serves, `products[${index}].serves`, issues),
      bestseller: readOptionalBoolean(product.bestseller, `products[${index}].bestseller`, issues),
    });
    return [entry];
  });
}

function parseFaq(value: unknown, issues: string[]): NonNullable<RestaurantKnowledgeDocument["faq"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push("faq debe ser una lista.");
    return [];
  }
  if (value.length > 50) issues.push("faq no puede tener más de 50 elementos.");
  return value.slice(0, 50).flatMap((source, index) => {
    const faq = readObject(source, `faq[${index}]`, issues);
    if (!faq) return [];
    rejectUnknownKeys(faq, FAQ_KEYS, `faq[${index}]`, issues);
    const question = readRequiredText(faq.question, `faq[${index}].question`, issues);
    const answer = readRequiredText(faq.answer, `faq[${index}].answer`, issues);
    return question && answer ? [{ question, answer }] : [];
  });
}

function parseServes(value: unknown, path: string, issues: string[]): RestaurantKnowledgeProduct["serves"] | undefined {
  if (value === undefined) return undefined;
  const serves = readObject(value, path, issues);
  if (!serves) return undefined;
  rejectUnknownKeys(serves, SERVES_KEYS, path, issues);
  const min = readOptionalPositiveInteger(serves.min, `${path}.min`, issues);
  const max = readOptionalPositiveInteger(serves.max, `${path}.max`, issues);
  const label = readOptionalText(serves.label, `${path}.label`, issues);
  if (min !== undefined && max !== undefined && min > max) issues.push(`${path}.min no puede ser mayor que max.`);
  if (min === undefined && max === undefined && !label) issues.push(`${path} requiere min, max o label.`);
  return compactObject({ min, max, label });
}

function readObject(value: unknown, path: string, issues: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${path} debe ser un objeto.`);
    return undefined;
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, issues: string[]) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issues.push(`${path}.${key} no es un campo permitido.`);
  });
}

function readOptionalText(value: unknown, path: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${path} debe ser texto no vacío.`);
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > MAX_TEXT_LENGTH) {
    issues.push(`${path} no puede superar ${MAX_TEXT_LENGTH} caracteres.`);
    return undefined;
  }
  return normalized;
}

function readRequiredText(value: unknown, path: string, issues: string[]): string | undefined {
  const text = readOptionalText(value, path, issues);
  if (!text && value === undefined) issues.push(`${path} es obligatorio.`);
  return text;
}

function readStringList(value: unknown, path: string, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`${path} debe ser una lista de textos.`);
    return undefined;
  }
  if (value.length > MAX_LIST_ITEMS) issues.push(`${path} no puede tener más de ${MAX_LIST_ITEMS} elementos.`);
  const values = value.slice(0, MAX_LIST_ITEMS)
    .map((entry, index) => readOptionalText(entry, `${path}[${index}]`, issues))
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set(values)];
}

function readOptionalPositiveInteger(value: unknown, path: string, issues: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    issues.push(`${path} debe ser un entero entre 1 y 100.`);
    return undefined;
  }
  return value;
}

function readOptionalBoolean(value: unknown, path: string, issues: string[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push(`${path} debe ser verdadero o falso.`);
    return undefined;
  }
  return value;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function formatServes(serves: NonNullable<RestaurantKnowledgeProduct["serves"]>, includeSubject = false): string {
  if (serves.label) return serves.label;
  if (serves.min && serves.max && serves.min !== serves.max) return includeSubject ? `Ideal para compartir entre ${serves.min} y ${serves.max} personas.` : `alcanza para compartir entre ${serves.min} y ${serves.max} personas`;
  const people = serves.max ?? serves.min;
  return includeSubject ? `Ideal para ${people} ${people === 1 ? "persona" : "personas"}.` : `alcanza para ${people} ${people === 1 ? "persona" : "personas"}`;
}

function joinNatural(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;
}

function hasMeaningfulOverlap(left: string, right: string): boolean {
  const leftWords = new Set(left.split(" ").filter((word) => word.length >= 4));
  const rightWords = new Set(right.split(" ").filter((word) => word.length >= 4));
  let matches = 0;
  leftWords.forEach((word) => { if (rightWords.has(word)) matches += 1; });
  return matches >= 2;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
