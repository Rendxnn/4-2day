import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DashboardNotificationRecord, MenuItem, OrderSummary, Product, ProductCategory, ProductOption, PublicCartaPayload } from "@42day/types";
import type { Session } from "@supabase/supabase-js";
import {
  addMenuItem,
  analyzeMenuFile,
  createAdminRestaurant,
  createAdminRestaurantMember,
  createProduct,
  DashboardApiError,
  deleteAdminRestaurant,
  deleteAdminRestaurantMember,
  deleteMenuItem,
  deleteProduct,
  getAdminOverview,
  getDiagnostics,
  getLunchReminderPreview,
  getMe,
  getPaymentConfigurationHealth,
  getPublicCarta,
  listNotifications,
  listAlerts,
  getTodayMenu,
  listOrders,
  listAdminRestaurants,
  resetAdminRestaurantMemberPassword,
  sendLunchReminders,
  updateMenuItem,
  updateAdminRestaurant,
  updateAdminRestaurantMember,
  updateProduct,
  updateProductCategoryEmoji,
  uploadProductImage,
} from "./api";
import type { AdminOverview, AdminRestaurant, AdminRestaurantMember, AdminRestaurantStatus, DashboardTenant, LunchReminderPreview, LunchReminderSendResult, PaymentConfigurationHealth, TenantRole } from "./api";
import { authConfigured, getSession, onAuthStateChange, signIn, signOut, supabase } from "./auth";
import {
  ArrowDown,
  BarChart3,
  Bell,
  Check,
  ChefHat,
  ChevronDown,
  ClipboardList,
  Copy,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  Home,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Power,
  Plus,
  QrCode,
  Search,
  Settings,
  Store,
  Trash2,
  Utensils,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OrdersView } from "./features/orders/OrdersView";
import unicodeEmojiData from "emojibase-data/meta/unicode.json";
import QRCode from "qrcode";
import { LandingPage } from "./LandingPage";
import { PublicInformationPage } from "./marketing/PublicInformationPage";
import { resolvePublicMarketingPage } from "./marketing/marketingRoutes";
import { ConfigurationView } from "./features/configuration/ConfigurationView";
import { PublicCartaConcierge } from "./features/public-carta/PublicCartaConcierge";
import { PublicCartaProductDetail } from "./features/public-carta/PublicCartaProductDetail";
import { PublicRestaurantProfilePage } from "./features/public-profile/PublicRestaurantProfilePage";
import { AnalyticsSection } from "./features/admin/AnalyticsSection";
import { httpPaymentConfigurationAdapter } from "./features/configuration/paymentConfiguration.http";
import {
  formatDashboardDateTime as formatLocalizedDateTime,
  formatDashboardPrice as formatLocalizedPrice,
  LanguageToggle,
  useDashboardLocale,
} from "./i18n";

type View = "menu" | "orders" | "summary" | "catalog" | "configuration";
type SaveStatus = "loading" | "saving" | "saved" | "offline";
type ProductFormValue = Partial<Product> & { imageFile?: File };
type DashboardNotification = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  orderId?: string;
  draftOrderId?: string;
  conversationId?: string;
  whatsappUrl?: string;
  eventName?: string;
};

type NavigationItem = {
  id: View;
  label: string;
  icon: LucideIcon;
  requiresEncargado?: boolean;
};

const fallbackTenants: DashboardTenant[] = [
  { id: "local-demo", name: "Restaurante Demo", slug: "demo", schemaName: "tenant_demo" },
  { id: "local-arepas", name: "Arepas del Parque", slug: "arepas", schemaName: "tenant_arepas" },
  { id: "local-pizza", name: "Pizza Norte", slug: "pizza", schemaName: "tenant_pizza" },
];

let activeDashboardLocale: "en" | "es" = "es";

const fallbackProducts: Product[] = [
  {
    id: "local-product-1",
    name: "Bandeja paisa ejecutiva",
    description: "Frijoles, arroz, carne molida, huevo, maduro y aguacate.",
    basePrice: 24000,
    category: "almuerzos",
    imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=420&q=80",
    isActive: true,
  },
  {
    id: "local-product-2",
    name: "Pollo a la plancha",
    description: "Pechuga asada con ensalada fresca y papas criollas.",
    basePrice: 21000,
    category: "almuerzos",
    imageUrl: "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=420&q=80",
    isActive: true,
  },
  {
    id: "local-product-3",
    name: "Sopa del dia",
    description: "Entrada caliente preparada con ingredientes del dia.",
    basePrice: 9000,
    category: "entradas",
    imageUrl: "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=420&q=80",
    isActive: true,
  },
];

const fallbackItems: MenuItem[] = fallbackProducts.map((product, index) => ({
  id: `local-item-${index + 1}`,
  menuId: "local-menu",
  productId: product.id,
  displayName: product.name,
  priceOverride: product.basePrice,
  isAvailable: index < 2,
  sortOrder: index,
  product,
}));

function getNavItems(locale: "en" | "es", canAccessConfiguration: boolean): NavigationItem[] {
  const items: NavigationItem[] = [
    {
      id: "menu" as const,
      label: locale === "en" ? "Today" : "Hoy",
      icon: Utensils,
    },
    {
      id: "orders" as const,
      label: locale === "en" ? "Orders" : "Pedidos",
      icon: ClipboardList,
    },
    {
      id: "summary" as const,
      label: locale === "en" ? "Summary" : "Resumen",
      icon: Home,
    },
    {
      id: "catalog" as const,
      label: locale === "en" ? "Products" : "Productos",
      icon: ChefHat,
    },
    {
      id: "configuration" as const,
      label: locale === "en" ? "Settings" : "Configuración",
      icon: Settings,
      requiresEncargado: true,
    },
  ];

  return items.filter((item) => !item.requiresEncargado || canAccessConfiguration);
}

function getViewCopy(locale: "en" | "es"): Record<View, { eyebrow: string; title: string; description: string }> {
  return {
    menu: {
      eyebrow: locale === "en" ? "Daily operations" : "Operacion diaria",
      title: locale === "en" ? "Menu ready for WhatsApp" : "Menu listo para WhatsApp",
      description: "",
    },
    orders: {
      eyebrow: locale === "en" ? "Live operation" : "Operacion en vivo",
      title: locale === "en" ? "Order center" : "Centro de pedidos",
      description: "",
    },
    summary: {
      eyebrow: locale === "en" ? "Summary" : "Resumen",
      title: locale === "en" ? "Service status" : "Estado de servicio",
      description: "",
    },
    catalog: {
      eyebrow: locale === "en" ? "Products" : "Productos",
      title: locale === "en" ? "Product inventory" : "Inventario de productos",
      description: "",
    },
    configuration: {
      eyebrow: locale === "en" ? "Settings" : "Configuración",
      title: locale === "en" ? "Restaurant settings" : "Configuración del restaurante",
      description: "",
    },
  };
}

let toastTimer = 0;
const notifiableOrderStatuses = new Set<OrderSummary["status"]>([
  "new",
  "pending_restaurant_confirmation",
  "needs_customer_replacement",
]);

const foodEmojiRules: Array<{ emoji: string; terms: string[] }> = [
  { emoji: "☕", terms: ["cafe", "capuccino", "cappuccino", "espresso", "latte", "tinto", "mocca", "mocha"] },
  { emoji: "🥤", terms: ["gaseosa", "soda", "coca cola", "coca-cola", "pepsi", "limonada", "malteada"] },
  { emoji: "🧃", terms: ["jugo", "zumo", "guarapo", "chicha", "avena", "batido", "smoothie"] },
  { emoji: "🍺", terms: ["cerveza", "pola"] },
  { emoji: "🍷", terms: ["vino", "sangria"] },
  { emoji: "💧", terms: ["agua"] },
  { emoji: "🍵", terms: ["te", "aromatica", "infusion", "matcha"] },
  { emoji: "🥣", terms: ["sopa", "crema", "caldo", "consome", "ajiaco", "sancocho"] },
  { emoji: "🍳", terms: ["huevo", "omelette", "omelet", "perico", "desayuno"] },
  { emoji: "🥞", terms: ["pancake", "waffle", "hotcake"] },
  { emoji: "🥐", terms: ["croissant", "pan", "tostada", "sanduche", "sandwich"] },
  { emoji: "🍔", terms: ["hamburguesa", "burger"] },
  { emoji: "🍕", terms: ["pizza"] },
  { emoji: "🌮", terms: ["taco", "burrito", "quesadilla"] },
  { emoji: "🫓", terms: ["arepa"] },
  { emoji: "🥟", terms: ["empanada", "pastel", "pastelito"] },
  { emoji: "🍝", terms: ["pasta", "spaghetti", "espagueti", "lasagna", "lasana", "ravioli"] },
  { emoji: "🍚", terms: ["arroz", "chaufa", "risotto"] },
  { emoji: "🥩", terms: ["carne", "res", "bistec", "lomo", "churrasco", "costilla", "punta de anca"] },
  { emoji: "🍗", terms: ["pollo", "gallina", "alitas", "pechuga"] },
  { emoji: "🐟", terms: ["pescado", "tilapia", "salmon", "atun", "trucha", "mojarra"] },
  { emoji: "🦐", terms: ["camaron", "langostino", "mariscos", "ceviche"] },
  { emoji: "🐷", terms: ["cerdo", "tocino", "chicharron", "costilla de cerdo"] },
  { emoji: "🍟", terms: ["papa", "papas", "francesa", "criolla", "yuca", "patacon"] },
  { emoji: "🥗", terms: ["ensalada", "vegetariano", "vegetal", "verdura"] },
  { emoji: "🍰", terms: ["torta", "pastel", "postre", "cheesecake", "brownie"] },
  { emoji: "🍦", terms: ["helado", "gelato"] },
  { emoji: "🍌", terms: ["maduro", "platano"] },
  { emoji: "🥑", terms: ["aguacate"] },
  { emoji: "🫘", terms: ["frijol", "frijoles"] },
];

// A deliberately broad food-first palette. Product images are optional in a
// restaurant catalog, so this gives every business a fast, expressive visual
// fallback without forcing them to upload photography for every item.
const foodEmojiPalette = [
  "🍽️", "🥘", "🍲", "🍛", "🍜", "🍝", "🍣", "🍤", "🍱", "🍚", "🍙", "🍘", "🍥", "🥟", "🥠", "🥡",
  "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪",
  "🥞", "🧇", "🥓", "🥚", "🍳", "🧀", "🥯", "🥖", "🥨", "🥐", "🍞", "🫓", "🥪", "🌭", "🍔", "🍟",
  "🍕", "🌮", "🌯", "🫔", "🥙", "🧆", "🥗", "🥣", "🫕", "🍖", "🍗", "🥩", "🥓", "🍔", "🌭", "🍳",
  "🐟", "🦐", "🦑", "🦀", "🦞", "🦪", "🐙", "🍋", "🫒", "🥑", "🍅", "🧅", "🧄", "🥔", "🥕", "🌽",
  "🥦", "🥬", "🥒", "🌶️", "🫑", "🍆", "🥜", "🌰", "🫘", "🫛", "🍄", "🥭", "🍍", "🥥", "🍌", "🍉",
  "🍇", "🍓", "🫐", "🍒", "🍑", "🍎", "🍏", "🍐", "🍊", "🍈", "🥝", "🍅", "🥜", "🌮", "🥵", "🧂",
  "🫙", "🥫", "🍯", "🧈", "🥛", "🍼", "☕", "🫖", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂",
  "🍷", "🥃", "🍸", "🍹", "🧉", "💧", "🥛", "🧊", "🍴", "🥢", "🔪", "🏺", "🛵", "🛍️", "🎉", "✨",
];

const availableProductEmojis = Array.from(new Set([
  ...foodEmojiRules.map((rule) => rule.emoji),
  ...foodEmojiPalette,
  ...unicodeEmojiData,
]));

function getFallbackProducts(tenantSlug: string): Product[] {
  if (tenantSlug === "arepas") {
    return [
      {
        id: "local-arepas-product-1",
        name: "Arepa mixta",
        description: "Arepa asada con carne desmechada, pollo y queso.",
        basePrice: 16000,
        category: "arepas",
        imageUrl: "https://images.unsplash.com/photo-1627662236973-4fd83550a2c8?auto=format&fit=crop&w=420&q=80",
        isActive: true,
      },
      {
        id: "local-arepas-product-2",
        name: "Arepa de queso",
        description: "Arepa clasica con queso doble.",
        basePrice: 9500,
        category: "arepas",
        isActive: true,
      },
    ];
  }

  if (tenantSlug === "pizza") {
    return [
      {
        id: "local-pizza-product-1",
        name: "Pizza personal pepperoni",
        description: "Masa artesanal, mozzarella y pepperoni.",
        basePrice: 22000,
        category: "pizzas",
        imageUrl: "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=420&q=80",
        isActive: true,
      },
      {
        id: "local-pizza-product-2",
        name: "Pizza vegetariana",
        description: "Champinones, pimenton, cebolla y aceitunas.",
        basePrice: 24000,
        category: "pizzas",
        isActive: true,
      },
    ];
  }

  return fallbackProducts;
}

function getFallbackItems(tenantSlug: string): MenuItem[] {
  return getFallbackProducts(tenantSlug).map((product, index) => ({
    id: `local-${tenantSlug}-item-${index + 1}`,
    menuId: `local-${tenantSlug}-menu`,
    productId: product.id,
    displayName: product.name,
    priceOverride: product.basePrice,
    isAvailable: index === 0,
    sortOrder: index,
    product,
  }));
}

type CategorySection<T> = {
  id: string;
  label: string;
  items: T[];
};

const defaultCategoryOptions = ["General", "Entradas", "Platos principales", "Adiciones", "Bebidas", "Postres"];
const categoryEmojiQuickOptions = ["🍽️", "🥟", "🍔", "🥩", "🍳", "🍲", "🍛", "🍕", "🥪", "🍟", "🥗", "🥤", "🍺", "🍰", "☕", "🌮", "🐟", "🍗", "🍝", "🍱"];

function normalizeCategoryLabel(category?: string, fallback = "General") {
  const trimmed = (category ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeCategoryKey(category?: string) {
  return normalizeSearchText(normalizeCategoryLabel(category))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
}

function collectCategoryOptions(products: Array<Pick<Product, "category">>, categories: ProductCategory[] = []) {
  const byKey = new Map<string, string>();
  for (const category of defaultCategoryOptions) {
    byKey.set(normalizeCategoryKey(category), category);
  }
  for (const product of products) {
    const label = normalizeCategoryLabel(product.category, "");
    if (label) byKey.set(normalizeCategoryKey(label), label);
  }
  for (const category of categories) {
    const label = normalizeCategoryLabel(category.name, "");
    if (label) byKey.set(normalizeCategoryKey(label), label);
  }
  return Array.from(byKey.values());
}

function getDefaultCategoryEmoji(category?: string) {
  const categoryKey = normalizeCategoryKey(category);
  if (categoryKey.includes("hamburg")) return "🍔";
  if (categoryKey.includes("picad")) return "🥩";
  if (categoryKey.includes("entrada") || categoryKey.includes("aperitivo")) return "🥟";
  if (categoryKey.includes("desayun")) return "🍳";
  if (categoryKey.includes("almuerz")) return "🍲";
  if (categoryKey.includes("plato-principal") || categoryKey.includes("platos-principales") || categoryKey.includes("plato-fuerte")) return "🍛";
  if (categoryKey.includes("pizza")) return "🍕";
  if (categoryKey.includes("sandwich") || categoryKey.includes("sanduche")) return "🥪";
  if (categoryKey.includes("bebida") || categoryKey.includes("jugo") || categoryKey.includes("limonada") || categoryKey.includes("soda")) return "🥤";
  if (categoryKey.includes("cerveza") || categoryKey.includes("licor") || categoryKey.includes("coctel")) return "🍺";
  if (categoryKey.includes("postre") || categoryKey.includes("dulce")) return "🍰";
  if (categoryKey.includes("adicion") || categoryKey.includes("acompan") || categoryKey.includes("papas")) return "🍟";
  if (categoryKey.includes("ensalada")) return "🥗";
  return "🍽️";
}

function getCategoryEmoji(category: string | undefined, categories: ProductCategory[]) {
  const categoryKey = normalizeCategoryKey(category);
  return categories.find((entry) => normalizeCategoryKey(entry.name) === categoryKey)?.emoji || getDefaultCategoryEmoji(category);
}

function normalizeSearchText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferProductEmoji(input: Pick<Product, "description" | "name">) {
  const text = normalizeSearchText(`${input.name} ${input.description ?? ""}`);
  const matchedRule = foodEmojiRules.find((rule) => rule.terms.some((term) => text.includes(normalizeSearchText(term))));

  if (matchedRule) return matchedRule.emoji;

  return "🍽️";
}

function createEmptyCompositeOption(sortOrder: number): ProductOption {
  return {
    name: "",
    type: "single",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    sortOrder,
    displayMode: "buttons",
    values: [
      { name: "", priceDelta: 0, isActive: true, sortOrder: 0 },
      { name: "", priceDelta: 0, isActive: true, sortOrder: 10 },
    ],
  };
}

function createDefaultCompositeOptions(): ProductOption[] {
  return [
    {
      ...createEmptyCompositeOption(0),
      name: "Sopa",
      values: [
        { name: "Sopa de lentejas", priceDelta: 0, isActive: true, sortOrder: 0 },
        { name: "Frijoles", priceDelta: 0, isActive: true, sortOrder: 10 },
      ],
    },
    {
      ...createEmptyCompositeOption(10),
      name: "Carbohidrato",
      values: [
        { name: "Platano", priceDelta: 0, isActive: true, sortOrder: 0 },
        { name: "Papa", priceDelta: 0, isActive: true, sortOrder: 10 },
      ],
    },
    {
      ...createEmptyCompositeOption(20),
      name: "Ensalada",
      values: [
        { name: "Ensalada de la casa", priceDelta: 0, isActive: true, sortOrder: 0 },
        { name: "Ensalada Cesar", priceDelta: 0, isActive: true, sortOrder: 10 },
      ],
    },
  ];
}

function createCompositeProductDraft(): Partial<Product> {
  return {
    name: "Producto compuesto",
    description: "Producto con componentes que el cliente debe elegir.",
    basePrice: 0,
    category: "General",
    isActive: true,
    productType: "composite",
    options: createDefaultCompositeOptions(),
  };
}

function normalizeProductOptions(options?: ProductOption[]) {
  return (options ?? [])
    .map((option, optionIndex) => ({
      ...option,
      name: option.name.trim(),
      description: option.description?.trim(),
      sortOrder: option.sortOrder ?? optionIndex * 10,
      minSelect: Number(option.minSelect ?? (option.isRequired ? 1 : 0)),
      maxSelect: Number(option.maxSelect ?? 1),
      values: option.values
        .map((value, valueIndex) => ({
          ...value,
          name: value.name.trim(),
          description: value.description?.trim(),
          priceDelta: Number(value.priceDelta ?? 0),
          isActive: value.isActive ?? true,
          sortOrder: value.sortOrder ?? valueIndex * 10,
        }))
        .filter((value) => value.name.length > 0),
    }))
    .filter((option) => option.name.length > 0 && option.values.length > 0);
}

function groupByCategorySection<T>(items: T[], getCategory: (item: T) => string | undefined) {
  const groups = new Map<string, CategorySection<T>>();

  items.forEach((item) => {
    const label = normalizeCategoryLabel(getCategory(item));
    const id = normalizeCategoryKey(label);
    const group = groups.get(id) ?? { id, label, items: [] as T[] };
    group.items.push(item);
    groups.set(id, group);
  });

  return Array.from(groups.values());
}

function formatPrice(value: number | undefined) {
  return formatLocalizedPrice(activeDashboardLocale, value);
}

function getLocalizedCategoryLabel(category: string | undefined, locale: "en" | "es") {
  const label = normalizeCategoryLabel(category, locale === "en" ? "General" : "General");
  const known = defaultCategoryOptions.find((option) => normalizeCategoryKey(option) === normalizeCategoryKey(label));
  if (!known) return label;
  if (locale === "en") {
    return {
      General: "General",
      Entradas: "Starters",
      "Platos principales": "Main dishes",
      Adiciones: "Extras",
      Bebidas: "Drinks",
      Postres: "Desserts",
    }[known] ?? known;
  }
  return known;
}

function formatDateTime(value?: string) {
  return formatLocalizedDateTime(activeDashboardLocale, value);
}

function keepSessionStableByUser(current: Session | null, next: Session | null) {
  if (!next) return null;
  return current?.user.id === next.user.id ? current : next;
}

function isNotifiableOrder(order: OrderSummary) {
  return notifiableOrderStatuses.has(order.status);
}

function getOrderNotificationTitle(order: OrderSummary) {
  if (order.status === "needs_customer_replacement") {
    return activeDashboardLocale === "en" ? "Order waiting for customer response" : "Pedido esperando respuesta del cliente";
  }

  if (order.status === "pending_restaurant_confirmation") {
    return activeDashboardLocale === "en" ? "New order awaiting confirmation" : "Nuevo pedido por confirmar";
  }

  return activeDashboardLocale === "en" ? "New order update" : "Nuevo movimiento de pedido";
}

function getOrderNotificationDetail(order: OrderSummary) {
  const customer = order.customerName || order.customerPhone || (activeDashboardLocale === "en" ? "Unnamed customer" : "Cliente sin nombre");
  return `${customer} - ${formatPrice(order.total)} - ${formatDateTime(order.createdAt)}`;
}

function mapNotificationRecord(record: DashboardNotificationRecord): DashboardNotification {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    createdAt: record.createdAt,
    orderId: record.orderId,
    draftOrderId: record.draftOrderId,
    conversationId: record.conversationId,
    whatsappUrl: record.whatsappUrl,
    eventName: record.eventName,
  };
}

function mergeNotifications(next: DashboardNotification[], current: DashboardNotification[]) {
  const byKey = new Map<string, DashboardNotification>();
  for (const notification of [...next, ...current]) {
    byKey.set(notification.id, notification);
  }

  return Array.from(byKey.values()).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function playNotificationSound() {
  type WindowWithWebkitAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioCtor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioCtor) return;

  try {
    const context = new AudioCtor();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Browsers can block audio until the first user gesture.
  }
}

function showBrowserNotification(title: string, detail: string, onClick?: () => void) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const notification = new Notification(title, { body: detail });
  if (onClick) {
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick();
    };
  }
}

function isPublicCartaRoute() {
  return window.location.pathname === "/carta" || window.location.pathname.startsWith("/carta/");
}

function isPublicRestaurantProfileRoute() {
  return window.location.pathname === "/perfil"
    || window.location.pathname.startsWith("/r/");
}

function getPublicRestaurantProfileTenantSlug() {
  const params = new URLSearchParams(window.location.search);
  const queryTenant = params.get("tenant") || params.get("restaurante");
  if (queryTenant) return queryTenant;

  const [, route, tenantSlug] = window.location.pathname.split("/");
  if (route === "r" && tenantSlug) return tenantSlug;
  return "demo";
}

function getPublicCartaTenantSlug() {
  const params = new URLSearchParams(window.location.search);
  const queryTenant = params.get("tenant") || params.get("restaurante");
  if (queryTenant) return queryTenant;

  const [, route, tenantSlug] = window.location.pathname.split("/");
  if (route === "carta" && tenantSlug) return tenantSlug;

  return "demo";
}

function getPublicCartaUrl(tenantSlug: string) {
  const url = new URL("/carta", window.location.origin);
  url.searchParams.set("tenant", tenantSlug || "demo");
  return url.toString();
}

export function App() {
  const { locale } = useDashboardLocale();
  const marketingPage = resolvePublicMarketingPage(window.location.pathname);

  if (isPublicCartaRoute()) return <PublicCartaPage />;
  if (isPublicRestaurantProfileRoute()) return <PublicRestaurantProfilePage tenantSlug={getPublicRestaurantProfileTenantSlug()} />;
  if (marketingPage === "landing") return <LandingPage />;
  if (marketingPage) return <PublicInformationPage page={marketingPage} />;
  return <DashboardApp locale={locale} />;
}

function DashboardApp({ locale }: { locale: "en" | "es" }) {
  activeDashboardLocale = locale;
  const { setLocale } = useDashboardLocale();
  const [activeView, setActiveView] = useState<View>("menu");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenants, setTenants] = useState<DashboardTenant[]>([]);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [products, setProducts] = useState<Product[]>(fallbackProducts);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>(fallbackItems);
  const [imageColumnReady, setImageColumnReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState(locale === "en" ? "2 min ago" : "hace 2 min");
  const [toast, setToast] = useState("");
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [focusedOrderId, setFocusedOrderId] = useState("");
  const [paymentConfigurationHealth, setPaymentConfigurationHealth] = useState<PaymentConfigurationHealth | null>(null);
  const seenNotificationOrderIdsRef = useRef<Set<string>>(new Set());
  const seenSupportAlertIdsRef = useRef<Set<string>>(new Set());
  const notificationsBootstrappedRef = useRef(false);

  const refreshTodayMenu = useCallback(async () => {
    if (!tenantSlug) return [] as MenuItem[];
    const payload = await getTodayMenu(tenantSlug);
    setProducts(payload.products);
    setProductCategories(payload.categories);
    setItems(payload.items);
    setSaveStatus("saved");
    setLastUpdated(payload.menu?.publishedAt ? "" : "sin menu publicado");
    return payload.items;
  }, [tenantSlug]);

  const handleFocusedOrderHandled = useCallback((orderId: string) => {
    setFocusedOrderId((current) => current === orderId ? "" : current);
  }, []);

  useEffect(() => {
    if (!authConfigured) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    getSession()
      .then((currentSession) => {
        if (!mounted) return;
        setSession((current) => keepSessionStableByUser(current, currentSession));
      })
      .finally(() => {
        if (mounted) {
          setAuthLoading(false);
        }
      });

    const unsubscribe = onAuthStateChange((nextSession) => {
      setSession((current) => keepSessionStableByUser(current, nextSession));
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setTenants([]);
      setTenantSlug("");
      setIsSystemAdmin(false);
      setAdminOverview(null);
      setTenantLoading(false);
      setTenantError("");
      return;
    }

    let active = true;
    setTenantLoading(true);
    setTenantError("");

    getMe()
      .then(async (payload) => {
        if (!active) return;
        const nextIsSystemAdmin = payload.user.app_metadata?.system_admin === true
          || payload.user.app_metadata?.role === "system_admin";
        setIsSystemAdmin(nextIsSystemAdmin);
        setTenants(payload.tenants);

        if (nextIsSystemAdmin) {
          const overview = await getAdminOverview();
          if (!active) return;
          setAdminOverview(overview);
          setTenantSlug("");
          return;
        }

        setAdminOverview(null);
        setTenantSlug((current) => current || payload.tenants[0]?.slug || "");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof DashboardApiError
          ? `No se pudo consultar /dashboard/me. Backend: ${error.backendError ?? "sin_codigo"} - HTTP ${error.status}.`
          : error instanceof Error
            ? `No se pudo consultar /dashboard/me. ${error.message}`
            : "No se pudo consultar /dashboard/me.";
        setTenants([]);
        setTenantSlug("");
        setIsSystemAdmin(false);
        setAdminOverview(null);
        setTenantError(message);
      })
      .finally(() => {
        if (active) setTenantLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!tenantSlug) return;
    setSaveStatus("loading");
    refreshTodayMenu()
      .catch(() => {
        setProducts([]);
        setItems([]);
        setSaveStatus("offline");
        setLastUpdated("sin conexion");
        notify("No se pudo cargar el tenant desde la API");
      });

    getDiagnostics(tenantSlug)
      .then((diagnostics) => setImageColumnReady(diagnostics.productImageColumn && diagnostics.productImagesBucket))
      .catch(() => setImageColumnReady(false));
  }, [refreshTodayMenu, tenantSlug]);

  useEffect(() => {
    if (!tenantSlug || isSystemAdmin) {
      setPaymentConfigurationHealth(null);
      return;
    }

    let active = true;

    getPaymentConfigurationHealth(tenantSlug)
      .then((nextHealth) => {
        if (!active) return;
        setPaymentConfigurationHealth(nextHealth);
        if (!nextHealth.hasActiveTransferMethod) {
          notify("No hay un medio de transferencia activo configurado para este restaurante.", 5000);
        }
      })
      .catch(() => {
        if (!active) return;
        setPaymentConfigurationHealth(null);
      });

    return () => {
      active = false;
    };
  }, [tenantSlug, activeView, isSystemAdmin]);

  useEffect(() => {
    const tenantSchema = tenants.find((tenant) => tenant.slug === tenantSlug)?.schemaName;

    if (!tenantSlug || isSystemAdmin) {
      seenNotificationOrderIdsRef.current = new Set();
      seenSupportAlertIdsRef.current = new Set();
      notificationsBootstrappedRef.current = false;
      setNotifications([]);
      setUnreadNotificationCount(0);
      setNotificationsOpen(false);
      setFocusedOrderId("");
      return;
    }

    let active = true;

    async function refreshNotificationHistory() {
      try {
        const records = await listNotifications(tenantSlug);
        if (!active) return;
        setNotifications((current) => mergeNotifications(records.map(mapNotificationRecord), current).slice(0, 12));
      } catch {
        if (active && !notificationsBootstrappedRef.current) setNotifications([]);
      }
    }

    async function checkForNewOrders() {
      try {
        await refreshNotificationHistory();
        const payload = await listOrders(tenantSlug, "all");
        if (!active) return;

        const relevantOrders = payload.orders.filter(isNotifiableOrder);
        const knownIds = seenNotificationOrderIdsRef.current;
        const freshOrders = relevantOrders.filter((order) => !knownIds.has(order.id));

        relevantOrders.forEach((order) => knownIds.add(order.id));

        if (!notificationsBootstrappedRef.current) {
          notificationsBootstrappedRef.current = true;
          return;
        }

        if (freshOrders.length === 0) return;

        const nextNotifications = freshOrders
          .map((order) => ({
            id: order.id,
            orderId: order.id,
            title: getOrderNotificationTitle(order),
            detail: getOrderNotificationDetail(order),
            whatsappUrl: order.whatsappUrl,
            createdAt: order.createdAt,
          }))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const firstNotification = nextNotifications[0];
        if (!firstNotification) return;

        setNotifications((current) => mergeNotifications(nextNotifications, current).slice(0, 12));
        setUnreadNotificationCount((current) => current + nextNotifications.length);
        notify(nextNotifications.length === 1 ? firstNotification.title : `${nextNotifications.length} pedidos nuevos requieren revision`);
        playNotificationSound();
        showBrowserNotification(firstNotification.title, firstNotification.detail, () => handleNotificationSelect(firstNotification));
      } catch {
        // The order board already exposes offline state; notifications should stay quiet on transient failures.
      }
    }

    async function refreshSupportAlerts(notifyNew = false) {
      try {
        const alerts = await listAlerts(tenantSlug, "open");
        if (!active) return;
        const fresh = alerts.filter((alert) => !seenSupportAlertIdsRef.current.has(alert.id));
        alerts.forEach((alert) => seenSupportAlertIdsRef.current.add(alert.id));
        if (!notifyNew || fresh.length === 0) return;
        const nextNotifications = fresh.map((alert) => toSupportAlertNotification(alert, locale));
        const first = nextNotifications[0];
        if (!first) return;
        setNotifications((current) => mergeNotifications(nextNotifications, current).slice(0, 12));
        setUnreadNotificationCount((current) => current + fresh.length);
        notify(first.title);
        playNotificationSound();
        showBrowserNotification(first.title, first.detail, () => handleNotificationSelect(first));
      } catch {
        // Alerts are retried through the same interval as order notifications.
      }
    }

    void refreshNotificationHistory();
    void refreshSupportAlerts();
    void checkForNewOrders();
    const realtimeChannel = supabase && tenantSchema
      ? supabase
          .channel(`dashboard-orders:${tenantSlug}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: tenantSchema, table: "orders" },
            () => void checkForNewOrders(),
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: tenantSchema, table: "orders" },
            () => void checkForNewOrders(),
          )
          .subscribe()
      : null;
    const alertsChannel = supabase && tenantSchema
      ? supabase.channel(`dashboard-alerts:${tenantSlug}`).on("postgres_changes", { event: "INSERT", schema: tenantSchema, table: "human_intervention_alerts" }, () => void refreshSupportAlerts(true)).subscribe()
      : null;
    const intervalId = window.setInterval(() => { void checkForNewOrders(); void refreshSupportAlerts(true); }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (realtimeChannel && supabase) {
        void supabase.removeChannel(realtimeChannel);
      }
      if (alertsChannel && supabase) void supabase.removeChannel(alertsChannel);
    };
  }, [isSystemAdmin, tenantSlug, tenants]);

  const activeItems = items.filter((item) => item.isAvailable);
  const menuIsActive = activeItems.length > 0;
  const activeTenant = tenants.find((tenant) => tenant.slug === tenantSlug) ?? tenants[0] ?? null;
  const activeTenantRole: TenantRole = activeTenant?.role ?? "encargado";
  const canAccessConfiguration = !isSystemAdmin && activeTenantRole === "encargado";
  const navigationItems = useMemo(() => getNavItems(locale, canAccessConfiguration), [canAccessConfiguration, locale]);
  const viewCopy = useMemo(() => getViewCopy(locale), [locale]);
  const activeViewCopy = viewCopy[activeView];

  useEffect(() => {
    if (activeView === "configuration" && !canAccessConfiguration) {
      setActiveView("menu");
    }
  }, [activeView, canAccessConfiguration]);

  async function handleLogin(email: string, password: string) {
    setLoginError("");
    try {
      const { session: nextSession } = await signIn(email, password);
      setSession(nextSession);
    } catch {
      setLoginError("No se pudo iniciar sesion. Revisa correo y contrasena.");
    }
  }

  async function handleLogout() {
    await signOut();
    setSession(null);
    setTenants([]);
    setTenantSlug("");
    setIsSystemAdmin(false);
    setAdminOverview(null);
    setProducts(fallbackProducts);
    setProductCategories([]);
    setItems(fallbackItems);
    setNotifications([]);
    setUnreadNotificationCount(0);
    setNotificationsOpen(false);
    setFocusedOrderId("");
    seenNotificationOrderIdsRef.current = new Set();
    notificationsBootstrappedRef.current = false;
  }

  function handleNotificationSelect(notification: DashboardNotification) {
    setNotificationsOpen(false);
    setUnreadNotificationCount(0);

    if (notification.orderId) {
      setFocusedOrderId(notification.orderId);
      setActiveView("orders");
      return;
    }

    if (notification.draftOrderId || notification.conversationId) {
      setFocusedOrderId("");
      setActiveView("orders");
    }
  }

  function toggleNotifications() {
    setNotificationsOpen((current) => !current);
    setUnreadNotificationCount(0);

    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  function notify(message: string, durationMs = 2200) {
    setToast(message);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(""), durationMs);
  }

  async function persistItem(itemId: string, patch: Partial<MenuItem>) {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
    setSaveStatus("saving");

    try {
      await updateMenuItem(tenantSlug, itemId, patch);
      setSaveStatus("saved");
      setLastUpdated("ahora");
    } catch {
      setSaveStatus("offline");
      notify("No se pudo guardar el cambio");
    }
  }

  async function addFromCatalog(productId: string) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;

    setSaveStatus("saving");
    try {
      const created = await addMenuItem(tenantSlug, productId);
      setItems((current) => [...current, created]);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("offline");
      notify("No se pudo agregar el plato");
    }
  }

  async function removeMenuItem(itemId: string) {
    setItems((current) => current.filter((item) => item.id !== itemId));
    setSaveStatus("saving");
    try {
      await deleteMenuItem(tenantSlug, itemId);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("offline");
      notify("No se pudo eliminar el plato");
    }
  }

  async function saveProduct(product: ProductFormValue) {
    setSaveStatus("saving");

    try {
      const imageUrl = product.imageFile && imageColumnReady
        ? (await uploadProductImage(tenantSlug, product.imageFile)).publicUrl
        : product.imageUrl;
      const emoji = product.emoji || inferProductEmoji({
        name: product.name ?? "Producto",
        description: product.description,
      });
      const productType = product.productType ?? "simple";
      const payload = {
        ...product,
        emoji,
        productType,
        options: productType === "composite" ? normalizeProductOptions(product.options) : [],
        imageFile: undefined,
        imageUrl,
      };
      const persisted = product.id ? await updateProduct(tenantSlug, product.id, payload) : await createProduct(tenantSlug, payload);

      setProducts((current) => (product.id ? current.map((item) => (item.id === product.id ? persisted : item)) : [persisted, ...current]));
      void refreshTodayMenu().catch(() => undefined);
      setSaveStatus("saved");
      notify(
        product.imageFile && !imageColumnReady
          ? (locale === "en" ? "Product created without image: image_url migration is still missing" : "Producto creado sin imagen: falta migracion image_url")
          : product.id
            ? (locale === "en" ? "Product updated" : "Producto actualizado")
            : (locale === "en" ? "Product created" : "Producto creado"),
      );
    } catch {
      setSaveStatus("offline");
      notify(locale === "en" ? "Could not save. Connect API and Supabase to persist changes." : "No se pudo guardar. Conecta API y Supabase para persistir.");
      throw new Error("product_save_failed");
    }
  }

  async function removeProduct(productId: string) {
    await deleteProduct(tenantSlug, productId).catch(() => undefined);
    setProducts((current) => current.filter((product) => product.id !== productId));
    setItems((current) => current.filter((item) => item.productId !== productId));
    notify(locale === "en" ? "Product disabled" : "Producto desactivado");
  }

  async function updateCategoryEmoji(categoryId: string, emoji: string) {
    try {
      const updated = await updateProductCategoryEmoji(tenantSlug, categoryId, emoji);
      setProductCategories((current) => current.map((category) => (category.id === categoryId ? updated : category)));
      notify(locale === "en" ? "Category emoji updated" : "Emoji de categoría actualizado");
    } catch {
      notify(locale === "en" ? "Could not update the category emoji" : "No se pudo actualizar el emoji de la categoría");
    }
  }

  if (!authConfigured) {
    return <ConfigRequiredScreen locale={locale} />;
  }

  if (authLoading) {
    return <LoadingScreen locale={locale} />;
  }

  if (!session) {
    return <LoginScreen error={loginError} locale={locale} onChangeLocale={setLocale} onLogin={handleLogin} />;
  }

  if (tenantLoading) {
    return <TenantLoadingScreen locale={locale} />;
  }

  if (tenantError) {
    return <TenantErrorScreen error={tenantError} locale={locale} onLogout={handleLogout} />;
  }

  if (isSystemAdmin && adminOverview) {
    return <AdminOverviewScreen overview={adminOverview} onLogout={handleLogout} />;
  }

  if (tenants.length === 0) {
    return <NoTenantScreen locale={locale} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen px-0 py-0 sm:px-4 sm:py-4">
      <div className="mx-auto flex min-h-screen w-full max-w-[1700px] gap-4 sm:min-h-[calc(100vh-2rem)]">
        <Sidebar
          activeView={activeView}
          locale={locale}
          navItems={navigationItems}
          onNavigate={setActiveView}
          tenantName={activeTenant?.name ?? fallbackTenants[0]?.name ?? "Restaurante"}
        />
        <main className="min-w-0 flex-1">
          <div className="app-shell reveal-up relative min-h-full overflow-hidden rounded-none border-x-0 border-y border-[var(--shell-border)] sm:rounded-[30px] sm:border">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <Header
              activeView={activeView}
              menuIsActive={menuIsActive}
              notifications={notifications}
              notificationsOpen={notificationsOpen}
              locale={locale}
              onChangeLocale={setLocale}
              saveStatus={saveStatus}
              tenantName={activeTenant?.name ?? fallbackTenants[0]?.name ?? "Restaurante"}
              unreadNotificationCount={unreadNotificationCount}
              viewCopy={activeViewCopy}
              onLogout={() => void handleLogout()}
              onSelectNotification={handleNotificationSelect}
              onToggleNotifications={toggleNotifications}
            />
            <div className="px-3 pb-28 pt-2 sm:px-5 lg:px-8 lg:pb-10">
              {activeView === "menu" && (
                <TodayMenu
                  activeCount={activeItems.length}
                  items={items}
                  lastUpdated={lastUpdated}
                  menuIsActive={menuIsActive}
                  products={products}
                  saveStatus={saveStatus}
                  tenantSlug={tenantSlug}
                  onAddDish={addFromCatalog}
                  onDeleteDish={removeMenuItem}
                  onUpdateDish={persistItem}
                />
              )}
              {activeView === "summary" && (
                <Summary
                  activeCount={activeItems.length}
                  items={items}
                  onEditMenu={() => setActiveView("menu")}
                  onOpenOrders={() => setActiveView("orders")}
                  tenantSlug={tenantSlug}
                  totalCount={items.length}
                />
              )}
              {activeView === "orders" && (
                <OrdersView
                  focusOrderId={focusedOrderId}
                  locale={locale}
                  menuItems={items}
                  onFocusOrderHandled={handleFocusedOrderHandled}
                  onNotify={notify}
                  onRefreshMenu={refreshTodayMenu}
                  tenantSlug={tenantSlug}
                />
              )}
              {activeView === "catalog" && (
                <Catalog
                  categories={productCategories}
                  imageColumnReady={imageColumnReady}
                  menuProductIds={new Set(items.map((item) => item.productId).filter((productId): productId is string => Boolean(productId)))}
                  onAddToMenu={addFromCatalog}
                  onDelete={removeProduct}
                  onUpdateCategoryEmoji={updateCategoryEmoji}
                  onSave={saveProduct}
                  products={products}
                />
              )}
              {activeView === "configuration" && (
                <ConfigurationView
                  access={{ canManage: canAccessConfiguration, role: activeTenantRole }}
                  adapter={httpPaymentConfigurationAdapter}
                  locale={locale}
                  tenantSlug={tenantSlug}
                  onAnalyze={(file) => analyzeMenuFile(tenantSlug, file)}
                  onCreateProducts={async (detectedProducts) => {
                    for (const product of detectedProducts) {
                      await saveProduct({
                        name: product.name,
                        description: product.description ?? "Detectado automaticamente desde archivo de menu.",
                        basePrice: product.basePrice,
                        category: product.category,
                        emoji: product.emoji,
                        options: product.options,
                        productType: product.productType ?? (product.options && product.options.length > 0 ? "composite" : "simple"),
                        isActive: true,
                      });
                    }
                  }}
                  onNotify={notify}
                  onPaymentConfigurationChanged={async () => {
                    try {
                      const nextHealth = await getPaymentConfigurationHealth(tenantSlug);
                      setPaymentConfigurationHealth(nextHealth);
                    } catch {
                      setPaymentConfigurationHealth(null);
                    }
                  }}
                />
              )}
            </div>
          </div>
        </main>
        <BottomNav activeView={activeView} navItems={navigationItems} onNavigate={setActiveView} />
      </div>
      {toast && <Toast message={toast} />}
    </div>
  );
}

function toSupportAlertNotification(alert: import("@42day/types").HumanInterventionAlert, locale: "en" | "es"): DashboardNotification {
  const copy: Record<typeof alert.type, { en: string; es: string }> = {
    order_pending_confirmation: { en: "Order awaiting restaurant decision", es: "Pedido espera decision del restaurante" },
    support_requested: { en: "Customer requests an advisor", es: "Cliente solicita asesor" },
    transfer_payment_review: { en: "Transfer payment needs review", es: "Transferencia pendiente de revision" },
    parser_failed: { en: "Conversation needs manual review", es: "Conversacion requiere revision humana" },
    validation_failed_repeatedly: { en: "Customer needs assistance", es: "Cliente necesita asistencia" },
    technical_error: { en: "Conversation technical issue", es: "Problema tecnico en conversacion" },
    order_change_requested: { en: "Customer requested an order change", es: "Cliente solicito cambio de pedido" },
    automation_disabled: { en: "Automation is disabled", es: "La automatizacion esta desactivada" },
  };
  const title = copy[alert.type][locale];
  return {
    id: alert.id,
    title,
    detail: alert.description ?? (locale === "en" ? "Human intervention is required." : "Requiere intervencion humana."),
    conversationId: alert.conversationId,
    orderId: alert.orderId,
    draftOrderId: alert.draftOrderId,
    createdAt: alert.createdAt,
  };
}

function PublicCartaPage() {
  const tenantSlug = getPublicCartaTenantSlug();
  const [payload, setPayload] = useState<PublicCartaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCartaItem, setSelectedCartaItem] = useState<MenuItem>();
  const [proactiveCartaItem, setProactiveCartaItem] = useState<MenuItem>();
  const [conciergePrompt, setConciergePrompt] = useState<{ id: string; text: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    getPublicCarta(tenantSlug)
      .then((nextPayload) => {
        if (!active) return;
        setPayload(nextPayload);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "No se pudo cargar la carta.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tenantSlug]);

  const groups = useMemo(
    () => groupByCategorySection(payload?.items ?? [], (item) => item.product?.category),
    [payload?.items],
  );
  const featuredCategories = groups.slice(0, 4);
  const totalMenuItems = payload?.items.length ?? 0;
  // Keep the public carta compatible while API and dashboard deployments roll
  // out independently. Older API versions do not include `experience`.
  const cartaMode = payload?.experience?.mode ?? "connected";

  useEffect(() => {
    if (!selectedCartaItem) return;
    const storageKey = `parahoy-carta-nudge:${tenantSlug}`;
    if (window.sessionStorage.getItem(storageKey) === "shown") return;
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(storageKey, "shown");
      setProactiveCartaItem(selectedCartaItem);
    }, 9_000);
    return () => window.clearTimeout(timer);
  }, [selectedCartaItem, tenantSlug]);

  const closeCartaDetail = useCallback(() => setSelectedCartaItem(undefined), []);
  const askConciergeAboutItem = useCallback((item: MenuItem) => {
    const name = item.displayName ?? item.product?.name ?? "este plato";
    setSelectedCartaItem(undefined);
    setProactiveCartaItem(undefined);
    setConciergePrompt({ id: crypto.randomUUID(), text: `Cuéntame sobre ${name}` });
  }, []);

  return (
    <div className="min-h-screen bg-[#050403] text-[var(--text-strong)]">
      <div
        className="pointer-events-none fixed inset-0 bg-top bg-repeat-y opacity-70"
        style={{
          backgroundImage: "url('/fondo_carta.jpg')",
          backgroundPosition: "top center",
          backgroundSize: "min(100vw, 720px) auto",
        }}
      />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(213,167,108,0.18),transparent_26%),radial-gradient(circle_at_85%_18%,rgba(0,0,0,0.72),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.42)_28%,rgba(0,0,0,0.34)_50%,rgba(0,0,0,0.42)_72%,rgba(0,0,0,0.82)_100%)]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(5,4,3,0) 0%, rgba(5,4,3,0.30) 44%, rgba(5,4,3,0.62) 50%, rgba(5,4,3,0.30) 56%, rgba(5,4,3,0) 100%)",
          backgroundRepeat: "repeat-y",
          backgroundSize: "100% 1040px",
        }}
      />
      <main className="relative mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[38px] border border-[rgba(255,242,227,0.16)] bg-[rgba(10,8,6,0.62)] shadow-[0_30px_100px_rgba(0,0,0,0.52)] backdrop-blur-2xl">
          <div className="grid gap-4 p-4 sm:gap-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
            <div className="relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-[34px] bg-[linear-gradient(145deg,#17110d_0%,#2c211a_52%,#5b3827_100%)] p-6 text-[var(--text-on-dark)] shadow-[0_24px_80px_rgba(32,24,18,0.34)] sm:p-9">
              <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[rgba(213,167,108,0.16)] blur-3xl" />
              <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-full bg-gradient-to-t from-[rgba(0,0,0,0.28)] to-transparent" />
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.58)]">
                  <span className="rounded-full border border-[rgba(255,242,227,0.14)] bg-[rgba(255,248,240,0.06)] px-3 py-1.5">Carta digital + mesero IA</span>
                  {cartaMode === "standalone" && (
                    <span className="rounded-full border border-[rgba(255,190,133,0.22)] bg-[rgba(239,125,50,0.14)] px-3 py-1.5 text-[#ffc18c]">Experiencia Solo carta</span>
                  )}
                  {payload?.menu?.name ? (
                    <span className="rounded-full border border-[rgba(255,242,227,0.14)] bg-[rgba(255,248,240,0.06)] px-3 py-1.5">{payload.menu.name}</span>
                  ) : null}
                </div>
                <h1 className="app-display relative mt-7 max-w-3xl text-[3.2rem] leading-[0.86] tracking-[-0.07em] sm:mt-9 sm:text-[5rem] lg:text-[5.8rem]">
                  {payload?.tenant.name ?? "Carta del restaurante"}
                </h1>
                <p className="relative mt-5 max-w-2xl text-base leading-7 text-[rgba(246,236,223,0.72)] sm:text-lg">
                  {cartaMode === "standalone"
                    ? "Explora cada plato y conversa con un mesero digital que conoce la carta y te ayuda a elegir."
                    : "Explora cada plato y deja que nuestro mesero digital te recomiende antes de continuar por WhatsApp."}
                </p>
              </div>
              <div className="relative mt-9 flex flex-wrap items-center gap-3 text-sm text-[rgba(246,236,223,0.76)]">
                {payload?.location?.name && (
                  <span className="inline-flex items-center gap-2 rounded-2xl bg-[rgba(255,248,240,0.08)] px-4 py-3">
                    <MapPin size={16} />
                    {payload.location.name}
                  </span>
                )}
                {payload?.menu?.name && (
                  <span className="inline-flex items-center gap-2 rounded-2xl bg-[rgba(255,248,240,0.08)] px-4 py-3">
                    <Utensils size={16} />
                    {payload.menu.name}
                  </span>
                )}
                <span className="inline-flex items-center gap-2 rounded-2xl bg-[rgba(255,248,240,0.08)] px-4 py-3">
                  <List size={16} />
                  {totalMenuItems} productos
                </span>
              </div>
            </div>

            <div className="rounded-[34px] border border-[rgba(255,242,227,0.14)] bg-[rgba(255,250,244,0.86)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] backdrop-blur-md sm:p-5">
              <div className="rounded-[28px] bg-[#191411] p-4 text-[var(--text-on-dark)] shadow-[0_24px_60px_rgba(32,24,18,0.24)]">
                <div className="relative overflow-hidden rounded-[25px] bg-[linear-gradient(160deg,#2c2520,#12100d)] p-5">
                  <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[rgba(197,123,87,0.22)] blur-2xl" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.46)]">Explorar</p>
                  <p className="mt-3 text-2xl font-extrabold tracking-[-0.04em] text-white">Secciones disponibles</p>
                  <a
                    className="mt-5 inline-flex h-12 w-full items-center justify-between rounded-2xl border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.08)] px-4 text-sm font-semibold text-[var(--text-on-dark)] transition hover:bg-[rgba(255,248,240,0.16)]"
                    href="#carta-secciones"
                  >
                    <span>Ver carta completa</span>
                    <ArrowDown size={16} />
                  </a>
                  <a
                    className="mt-2 inline-flex h-11 w-full items-center justify-between rounded-2xl border border-[rgba(255,242,227,0.1)] px-4 text-xs font-semibold text-[rgba(246,236,223,0.68)] transition hover:bg-[rgba(255,248,240,0.1)] hover:text-white"
                    href={`/r/${encodeURIComponent(tenantSlug)}`}
                  >
                    <span>Contacto, redes y cómo llegar</span>
                    <ExternalLink size={14} />
                  </a>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {featuredCategories.map((group) => (
                    <a
                      className="rounded-full border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] px-3 py-2 text-xs font-semibold text-[rgba(246,236,223,0.82)] transition hover:bg-[rgba(255,248,240,0.14)]"
                      href={`#category-${group.id}`}
                      key={group.id}
                    >
                      {group.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <PublicCartaState title="Cargando carta" description="Estamos preparando la carta digital del restaurante." />
        ) : error ? (
          <PublicCartaState title="No se pudo cargar la carta" description={error} />
        ) : groups.length === 0 ? (
          <PublicCartaState title="Carta sin platos visibles" description="El restaurante aun no tiene productos publicados para mostrar en esta carta." />
        ) : (
          <div className="mt-6 pb-12" id="carta-secciones">
            <nav className="sticky top-3 z-20 -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-2 app-scrollbar">
              {groups.map((group) => (
                <a
                  className="shrink-0 rounded-full border border-[rgba(255,242,227,0.16)] bg-[rgba(22,17,13,0.74)] px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.82)] shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:bg-[rgba(255,248,240,0.12)] hover:text-white"
                  href={`#category-${group.id}`}
                  key={`nav-${group.id}`}
                >
                  {group.label}
                </a>
              ))}
            </nav>
            <div className="space-y-5 sm:space-y-8">
            {groups.map((group) => (
              <section
                className="scroll-mt-24 rounded-[24px] border border-[rgba(255,242,227,0.14)] bg-[rgba(10,8,6,0.54)] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.30)] backdrop-blur-xl sm:rounded-[32px] sm:p-5"
                id={`category-${group.id}`}
                key={group.id}
              >
                <div className="mb-3 flex items-end justify-between gap-3 sm:mb-4 sm:gap-4">
                  <div>
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.56)] sm:text-[11px]">Categoria</p>
                    <h2 className="app-display mt-1.5 text-[1.9rem] leading-none text-[var(--text-on-dark)] sm:mt-2 sm:text-[2.8rem]">{group.label}</h2>
                  </div>
                  <span className="inline-flex rounded-full border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] px-2.5 py-1 text-[10px] font-bold text-[rgba(246,236,223,0.72)] sm:px-3 sm:py-1.5 sm:text-xs">
                    {group.items.length} opciones
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((item) => (
                    <PublicCartaCard item={item} key={item.id} onOpen={() => setSelectedCartaItem(item)} />
                  ))}
                </div>
              </section>
            ))}
            </div>
          </div>
        )}
      </main>
      <PublicCartaConcierge
        menuItems={payload?.items ?? []}
        onDismissProactiveItem={() => setProactiveCartaItem(undefined)}
        promptRequest={conciergePrompt}
        proactiveItem={proactiveCartaItem}
        restaurantName={payload?.tenant.name}
        tenantSlug={tenantSlug}
      />
      {selectedCartaItem && (
        <PublicCartaProductDetail
          fallbackEmoji={inferProductEmoji({
            name: selectedCartaItem.displayName ?? selectedCartaItem.product?.name ?? "Producto",
            description: selectedCartaItem.product?.description,
          })}
          formatPrice={formatPrice}
          item={selectedCartaItem}
          onAskWaiter={askConciergeAboutItem}
          onClose={closeCartaDetail}
        />
      )}
    </div>
  );
}

function PublicCartaState({ description, title }: { description: string; title: string }) {
  return (
    <div className="mt-6 rounded-[32px] border border-white/70 bg-[rgba(255,255,255,0.7)] px-6 py-16 text-center shadow-[0_20px_60px_rgba(37,31,26,0.08)] backdrop-blur">
      <p className="app-display text-[2.8rem] leading-none text-[var(--text-strong)]">{title}</p>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--text-soft)]">{description}</p>
    </div>
  );
}

function PublicCartaCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const product = item.product;
  const name = item.displayName ?? product?.name ?? "Producto";
  const price = item.priceOverride ?? product?.basePrice ?? 0;
  const activeOptions = product?.options
    ?.map((option) => ({
      ...option,
      values: option.values.filter((value) => value.isActive),
    }))
    .filter((option) => option.values.length > 0) ?? [];

  return (
    <button
      aria-label={`Ver detalle de ${name}`}
      className="group w-full overflow-hidden rounded-[22px] border border-[rgba(255,242,227,0.78)] bg-[rgba(255,251,246,0.9)] text-left shadow-[0_16px_44px_rgba(0,0,0,0.16)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-[0_28px_80px_rgba(0,0,0,0.22)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f19051]/60 sm:rounded-[30px]"
      onClick={onOpen}
      type="button"
    >
      <div className="relative aspect-square overflow-hidden bg-[#efe6d8] sm:aspect-[4/3]">
        {product?.imageUrl ? (
          <img alt={name} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.05]" src={product.imageUrl} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.54),transparent_52%),linear-gradient(140deg,#f7efe5,#ddcbb6)]">
            <span className="text-[3.4rem] drop-shadow-[0_16px_28px_rgba(32,26,22,0.14)] sm:text-[4.6rem] lg:text-[5rem]" role="img" aria-label={name}>
              {product?.emoji || inferProductEmoji({ name, description: product?.description })}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(21,17,14,0.72)] via-[rgba(21,17,14,0.18)] to-transparent p-2.5 sm:p-4">
          <span className="inline-flex max-w-full truncate rounded-full bg-[rgba(255,250,244,0.16)] px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.1em] text-white/90 backdrop-blur sm:px-3 sm:text-[10px] sm:tracking-[0.14em]">
            {normalizeCategoryLabel(product?.category, "Carta")}
          </span>
        </div>
      </div>
      <div className="p-3 sm:p-4 lg:p-5">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <h3 className="line-clamp-2 text-sm font-extrabold leading-[1.2] tracking-[-0.02em] text-[var(--text-strong)] sm:text-base lg:text-lg">{name}</h3>
          <p className="shrink-0 rounded-xl bg-[#201a16] px-2.5 py-1.5 text-[10px] font-extrabold text-white shadow-[0_10px_24px_rgba(32,26,22,0.16)] sm:rounded-2xl sm:px-3 sm:py-2 sm:text-xs">{formatPrice(price)}</p>
        </div>
        {product?.description && (
          <p className="mt-3 hidden line-clamp-2 text-xs leading-5 text-[var(--text-soft)] md:block lg:text-sm lg:leading-6">{product.description}</p>
        )}
        {product?.productType === "composite" && activeOptions.length > 0 && (
          <span className="mt-3 inline-flex rounded-full bg-[#efe4d8] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#8a674f] sm:text-[10px]">
            Personalizable · {activeOptions.length} elecciones
          </span>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-[#e8ded2] pt-3 text-[10px] font-extrabold text-[#9b5a35] sm:mt-4 sm:pt-3.5 sm:text-xs">
          <span>Ver detalle</span>
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#251a15] text-white transition group-hover:rotate-90 group-hover:bg-[#e76f28] sm:h-9 sm:w-9 sm:rounded-xl"><Plus size={14} /></span>
        </div>
      </div>
    </button>
  );
}

function Header({
  activeView,
  locale,
  menuIsActive,
  notifications,
  notificationsOpen,
  onChangeLocale,
  onLogout,
  onSelectNotification,
  onToggleNotifications,
  saveStatus,
  tenantName,
  unreadNotificationCount,
  viewCopy,
}: {
  activeView: View;
  locale: "en" | "es";
  menuIsActive: boolean;
  notifications: DashboardNotification[];
  notificationsOpen: boolean;
  onChangeLocale: (locale: "en" | "es") => void;
  onLogout: () => void;
  onSelectNotification: (notification: DashboardNotification) => void;
  onToggleNotifications: () => void;
  saveStatus: SaveStatus;
  tenantName: string;
  unreadNotificationCount: number;
  viewCopy: { eyebrow: string; title: string; description: string };
}) {
  return (
    <header className={`border-b border-[var(--shell-border)] px-3 sm:px-6 lg:px-8 ${activeView === "orders" ? "pb-3 pt-3 sm:pb-4 sm:pt-4" : "pb-4 pt-4 sm:pb-5"}`}>
      <div className={`flex flex-col xl:flex-row xl:items-end xl:justify-between ${activeView === "orders" ? "gap-3" : "gap-4"}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.58)] sm:text-[11px] sm:tracking-[0.18em]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,242,227,0.1)] bg-[rgba(255,248,240,0.04)] px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              {tenantName}
            </span>
            <span className="hidden text-[rgba(246,236,223,0.34)] sm:inline">/</span>
            <span>{viewCopy.eyebrow}</span>
          </div>
          <div className={`flex items-start gap-3 ${activeView === "orders" ? "mt-2" : "mt-3 sm:mt-4"}`}>
            <div className={`grid shrink-0 place-items-center border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] text-[var(--text-on-dark)] lg:hidden ${activeView === "orders" ? "h-10 w-10 rounded-[14px]" : "h-12 w-12 rounded-2xl"}`}>
              {activeView === "orders" ? <ClipboardList size={18} /> : <ChefHat size={18} />}
            </div>
            <div className="min-w-0">
              <h1 className={`app-display leading-none text-[var(--text-on-dark)] ${activeView === "orders" ? "text-[1.55rem] sm:text-[2rem]" : "text-[1.8rem] sm:text-[2.5rem] xl:text-[3.25rem]"}`}>
                {viewCopy.title}
              </h1>
              {viewCopy.description ? (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(246,236,223,0.68)] sm:text-[15px]">
                  {viewCopy.description}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <LanguageToggle className={activeView === "orders" ? "inline-flex" : "hidden md:inline-flex"} locale={locale} onChange={onChangeLocale} />
          <div className={`hidden h-12 items-center gap-2 rounded-2xl border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] px-4 text-sm font-semibold text-[var(--text-on-dark)] ${activeView === "orders" ? "" : "md:inline-flex"}`}>
            <ChefHat size={16} />
            {tenantName}
          </div>
          <NotificationBell
            compact={activeView === "orders"}
            locale={locale}
            notifications={notifications}
            open={notificationsOpen}
            unreadCount={unreadNotificationCount}
            onSelect={onSelectNotification}
            onToggle={onToggleNotifications}
          />
          {activeView !== "orders" ? <SaveIndicator locale={locale} menuIsActive={menuIsActive} status={saveStatus} /> : null}
          <button
            className={`inline-flex items-center justify-center border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] font-semibold text-[rgba(246,236,223,0.82)] transition hover:bg-[rgba(255,248,240,0.12)] hover:text-[var(--text-on-dark)] ${activeView === "orders" ? "h-10 rounded-[14px] px-3 text-xs" : "h-12 rounded-2xl px-4 text-sm"}`}
            onClick={onLogout}
            type="button"
          >
            {locale === "en" ? "Log out" : "Salir"}
          </button>
        </div>
      </div>
    </header>
  );
}

function NotificationBell({
  compact = false,
  locale,
  notifications,
  onSelect,
  onToggle,
  open,
  unreadCount,
}: {
  compact?: boolean;
  locale: "en" | "es";
  notifications: DashboardNotification[];
  onSelect: (notification: DashboardNotification) => void;
  onToggle: () => void;
  open: boolean;
  unreadCount: number;
}) {
  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={unreadCount > 0
          ? (locale === "en" ? `${unreadCount} new notifications` : `${unreadCount} notificaciones nuevas`)
          : (locale === "en" ? "Open notifications" : "Abrir notificaciones")}
        className={`relative inline-flex items-center justify-center border font-semibold transition ${compact ? "h-10 rounded-[14px] px-3 text-xs" : "h-12 rounded-2xl px-4 text-sm"} ${
          open
            ? "border-[rgba(213,192,154,0.34)] bg-[rgba(255,248,240,0.13)] text-[var(--text-on-dark)]"
            : "border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] text-[rgba(246,236,223,0.82)] hover:bg-[rgba(255,248,240,0.12)] hover:text-[var(--text-on-dark)]"
        }`}
        onClick={onToggle}
        type="button"
      >
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#c57b57] px-1.5 text-[10px] font-extrabold leading-none text-white shadow-[0_8px_22px_rgba(197,123,87,0.36)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="app-panel absolute right-0 z-30 mt-3 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-[24px]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Notifications" : "Notificaciones"}</h2>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto p-3 app-scrollbar">
            {notifications.length > 0 ? (
              notifications.map((notification) => (
                <button
                  className="w-full rounded-2xl border border-[rgba(118,93,71,0.14)] bg-[rgba(255,255,255,0.46)] p-3 text-left transition hover:border-[rgba(118,93,71,0.26)] hover:bg-white"
                  key={notification.id}
                  onClick={() => onSelect(notification)}
                  type="button"
                >
                  <p className="text-sm font-extrabold text-[var(--text-strong)]">{notification.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">{notification.detail}</p>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {notification.orderId
                      ? (locale === "en" ? "Open order" : "Abrir pedido")
                      : (locale === "en" ? "Open order center" : "Abrir centro de pedidos")}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[rgba(118,93,71,0.22)] p-4 text-sm leading-6 text-[var(--text-soft)]">
                {locale === "en" ? "There are no new orders since you opened the dashboard." : "No hay pedidos nuevos desde que abriste el dashboard."}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({ locale, status, menuIsActive }: { locale: "en" | "es"; status: SaveStatus; menuIsActive: boolean }) {
  const copy = {
    loading: locale === "en" ? "Loading data" : "Cargando datos",
    saving: locale === "en" ? "Saving changes" : "Guardando cambios",
    saved: locale === "en" ? "Everything synced" : "Todo sincronizado",
    offline: locale === "en" ? "Local mode" : "Modo local",
  }[status];

  return (
    <div className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] px-3 sm:px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(246,236,223,0.72)]">
      {status === "saving" || status === "loading" ? <Loader2 className="animate-spin" size={15} /> : <Check className="text-[#d5c09a]" size={15} />}
      <span className="hidden sm:inline">{copy}</span>
      <span className={`h-2.5 w-2.5 rounded-full ${menuIsActive ? "bg-[#bfa07f]" : "bg-[rgba(255,255,255,0.24)]"}`} />
    </div>
  );
}

function Sidebar({
  activeView,
  locale,
  navItems,
  onNavigate,
  tenantName,
}: {
  activeView: View;
  locale: "en" | "es";
  navItems: ReturnType<typeof getNavItems>;
  onNavigate: (view: View) => void;
  tenantName: string;
}) {
  return (
    <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[290px] shrink-0 rounded-[30px] border border-[var(--shell-border)] bg-[rgba(25,22,19,0.92)] px-4 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] lg:block">
      <div className="flex h-full flex-col">
        <div className="rounded-[26px] border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.03)] p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-[rgba(255,248,240,0.08)] ring-1 ring-[rgba(255,242,227,0.08)]">
              <img alt="ParaHoy" className="h-9 w-9 object-contain" src="/parahoy-logo-dark-no-bg.png" />
            </div>
            <div className="min-w-0">
              <p className="app-display text-[2rem] leading-none text-[var(--text-on-dark)]">ParaHoy</p>
              <p className="mt-1 truncate text-xs uppercase tracking-[0.18em] text-[rgba(246,236,223,0.44)]">{tenantName}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.34)]">
          {locale === "en" ? "Workspace" : "Workspace"}
        </div>
        <nav className="mt-3 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                className={`w-full rounded-[22px] border px-4 py-3 text-left transition ${
                  active
                    ? "border-[rgba(223,189,161,0.3)] bg-[rgba(236,215,198,0.12)] text-[var(--text-on-dark)]"
                    : "border-transparent bg-transparent text-[rgba(246,236,223,0.62)] hover:border-[rgba(255,242,227,0.08)] hover:bg-[rgba(255,248,240,0.04)] hover:text-[var(--text-on-dark)]"
                }`}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-2xl ${active ? "bg-[rgba(255,248,240,0.14)]" : "bg-[rgba(255,248,240,0.05)]"}`}>
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.label}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

function BottomNav({
  activeView,
  navItems,
  onNavigate,
}: {
  activeView: View;
  navItems: ReturnType<typeof getNavItems>;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-3 z-20 px-3 sm:px-4 lg:hidden">
      <div className="mx-auto max-w-xl rounded-[22px] border border-[rgba(255,242,227,0.12)] bg-[rgba(32,28,25,0.94)] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:rounded-[24px] sm:p-2">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                className={`flex min-h-[58px] flex-col items-center justify-center rounded-[16px] px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition sm:min-h-16 sm:rounded-[18px] sm:px-2 sm:text-[11px] sm:tracking-[0.08em] ${
                  active
                    ? "bg-[rgba(236,215,198,0.14)] text-[var(--text-on-dark)]"
                    : "text-[rgba(246,236,223,0.54)] hover:bg-[rgba(255,248,240,0.06)] hover:text-[var(--text-on-dark)]"
                }`}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <Icon size={17} />
                <span className="mt-1.5 max-w-full overflow-hidden text-ellipsis text-[9px] sm:text-[11px]">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function TodayMenu(props: {
  activeCount: number;
  items: MenuItem[];
  lastUpdated: string;
  menuIsActive: boolean;
  products: Product[];
  saveStatus: SaveStatus;
  tenantSlug: string;
  onAddDish: (productId: string) => Promise<void>;
  onDeleteDish: (itemId: string) => void;
  onUpdateDish: (itemId: string, patch: Partial<MenuItem>) => void;
}) {
  const locale = activeDashboardLocale;
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [reminderPreview, setReminderPreview] = useState<LunchReminderPreview | null>(null);
  const [reminderResult, setReminderResult] = useState<LunchReminderSendResult | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const inactiveCount = Math.max(props.items.length - props.activeCount, 0);
  const statusLabel = props.saveStatus === "saving"
    ? (locale === "en" ? "Saving" : "Guardando")
    : props.saveStatus === "offline"
      ? (locale === "en" ? "Offline" : "Sin conexion")
      : (locale === "en" ? "Synced" : "Sincronizado");
  const groups = groupMenuItemsByOrderType(props.items);

  useEffect(() => {
    let active = true;
    setReminderLoading(true);
    setReminderError("");

    getLunchReminderPreview(props.tenantSlug)
      .then((preview) => {
        if (!active) return;
        setReminderPreview(preview);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReminderPreview(null);
        setReminderError(error instanceof Error ? error.message : (locale === "en" ? "The reminder audience could not be calculated." : "No se pudo calcular el alcance del recordatorio."));
      })
      .finally(() => {
        if (active) setReminderLoading(false);
      });

    return () => {
      active = false;
    };
  }, [props.tenantSlug, props.activeCount, props.items.length]);

  async function handleSendLunchReminder() {
    if (!reminderPreview?.canSend || reminderSending) return;

    const confirmed = window.confirm(
      locale === "en"
        ? `Send WhatsApp to ${reminderPreview.recipientCount} customer${reminderPreview.recipientCount === 1 ? "" : "s"} who ordered in the last ${reminderPreview.lookbackDays} days?`
        : `Enviar WhatsApp a ${reminderPreview.recipientCount} cliente${reminderPreview.recipientCount === 1 ? "" : "s"} que pidieron en los ultimos ${reminderPreview.lookbackDays} dias?`,
    );
    if (!confirmed) return;

    setReminderSending(true);
    setReminderError("");
    try {
      const result = await sendLunchReminders(props.tenantSlug);
      setReminderResult(result);
      const nextPreview = await getLunchReminderPreview(props.tenantSlug).catch(() => reminderPreview);
      setReminderPreview(nextPreview);
    } catch (error) {
      setReminderError(error instanceof Error ? error.message : (locale === "en" ? "The reminder could not be sent." : "No se pudo enviar el recordatorio."));
    } finally {
      setReminderSending(false);
    }
  }

  return (
    <section className="space-y-5 pb-28 lg:space-y-6 lg:pb-32">
      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <div className="flex min-h-[240px] flex-col rounded-[24px] border border-[rgba(255,242,227,0.08)] bg-[rgba(223,201,178,0.08)] p-5 text-[var(--text-on-dark)] shadow-[0_18px_50px_rgba(0,0,0,0.16)] sm:rounded-[28px] sm:p-6">
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.5)]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,242,227,0.08)] px-3 py-1.5">
              <Clock size={14} />
              {locale === "en" ? "Updated" : "Actualizado"} {props.lastUpdated}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,242,227,0.08)] px-3 py-1.5">
              <span className={`h-2 w-2 rounded-full ${props.menuIsActive ? "bg-[#d2b08e]" : "bg-[rgba(255,255,255,0.24)]"}`} />
              {props.menuIsActive ? (locale === "en" ? "Service published" : "Servicio publicado") : (locale === "en" ? "Menu inactive" : "Menu sin activar")}
            </span>
          </div>
          <h2 className="app-display mt-5 text-[2rem] leading-none sm:text-[3rem]">
            {locale === "en" ? "Curate today's menu" : "Armar menú del día"}
          </h2>
          <div className="mt-auto pt-6">
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--panel)] px-5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)]"
              onClick={() => setCatalogOpen(true)}
              type="button"
            >
              <Plus size={17} />
              {locale === "en" ? "Add from catalog" : "Agregar desde catalogo"}
            </button>
          </div>
        </div>

        <LunchReminderPanel
          error={reminderError}
          loading={reminderLoading}
          preview={reminderPreview}
          result={reminderResult}
          sending={reminderSending}
          onSend={() => void handleSendLunchReminder()}
        />

        <MenuMetricsPanel
          activeCount={props.activeCount}
          inactiveCount={inactiveCount}
          statusLabel={statusLabel}
        />
      </div>

      {groups.length === 0 ? (
        <div className="app-panel rounded-[28px] px-6 py-16 text-center">
          <p className="app-display text-[2.1rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "There are no published dishes yet" : "Aun no hay platos publicados"}</p>
          <button
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923]"
            onClick={() => setCatalogOpen(true)}
            type="button"
          >
            <Plus size={17} />
            {locale === "en" ? "Start the menu" : "Empezar con el menu"}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => (
            <div className="app-panel rounded-[28px] overflow-hidden" key={group.id}>
              <div className="border-b border-[rgba(118,93,71,0.12)] px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-[16px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{group.label}</h1>
                  </div>
                  <div className="rounded-full bg-[rgba(197,123,87,0.12)] px-3 py-2 text-xs font-semibold text-[var(--warning)]">
                    {group.activeCount} {locale === "en" ? "visible now" : "visibles ahora"}
                  </div>
                </div>
              </div>
              <div className="app-scrollbar max-h-[520px] space-y-3 overflow-y-auto px-4 py-4">
                {group.items.map((item) => (
                  <DishRow
                    item={item}
                    key={item.id}
                    onDelete={() => props.onDeleteDish(item.id)}
                    onUpdate={(patch) => props.onUpdateDish(item.id, patch)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {catalogOpen && (
        <AddDishModal items={props.items} products={props.products} onAdd={props.onAddDish} onClose={() => setCatalogOpen(false)} />
      )}
    </section>
  );
}

function groupMenuItemsByOrderType(items: MenuItem[]) {
  return groupByCategorySection(items, (item) => item.product?.category).map((group) => ({
    ...group,
    activeCount: group.items.filter((item) => item.isAvailable).length,
  }));
}

function MenuMetricsPanel({
  activeCount,
  inactiveCount,
  statusLabel,
}: {
  activeCount: number;
  inactiveCount: number;
  statusLabel: string;
}) {
  const locale = activeDashboardLocale;
  return (
    <div className="flex min-h-[260px] flex-col rounded-[28px] border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.05)] p-5 text-[var(--text-on-dark)] shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Menu metrics" : "Metricas del menu"}</p>
      <div className="mt-4 grid flex-1 gap-3">
        <div className="rounded-[22px] bg-[rgba(255,248,240,0.07)] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Active dishes" : "Platos activos"}</p>
          <p className="app-display mt-2 text-[2.6rem] leading-none">{activeCount}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="rounded-[22px] bg-[rgba(255,248,240,0.07)] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Hidden" : "Ocultos"}</p>
            <p className="mt-2 text-2xl font-extrabold">{inactiveCount}</p>
          </div>
          <div className="rounded-[22px] bg-[rgba(255,248,240,0.07)] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Sync status" : "Sincronizacion"}</p>
            <p className="mt-2 truncate text-lg font-extrabold">{statusLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LunchReminderPanel({
  error,
  loading,
  onSend,
  preview,
  result,
  sending,
}: {
  error: string;
  loading: boolean;
  onSend: () => void;
  preview: LunchReminderPreview | null;
  result: LunchReminderSendResult | null;
  sending: boolean;
}) {
  const locale = activeDashboardLocale;
  const canSend = Boolean(preview?.canSend) && !loading && !sending;
  const disabledReason = !preview
    ? (locale === "en" ? "Calculating recent customers" : "Calculando clientes recientes")
    : preview.menuItemCount === 0
      ? (locale === "en" ? "Publish today's available dishes first" : "Publica platos disponibles para hoy")
      : preview.recipientCount === 0
        ? (locale === "en" ? "There are no customers with orders in the last 3 days" : "No hay clientes con pedidos en los ultimos 3 dias")
        : "";

  return (
    <div className="flex min-h-[260px] flex-col overflow-hidden rounded-[28px] border border-[rgba(255,242,227,0.1)] bg-[rgba(255,248,240,0.08)] p-4 text-[var(--text-on-dark)] shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.42)]">WhatsApp</p>
          <h3 className="mt-2 text-base font-extrabold">{locale === "en" ? "Reactivate recent customers" : "Activar clientes recientes"}</h3>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[rgba(255,248,240,0.08)] text-[rgba(246,236,223,0.78)]">
          <Bell size={17} />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-[rgba(255,248,240,0.08)] px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Customers" : "Clientes"}</p>
          <p className="mt-1 text-xl font-extrabold">{loading ? "..." : preview?.recipientCount ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-[rgba(255,248,240,0.08)] px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(246,236,223,0.42)]">{locale === "en" ? "Dishes" : "Platos"}</p>
          <p className="mt-1 text-xl font-extrabold">{loading ? "..." : preview?.menuItemCount ?? 0}</p>
        </div>
      </div>

      {preview?.messagePreview ? (
        <div className="mt-3 max-h-20 overflow-y-auto rounded-2xl bg-[rgba(18,15,13,0.36)] px-3 py-2.5 text-xs leading-5 text-[rgba(246,236,223,0.72)] app-scrollbar">
          {preview.messagePreview}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-2xl border border-[rgba(79,122,97,0.18)] bg-[rgba(79,122,97,0.12)] px-3 py-2.5 text-xs font-semibold text-[#d8f0dd]">
          {locale === "en" ? "Sent" : "Enviado"}: {result.sentCount} {locale === "en" ? "successful" : "exitosos"}, {result.failedCount} {locale === "en" ? "failed" : "fallidos"}.
        </div>
      ) : null}

      {error || disabledReason ? (
        <p className="mt-2 text-xs leading-5 text-[rgba(246,236,223,0.56)]">{error || disabledReason}</p>
      ) : null}

      <div className="mt-auto pt-3">
        <button
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--panel)] px-4 text-sm font-extrabold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!canSend}
          onClick={onSend}
          type="button"
        >
          {sending || loading ? <Loader2 className="animate-spin" size={16} /> : <Bell size={16} />}
          {sending ? (locale === "en" ? "Sending reminder..." : "Enviando recordatorio...") : (locale === "en" ? "Send reminder" : "Enviar recordatorio")}
        </button>
      </div>
    </div>
  );
}

function DishRow({ item, onDelete, onUpdate }: { item: MenuItem; onDelete: () => void; onUpdate: (patch: Partial<MenuItem>) => void }) {
  const locale = activeDashboardLocale;
  const name = item.displayName ?? item.product?.name ?? "Producto sin nombre";
  const price = item.priceOverride ?? item.product?.basePrice ?? 0;

  return (
    <article className={`rounded-[24px] border p-4 transition ${item.isAvailable ? "border-[rgba(118,93,71,0.12)] bg-[rgba(244,236,225,0.84)]" : "border-[rgba(118,93,71,0.1)] bg-[rgba(232,220,206,0.7)]"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <ProductImage
              description={item.product?.description}
              emoji={item.product?.emoji}
              imageUrl={item.product?.imageUrl}
              name={name}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={`truncate text-sm font-semibold ${item.isAvailable ? "text-[var(--text-strong)]" : "text-[var(--text-soft)]"}`}>{name}</h3>
                {!item.isAvailable && (
                  <span className="rounded-full bg-[rgba(118,93,71,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {locale === "en" ? "Hidden" : "Oculto"}
                  </span>
                )}
              </div>
              {item.product?.description && (
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--text-soft)]">{item.product.description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <label className="inline-flex h-12 min-w-0 w-full items-center rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(250,245,238,0.72)] px-4 sm:w-40">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">COP</span>
            <input
              aria-label={`Precio de ${name}`}
              className="ml-3 w-full bg-transparent text-right text-sm font-semibold text-[var(--text-strong)] outline-none"
              min="0"
              onChange={(event) => onUpdate({ priceOverride: Number(event.target.value) })}
              type="number"
              value={price}
            />
          </label>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <AvailabilitySwitch checked={item.isAvailable} onChange={() => onUpdate({ isAvailable: !item.isAvailable })} />
            <button
              className="grid h-12 w-12 place-items-center rounded-2xl border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] transition hover:border-[rgba(180,94,84,0.22)] hover:bg-[rgba(190,110,95,0.08)] hover:text-[#9a4b43]"
              onClick={onDelete}
              title={locale === "en" ? "Delete dish" : "Eliminar plato"}
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function AvailabilitySwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  const locale = activeDashboardLocale;
  return (
    <button
      aria-pressed={checked}
      className={`inline-flex h-12 items-center gap-2 rounded-2xl px-3 text-sm font-semibold transition ${
        checked
          ? "bg-[rgba(79,122,97,0.1)] text-[var(--success)]"
          : "bg-[rgba(118,93,71,0.08)] text-[var(--text-soft)]"
      }`}
      onClick={onChange}
      type="button"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-[var(--success)]" : "bg-[var(--text-faint)]"}`} />
      {checked ? (locale === "en" ? "Visible" : "Visible") : (locale === "en" ? "Paused" : "Pausado")}
    </button>
  );
}

function AddDishModal(props: { items: MenuItem[]; products: Product[]; onAdd: (productId: string) => Promise<void>; onClose: () => void }) {
  const locale = activeDashboardLocale;
  const [query, setQuery] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const existingIds = useMemo(() => new Set(props.items.map((item) => item.productId)), [props.items]);
  const availableProducts = props.products
    .filter((product) => product.isActive && !existingIds.has(product.id))
    .filter((product) => `${product.name} ${product.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const groupedProducts = useMemo(
    () => groupByCategorySection(availableProducts, (product) => product.category),
    [availableProducts],
  );

  function toggleSelect(productId: string) {
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((entry) => entry !== productId)
        : [...current, productId]
    ));
  }

  function toggleCategory(productIds: string[]) {
    const allSelected = productIds.every((productId) => selectedProductIds.includes(productId));
    setSelectedProductIds((current) => {
      if (allSelected) {
        return current.filter((productId) => !productIds.includes(productId));
      }

      return Array.from(new Set([...current, ...productIds]));
    });
  }

  async function handleSubmit() {
    if (selectedProductIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      for (const productId of selectedProductIds) {
        await props.onAdd(productId);
      }
      props.onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={locale === "en" ? "Add from catalog" : "Agregar desde catalogo"} onClose={props.onClose}>
      <div className="sticky top-0 z-20 -mx-5 -mt-5 border-b border-[rgba(118,93,71,0.1)] bg-[var(--panel)] px-5 pb-4 pt-5 shadow-[0_14px_30px_rgba(20,14,10,0.08)] sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" size={17} />
          <input
            autoFocus
            className="h-12 w-full rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] pl-11 pr-4 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:bg-[var(--panel-strong)] focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={locale === "en" ? "Search dish..." : "Buscar plato..."}
            value={query}
          />
        </div>
        <div className="app-panel-muted mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[var(--text-soft)]">
          <span>{selectedProductIds.length} {locale === "en" ? "selected" : "seleccionados"}</span>
          <span className="text-xs text-[var(--text-faint)]">{availableProducts.length} {locale === "en" ? "available" : "disponibles"}</span>
        </div>
      </div>
      <div className="app-scrollbar mt-4 max-h-[420px] space-y-3 overflow-y-auto">
        {groupedProducts.length === 0 && (
          <div className="rounded-[22px] border border-[rgba(118,93,71,0.1)] bg-[rgba(248,241,232,0.72)] px-4 py-6 text-center text-sm text-[var(--text-soft)]">
            {locale === "en" ? "There are no more active products available to add to the menu." : "No hay mas productos activos disponibles para agregar al menu."}
          </div>
        )}
        {groupedProducts.map((group) => {
          const ids = group.items.map((product) => product.id);
          const allSelected = ids.every((id) => selectedProductIds.includes(id));

          return (
            <section className="rounded-[22px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.9)] p-3" key={group.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{group.label}</p>
                <button
                  className="inline-flex h-9 items-center rounded-xl border border-[rgba(118,93,71,0.12)] px-3 text-xs font-semibold text-[var(--text-soft)]"
                  onClick={() => toggleCategory(ids)}
                  type="button"
                >
                  {allSelected ? (locale === "en" ? "Clear selection" : "Quitar seleccion") : (locale === "en" ? "Select category" : "Seleccionar categoria")}
                </button>
              </div>
              <div className="space-y-2">
                {group.items.map((product) => {
                  const selected = selectedProductIds.includes(product.id);
                  return (
                    <button
                      className={`flex w-full flex-col items-start gap-3 rounded-[18px] border p-3 text-left transition sm:flex-row sm:items-center ${selected ? "border-[rgba(197,123,87,0.25)] bg-[rgba(247,238,228,0.95)]" : "border-[rgba(118,93,71,0.1)] bg-white/80 hover:border-[rgba(197,123,87,0.22)] hover:bg-white"}`}
                      key={product.id}
                      onClick={() => toggleSelect(product.id)}
                      type="button"
                    >
                      <ProductImage
                        description={product.description}
                        emoji={product.emoji}
                        imageUrl={product.imageUrl}
                        name={product.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--text-strong)]">{product.name}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--text-soft)]">{product.description}</p>
                      </div>
                      <span className="text-sm font-semibold text-[var(--text-strong)] sm:ml-auto">{formatPrice(product.basePrice)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={selectedProductIds.length === 0 || isSubmitting}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          {locale === "en" ? "+ Add from catalog" : "+ Agregar desde catalogo"}
        </button>
      </div>
    </Modal>
  );
}

function Summary({
  activeCount,
  items,
  onEditMenu,
  onOpenOrders,
  tenantSlug,
  totalCount,
}: {
  activeCount: number;
  items: MenuItem[];
  onEditMenu: () => void;
  onOpenOrders: () => void;
  tenantSlug: string;
  totalCount: number;
}) {
  const locale = activeDashboardLocale;
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const inactiveCount = Math.max(totalCount - activeCount, 0);
  const coverage = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
  const activeMenuItems = useMemo(() => items.filter((item) => item.isAvailable), [items]);
  const averageMenuPrice = activeMenuItems.length > 0
    ? Math.round(activeMenuItems.reduce((sum, item) => sum + (item.priceOverride ?? item.product?.basePrice ?? 0), 0) / activeMenuItems.length)
    : 0;
  const activeCategoryCount = useMemo(
    () => new Set(activeMenuItems.map((item) => normalizeCategoryKey(item.product?.category))).size,
    [activeMenuItems],
  );

  useEffect(() => {
    let active = true;

    async function loadSummaryOrders() {
      setOrdersLoading(true);
      try {
        const payload = await listOrders(tenantSlug, "all");
        if (!active) return;
        setOrders(payload.orders);
        setOrdersError("");
      } catch (error) {
        if (!active) return;
        setOrdersError(error instanceof Error ? error.message : (locale === "en" ? "Orders could not be loaded." : "No se pudieron cargar los pedidos."));
      } finally {
        if (active) {
          setOrdersLoading(false);
        }
      }
    }

    void loadSummaryOrders();

    return () => {
      active = false;
    };
  }, [tenantSlug]);

  const todayKey = getDayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getDayKey(yesterday);

  const todaysOrders = useMemo(
    () => orders
      .filter((order) => getDayKey(order.createdAt) === todayKey)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    [orders, todayKey],
  );
  const yesterdayOrders = useMemo(
    () => orders.filter((order) => getDayKey(order.createdAt) === yesterdayKey),
    [orders, yesterdayKey],
  );
  const deliveredToday = useMemo(
    () => todaysOrders.filter((order) => order.status === "delivered"),
    [todaysOrders],
  );
  const cancelledToday = useMemo(
    () => todaysOrders.filter((order) => order.status === "cancelled"),
    [todaysOrders],
  );
  const productiveOrdersToday = useMemo(
    () => todaysOrders.filter((order) => order.status !== "cancelled"),
    [todaysOrders],
  );
  const revenueToday = productiveOrdersToday.reduce((sum, order) => sum + order.total, 0);
  const averageTicket = productiveOrdersToday.length > 0 ? Math.round(revenueToday / productiveOrdersToday.length) : 0;
  const orderDelta = todaysOrders.length - yesterdayOrders.length;
  const closedTodayCount = deliveredToday.length + cancelledToday.length;

  return (
    <section className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="rounded-[28px] border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.06)] p-6 text-[var(--text-on-dark)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.46)]">{locale === "en" ? "Menu overview" : "Generalidades de menu"}</p>
          <h2 className="app-display mt-4 text-[2.8rem] leading-none sm:text-[3.4rem]">
            {activeCount > 0
              ? (locale === "en" ? "Menu ready to sell today" : "Menu alineado para vender hoy")
              : (locale === "en" ? "The menu still needs to be activated" : "Hace falta activar el menu")}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[rgba(246,236,223,0.68)]">
            {locale === "en"
              ? `${activeCount} visible dishes, ${inactiveCount} hidden and ${activeCategoryCount} active sections in today's menu.`
              : `${activeCount} platos visibles, ${inactiveCount} ocultos y ${activeCategoryCount} secciones activas en la carta del dia.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--panel)] px-5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)]"
              onClick={onEditMenu}
              type="button"
            >
              <Edit3 size={17} />
              {locale === "en" ? "Adjust today's menu" : "Ajustar menu de hoy"}
            </button>
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.04)] px-5 text-sm font-semibold text-[var(--text-on-dark)] transition hover:bg-[rgba(255,248,240,0.08)]"
              onClick={onOpenOrders}
              type="button"
            >
              <ClipboardList size={17} />
              {locale === "en" ? "Review orders" : "Revisar pedidos"}
            </button>
          </div>
        </div>

        <div className="app-panel rounded-[28px] p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Menu coverage" : "Cobertura del menu"}</p>
          <p className="app-display mt-4 text-[4rem] leading-none text-[var(--text-strong)]">{coverage}%</p>
          <p className="mt-3 text-sm leading-7 text-[var(--text-soft)]">
            {locale === "en" ? "Visible average ticket" : "Ticket promedio visible"} {formatPrice(averageMenuPrice)}.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="app-panel rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Dishes and menu" : "Platos y menu"}</p>
              <h3 className="mt-3 text-xl font-semibold text-[var(--text-strong)]">{locale === "en" ? "Operational overview" : "Generalidades operativas"}</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
              {activeCategoryCount} {locale === "en" ? "active categories" : "categorias activas"}
            </span>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SummaryMetricCard label={locale === "en" ? "Menu dishes" : "Platos en menu"} tone="neutral" value={String(activeCount)} />
            <SummaryMetricCard label={locale === "en" ? "Hidden dishes" : "Platos ocultos"} tone="neutral" value={String(inactiveCount)} />
            <SummaryMetricCard label={locale === "en" ? "Total on menu" : "Total en carta"} tone="neutral" value={String(totalCount)} />
            <SummaryMetricCard label={locale === "en" ? "Average price" : "Precio promedio"} tone="neutral" value={formatPrice(averageMenuPrice)} />
          </div>
        </div>

        <div className="app-panel rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Orders placed" : "Pedidos realizados"}</p>
              <h3 className="mt-3 text-xl font-semibold text-[var(--text-strong)]">{locale === "en" ? "Today's sales pulse" : "Pulso comercial del dia"}</h3>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              orderDelta > 0
                ? "bg-[rgba(79,122,97,0.12)] text-[var(--success)]"
                : orderDelta < 0
                  ? "bg-[rgba(197,123,87,0.12)] text-[var(--warning)]"
                  : "bg-[var(--surface-base)] text-[var(--text-soft)]"
            }`}>
              {getOrderDeltaLabel(orderDelta)}
            </span>
          </div>
          {ordersLoading ? (
            <div className="mt-5 rounded-[22px] bg-[var(--surface-base)] px-4 py-8 text-center text-sm text-[var(--text-soft)]">
              {locale === "en" ? "Loading today's orders..." : "Cargando pedidos del dia..."}
            </div>
          ) : ordersError ? (
            <div className="mt-5 rounded-[22px] border border-[rgba(180,94,84,0.18)] bg-[rgba(190,110,95,0.08)] px-4 py-4 text-sm text-[#8c4e47]">
              {ordersError}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <SummaryMetricCard label={locale === "en" ? "Orders today" : "Pedidos hoy"} tone="info" value={String(todaysOrders.length)} />
              <SummaryMetricCard label={locale === "en" ? "Revenue today" : "Ventas del dia"} tone="success" value={formatPrice(revenueToday)} />
              <SummaryMetricCard label={locale === "en" ? "Average ticket" : "Ticket promedio"} tone="info" value={formatPrice(averageTicket)} />
              <SummaryMetricCard label={locale === "en" ? "Closed today" : "Cerrados hoy"} tone="neutral" value={String(closedTodayCount)} />
            </div>
          )}
        </div>
      </div>

      <PublicCartaShareCard tenantSlug={tenantSlug} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_420px]">
        <div className="app-panel rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Sales chart" : "Grafico de ventas"}</p>
              <h3 className="mt-3 text-xl font-semibold text-[var(--text-strong)]">{locale === "en" ? "Receipts issued today" : "Recibos emitidos hoy"}</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
              {todaysOrders.length} {locale === "en" ? "receipts" : "recibos"}
            </span>
          </div>
          <div className="mt-5">
            <SalesChart orders={todaysOrders} />
          </div>
        </div>

        <div className="app-panel rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Billing" : "Cuenta - factura"}</p>
              <h3 className="mt-3 text-xl font-semibold text-[var(--text-strong)]">{locale === "en" ? "Today's receipts" : "Recibos del dia"}</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
              {productiveOrdersToday.length} {locale === "en" ? "active" : "activos"}
            </span>
          </div>
          <div className="app-scrollbar mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {todaysOrders.length === 0 ? (
              <div className="rounded-[22px] bg-[var(--surface-base)] px-4 py-8 text-center text-sm text-[var(--text-soft)]">
                {locale === "en" ? "There are no receipts generated today yet." : "Aun no hay recibos generados hoy."}
              </div>
            ) : (
              todaysOrders.map((order) => (
                <div className="rounded-[22px] border border-[rgba(118,93,71,0.1)] bg-[var(--surface-base)] p-4" key={order.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                        {locale === "en" ? "Receipt" : "Factura"} #{getReceiptCode(order.id)}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-strong)]">
                        {order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-faint)]">
                        {formatDateTime(order.createdAt)} - {getSummaryOrderStatusLabel(order.status)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-[var(--text-strong)]">{formatPrice(order.total)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PublicCartaShareCard({ tenantSlug }: { tenantSlug: string }) {
  const locale = activeDashboardLocale;
  const cartaUrl = getPublicCartaUrl(tenantSlug);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(cartaUrl, {
      color: {
        dark: "#201a16",
        light: "#edf2f7",
      },
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    })
      .then((dataUrl: string) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });

    return () => {
      active = false;
    };
  }, [cartaUrl]);

  async function copyCartaUrl() {
    try {
      await navigator.clipboard.writeText(cartaUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app-panel overflow-hidden rounded-[30px]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-base)] px-3 py-1.5">
              <QrCode size={14} />
              {locale === "en" ? "Public menu" : "Carta publica"}
            </span>
            <span className="rounded-full bg-[rgba(197,123,87,0.12)] px-3 py-1.5 text-[var(--warning)]">{locale === "en" ? "Read only" : "Solo lectura"}</span>
          </div>
          <h3 className="app-display mt-5 text-[3rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "QR for table customers" : "QR para clientes en mesa"}</h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--text-soft)]">
            {locale === "en"
              ? "This QR opens the restaurant's public menu. Customers can only view dishes, prices and components; they cannot edit products or add them to the menu."
              : "Este QR abre la carta publica del restaurante. Los clientes solo pueden consultar platos, precios y componentes; no pueden editar productos ni agregar al menu."}
          </p>
          <div className="mt-6 rounded-[22px] border border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] px-4 py-3 text-sm font-semibold text-[var(--text-soft)]">
            <span className="block truncate">{cartaUrl}</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923]"
              href={cartaUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={17} />
              {locale === "en" ? "Open menu" : "Abrir carta"}
            </a>
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-5 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-base)]"
              onClick={() => void copyCartaUrl()}
              type="button"
            >
              <Copy size={17} />
              {copied ? (locale === "en" ? "Link copied" : "Link copiado") : (locale === "en" ? "Copy link" : "Copiar link")}
            </button>
          </div>
        </div>
        <div className="grid place-items-center bg-[linear-gradient(145deg,#201a16,#443228)] p-6">
          <div className="rounded-[30px] bg-[#edf2f7] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            {qrDataUrl ? (
              <img alt={locale === "en" ? "Public menu QR" : "QR de la carta publica"} className="h-56 w-56 rounded-[20px]" src={qrDataUrl} />
            ) : (
              <div className="grid h-56 w-56 place-items-center rounded-[20px] bg-white text-sm font-semibold text-[var(--text-soft)]">
                {locale === "en" ? "Generating QR..." : "Generando QR..."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryMetricCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "neutral" | "info" | "success";
  value: string;
}) {
  const palette = {
    neutral: "bg-[var(--surface-base)]",
    info: "bg-[var(--surface-pending)]",
    success: "bg-[var(--surface-confirmed)]",
  }[tone];

  return (
    <div className={`rounded-[22px] border border-[rgba(118,93,71,0.1)] p-4 ${palette}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</p>
      <p className="mt-4 text-2xl font-semibold text-[var(--text-strong)]">{value}</p>
    </div>
  );
}

function SalesChart({ orders }: { orders: OrderSummary[] }) {
  const locale = activeDashboardLocale;
  if (orders.length === 0) {
    return (
      <div className="rounded-[22px] bg-[var(--surface-base)] px-4 py-12 text-center text-sm text-[var(--text-soft)]">
        {locale === "en" ? "There are no sales recorded today yet." : "Todavia no hay ventas registradas hoy para graficar."}
      </div>
    );
  }

  const maxTotal = Math.max(...orders.map((order) => order.total), 1);

  return (
    <div className="space-y-4">
      <div className="flex h-[260px] items-end gap-3 rounded-[24px] bg-[var(--surface-base)] px-4 py-5">
        {orders.map((order) => {
          const height = Math.max((order.total / maxTotal) * 100, 12);
          const barTone = order.status === "cancelled"
            ? "bg-[rgba(197,123,87,0.4)]"
            : order.status === "delivered"
              ? "bg-[var(--success)]"
              : "bg-[#7b92ab]";

          return (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2" key={order.id}>
              <span className="text-[11px] font-semibold text-[var(--text-faint)]">{formatCompactPrice(order.total)}</span>
              <div className="flex h-[180px] w-full items-end">
                <div
                  className={`w-full rounded-t-[16px] ${barTone}`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="max-w-full truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                #{getReceiptCode(order.id)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-semibold text-[var(--text-soft)]">
        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-confirmed)] px-3 py-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
          {locale === "en" ? "Delivered" : "Entregado"}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-pending)] px-3 py-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#7b92ab]" />
          {locale === "en" ? "In progress" : "En curso"}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(197,123,87,0.1)] px-3 py-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[rgba(197,123,87,0.6)]" />
          {locale === "en" ? "Cancelled" : "Cancelado"}
        </span>
      </div>
    </div>
  );
}

function getDayKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getOrderDeltaLabel(delta: number) {
  const locale = activeDashboardLocale;
  if (delta > 0) {
    return locale === "en" ? `+${delta} vs yesterday` : `+${delta} vs ayer`;
  }

  if (delta < 0) {
    return locale === "en" ? `${delta} vs yesterday` : `${delta} vs ayer`;
  }

  return locale === "en" ? "Same as yesterday" : "Igual que ayer";
}

function getSummaryOrderStatusLabel(status: OrderSummary["status"]) {
  const locale = activeDashboardLocale;
  return {
    new: locale === "en" ? "New" : "Nuevo",
    pending_restaurant_confirmation: locale === "en" ? "Restaurant pending" : "Pendiente restaurante",
    needs_customer_replacement: locale === "en" ? "Customer pending" : "Pendiente cliente",
    payment_pending_review: locale === "en" ? "Payment pending" : "Pago pendiente",
    accepted: locale === "en" ? "Accepted" : "Aceptado",
    preparing: locale === "en" ? "Preparing" : "Preparando",
    on_the_way: locale === "en" ? "Ready / 30 min delivery" : "Listo / delivery 30",
    delivered: locale === "en" ? "Delivered" : "Entregado",
    cancelled: locale === "en" ? "Cancelled" : "Cancelado",
  }[status];
}

function getReceiptCode(orderId: string) {
  const compact = orderId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return compact.slice(-8) || orderId.slice(-8);
}

function formatCompactPrice(value: number | undefined) {
  return new Intl.NumberFormat(activeDashboardLocale === "en" ? "en-US" : "es-CO", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

function Catalog({
  categories,
  imageColumnReady,
  menuProductIds,
  onAddToMenu,
  products,
  onDelete,
  onSave,
  onUpdateCategoryEmoji,
}: {
  categories: ProductCategory[];
  imageColumnReady: boolean;
  menuProductIds: Set<string>;
  onAddToMenu: (productId: string) => Promise<void>;
  products: Product[];
  onDelete: (productId: string) => Promise<void>;
  onSave: (product: ProductFormValue) => Promise<void>;
  onUpdateCategoryEmoji: (categoryId: string, emoji: string) => Promise<void>;
}) {
  const locale = activeDashboardLocale;
  const [modalProduct, setModalProduct] = useState<Partial<Product> | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [isAddingToMenu, setIsAddingToMenu] = useState(false);
  const [categorySavingByProductId, setCategorySavingByProductId] = useState<Record<string, boolean>>({});
  const groupedProducts = useMemo(
    () => groupByCategorySection(products, (product) => product.category),
    [products],
  );
  const categoryOptions = useMemo(() => collectCategoryOptions(products, categories), [categories, products]);

  useEffect(() => {
    setSelectedProductIds((current) => current.filter((productId) => products.some((product) => product.id === productId)));
  }, [products]);

  useEffect(() => {
    const validGroupIds = new Set(groupedProducts.map((group) => group.id));
    setExpandedCategoryIds((current) => new Set([...current].filter((categoryId) => validGroupIds.has(categoryId))));
  }, [groupedProducts]);

  const selectedAddableIds = useMemo(
    () => selectedProductIds.filter((productId) => !menuProductIds.has(productId)),
    [menuProductIds, selectedProductIds],
  );

  async function handleAddSelectedToMenu() {
    if (selectedAddableIds.length === 0 || isAddingToMenu) {
      return;
    }

    setIsAddingToMenu(true);
    try {
      for (const productId of selectedAddableIds) {
        await onAddToMenu(productId);
      }
      setSelectedProductIds([]);
    } finally {
      setIsAddingToMenu(false);
    }
  }

  function toggleProductSelection(productId: string) {
    if (menuProductIds.has(productId)) {
      return;
    }
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((entry) => entry !== productId)
        : [...current, productId]
    ));
  }

  function toggleCategorySelection(productIds: string[]) {
    const selectableProductIds = productIds.filter((productId) => !menuProductIds.has(productId));
    if (selectableProductIds.length === 0) {
      return;
    }
    const allSelected = selectableProductIds.every((productId) => selectedProductIds.includes(productId));
    setSelectedProductIds((current) => {
      if (allSelected) {
        return current.filter((productId) => !selectableProductIds.includes(productId));
      }

      return Array.from(new Set([...current, ...selectableProductIds]));
    });
  }

  function toggleCategoryExpansion(categoryId: string) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  async function updateProductCategory(product: Product, nextCategory: string) {
    if (categorySavingByProductId[product.id]) {
      return;
    }
    setCategorySavingByProductId((current) => ({ ...current, [product.id]: true }));
    try {
      await onSave({
        id: product.id,
        name: product.name,
        description: product.description,
        basePrice: product.basePrice,
        emoji: product.emoji,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
        category: nextCategory,
        productType: product.productType ?? "simple",
        options: product.options ?? [],
      });
    } finally {
      setCategorySavingByProductId((current) => ({ ...current, [product.id]: false }));
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <SectionTitle title={locale === "en" ? "Products" : "Productos"} subtitle={`${products.length} ${locale === "en" ? "products managed" : "productos gestionados"}`} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="app-panel-muted flex rounded-2xl p-1">
            <button
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${viewMode === "cards" ? "bg-[rgba(225,211,194,0.78)] text-[var(--text-strong)]" : "text-[var(--text-soft)]"}`}
              onClick={() => setViewMode("cards")}
              type="button"
            >
              <LayoutGrid size={16} />
              {locale === "en" ? "Cards" : "Tarjetas"}
            </button>
            <button
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${viewMode === "list" ? "bg-[rgba(225,211,194,0.78)] text-[var(--text-strong)]" : "text-[var(--text-soft)]"}`}
              onClick={() => setViewMode("list")}
              type="button"
            >
              <List size={16} />
              {locale === "en" ? "List" : "Lista"}
            </button>
          </div>
          <button
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--panel)] px-5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)] sm:w-auto"
            onClick={() => setModalProduct({ isActive: true })}
            type="button"
          >
            <Plus size={17} />
            {locale === "en" ? "New product" : "Nuevo producto"}
          </button>
          <button
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923] sm:w-auto"
            onClick={() => setModalProduct(createCompositeProductDraft())}
            type="button"
          >
            <Plus size={17} />
            {locale === "en" ? "New composite" : "Nuevo compuesto"}
          </button>
        </div>
      </div>

      <div className="fixed bottom-[calc(5.8rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex w-[min(760px,calc(100vw-1.25rem))] -translate-x-1/2 flex-col items-stretch gap-3 rounded-[22px] border border-[rgba(255,242,227,0.16)] bg-[rgba(237,242,247,0.94)] px-3 py-3 text-[var(--text-strong)] shadow-[0_22px_70px_rgba(20,14,10,0.3)] backdrop-blur-xl sm:w-[min(760px,calc(100vw-2rem))] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:rounded-[24px] sm:px-4 lg:bottom-7">
        <p className="min-w-0 text-sm font-semibold text-[var(--text-soft)]">
          {selectedProductIds.length} {locale === "en" ? "selected" : "seleccionados"}
          {selectedProductIds.length > selectedAddableIds.length ? ` · ${selectedProductIds.length - selectedAddableIds.length} ${locale === "en" ? "already on the menu" : "ya estan en menu"}` : ""}
        </p>
        <button
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={selectedAddableIds.length === 0 || isAddingToMenu}
          onClick={() => void handleAddSelectedToMenu()}
          type="button"
        >
          {isAddingToMenu ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          {locale === "en" ? "Add selection to menu" : "Agregar seleccion al menu"}
        </button>
      </div>

      <div className="space-y-5">
        {groupedProducts.map((group) => {
          const category = categories.find((entry) => normalizeCategoryKey(entry.name) === group.id);
          const categoryEmoji = category?.emoji || getDefaultCategoryEmoji(group.label);
          const productIds = group.items.map((product) => product.id);
          const selectableProductIds = productIds.filter((productId) => !menuProductIds.has(productId));
          const allSelected = selectableProductIds.length > 0 && selectableProductIds.every((productId) => selectedProductIds.includes(productId));
          const expanded = expandedCategoryIds.has(group.id);

          return (
            <section className="app-panel rounded-[28px] overflow-hidden" key={group.id}>
              <div className={`flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between ${expanded ? "border-b border-[rgba(118,93,71,0.12)]" : ""}`}>
                <button
                  aria-expanded={expanded}
                  className="group/category flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                  onClick={() => toggleCategoryExpansion(group.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Category" : "Categoria"}</span>
                    <span className="app-display mt-2 flex min-w-0 items-center gap-3 truncate text-[2.3rem] leading-none text-[var(--text-strong)] sm:text-[3rem]">
                      <span aria-hidden="true" className="text-[1.8rem] sm:text-[2.25rem]">{categoryEmoji}</span>
                      <span className="truncate">{group.label}</span>
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-[var(--text-soft)]">{group.items.length} {locale === "en" ? "products" : "productos"}</span>
                  </span>
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] transition group-hover/category:bg-[rgba(223,210,194,0.55)] ${expanded ? "rotate-180 bg-[rgba(223,210,194,0.42)]" : ""}`}>
                    <ChevronDown size={20} />
                  </span>
                </button>
                <CategoryEmojiPicker
                  category={category}
                  fallbackEmoji={categoryEmoji}
                  onChange={(emoji) => {
                    if (category) void onUpdateCategoryEmoji(category.id, emoji);
                  }}
                />
                <button
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(223,210,194,0.55)] disabled:opacity-60"
                  onClick={() => toggleCategorySelection(productIds)}
                  disabled={selectableProductIds.length === 0}
                  type="button"
                >
                  {allSelected ? (locale === "en" ? "Clear selection" : "Quitar seleccion") : (locale === "en" ? "Select category" : "Seleccionar categoria")}
                </button>
              </div>

              {expanded && (viewMode === "cards" ? (
                <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.items.map((product) => (
                    <ProductCard
                      categoryOptions={categoryOptions}
                      inMenu={menuProductIds.has(product.id)}
                      isCategorySaving={Boolean(categorySavingByProductId[product.id])}
                      isSelected={selectedProductIds.includes(product.id)}
                      key={product.id}
                      onCategoryChange={(nextCategory) => void updateProductCategory(product, nextCategory)}
                      product={product}
                      onDelete={() => onDelete(product.id)}
                      onEdit={() => setModalProduct(product)}
                      onToggleSelect={() => toggleProductSelection(product.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3 p-4">
                  {group.items.map((product) => (
                    <ProductListRow
                      categoryOptions={categoryOptions}
                      inMenu={menuProductIds.has(product.id)}
                      isCategorySaving={Boolean(categorySavingByProductId[product.id])}
                      isSelected={selectedProductIds.includes(product.id)}
                      key={product.id}
                      onCategoryChange={(nextCategory) => void updateProductCategory(product, nextCategory)}
                      product={product}
                      onDelete={() => onDelete(product.id)}
                      onEdit={() => setModalProduct(product)}
                      onToggleSelect={() => toggleProductSelection(product.id)}
                    />
                  ))}
                </div>
              ))}
            </section>
          );
        })}
      </div>

      {products.length === 0 && (
        <div className="app-panel rounded-[28px] px-6 py-14 text-center">
          <p className="app-display text-[2rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "No products yet" : "Sin productos"}</p>
        </div>
      )}

      {modalProduct && (
        <ProductModal
          imageColumnReady={imageColumnReady}
          categoryOptions={categoryOptions}
          initialProduct={modalProduct}
          onClose={() => setModalProduct(null)}
          onSave={async (product) => {
            await onSave(product);
            setModalProduct(null);
          }}
        />
      )}
    </section>
  );
}

function ProductCard({
  categoryOptions,
  inMenu,
  isCategorySaving,
  isSelected,
  onCategoryChange,
  product,
  onDelete,
  onEdit,
  onToggleSelect,
}: {
  categoryOptions: string[];
  inMenu: boolean;
  isCategorySaving: boolean;
  isSelected: boolean;
  onCategoryChange: (nextCategory: string) => void;
  product: Product;
  onDelete: () => void;
  onEdit: () => void;
  onToggleSelect: () => void;
}) {
  const locale = activeDashboardLocale;
  return (
    <article className={`group overflow-hidden rounded-[28px] border transition ${isSelected ? "border-[rgba(197,123,87,0.28)] bg-[rgba(228,215,198,0.92)]" : "app-panel"}`}>
      <div className="relative aspect-[4/2.45] overflow-hidden bg-[rgba(118,93,71,0.08)]">
        {product.imageUrl ? (
          <img alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" src={product.imageUrl} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.38),transparent_58%),linear-gradient(135deg,rgba(223,231,240,0.96),rgba(216,228,241,0.86))]">
            <span
              aria-label={`Emoji sugerido para ${product.name}`}
              className="text-[4.4rem] drop-shadow-[0_14px_28px_rgba(20,14,10,0.16)]"
              role="img"
            >
              {product.emoji || inferProductEmoji(product)}
            </span>
          </div>
        )}
        <button
          className={`absolute right-4 top-4 inline-flex h-10 items-center justify-center rounded-2xl px-3 text-sm font-semibold transition ${inMenu ? "cursor-not-allowed bg-[rgba(98,84,72,0.82)] text-[rgba(246,236,223,0.78)]" : isSelected ? "bg-[var(--text-strong)] text-white" : "bg-[rgba(229,215,197,0.9)] text-[var(--text-strong)]"}`}
          disabled={inMenu}
          onClick={onToggleSelect}
          type="button"
        >
          {inMenu ? (locale === "en" ? "Already on menu" : "Ya en menu") : isSelected ? (locale === "en" ? "Selected" : "Seleccionado") : (locale === "en" ? "Select" : "Seleccionar")}
        </button>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(22,18,16,0.7)] via-transparent to-transparent p-5">
          <span className="inline-flex rounded-full bg-[rgba(255,250,244,0.16)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90 backdrop-blur">
            {getLocalizedCategoryLabel(product.category, locale)}
          </span>
        </div>
      </div>
      <div className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--text-strong)]">{product.name}</h3>
            {product.productType === "composite" ? (
              <span className="mt-2 inline-flex rounded-full bg-[rgba(197,123,87,0.12)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
                {locale === "en" ? "Composite product" : "Producto compuesto"} · {product.options?.length ?? 0} {locale === "en" ? "groups" : "grupos"}
              </span>
            ) : null}
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--text-soft)]">{product.description}</p>
          </div>
          <p className="shrink-0 text-sm font-semibold text-[var(--text-strong)]">{formatPrice(product.basePrice)}</p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <CategorySelect
            options={categoryOptions}
            disabled={isCategorySaving}
            onChange={onCategoryChange}
            value={product.category}
          />
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(223,210,194,0.55)] sm:w-auto"
            onClick={onEdit}
            type="button"
          >
            <Edit3 size={16} />
            {locale === "en" ? "Edit" : "Editar"}
          </button>
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(180,94,84,0.18)] px-4 text-sm font-semibold text-[#8c4e47] transition hover:bg-[rgba(190,110,95,0.08)] sm:w-auto"
            onClick={onDelete}
            type="button"
          >
            <Trash2 size={16} />
            {locale === "en" ? "Delete" : "Eliminar"}
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductListRow({
  categoryOptions,
  inMenu,
  isCategorySaving,
  isSelected,
  onCategoryChange,
  product,
  onDelete,
  onEdit,
  onToggleSelect,
}: {
  categoryOptions: string[];
  inMenu: boolean;
  isCategorySaving: boolean;
  isSelected: boolean;
  onCategoryChange: (nextCategory: string) => void;
  product: Product;
  onDelete: () => void;
  onEdit: () => void;
  onToggleSelect: () => void;
}) {
  const locale = activeDashboardLocale;
  return (
    <article className={`rounded-[24px] border px-4 py-4 transition ${isSelected ? "border-[rgba(197,123,87,0.28)] bg-[rgba(228,215,198,0.92)]" : "border-[rgba(118,93,71,0.1)] bg-[rgba(226,214,198,0.82)]"}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex items-start gap-4">
          <ProductImage
            description={product.description}
            emoji={product.emoji}
            imageUrl={product.imageUrl}
            name={product.name}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[var(--text-strong)]">{product.name}</h3>
              <span className="rounded-full bg-[rgba(118,93,71,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {getLocalizedCategoryLabel(product.category, locale)}
              </span>
              {product.productType === "composite" ? (
                <span className="rounded-full bg-[rgba(197,123,87,0.12)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--warning)]">
                  {locale === "en" ? "Composite" : "Compuesto"} · {product.options?.length ?? 0} {locale === "en" ? "groups" : "grupos"}
                </span>
              ) : null}
            </div>
            {product.description ? (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-soft)]">{product.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <p className="mr-0 text-sm font-semibold text-[var(--text-strong)] sm:mr-2">{formatPrice(product.basePrice)}</p>
          <button
            className={`inline-flex h-11 w-full items-center justify-center rounded-2xl px-4 text-sm font-semibold transition sm:w-auto ${inMenu ? "cursor-not-allowed border border-[rgba(118,93,71,0.1)] bg-[rgba(98,84,72,0.12)] text-[var(--text-faint)]" : isSelected ? "bg-[var(--text-strong)] text-white" : "border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] hover:bg-[rgba(223,210,194,0.55)]"}`}
            disabled={inMenu}
            onClick={onToggleSelect}
            type="button"
          >
            {inMenu ? (locale === "en" ? "Already on menu" : "Ya en menu") : isSelected ? (locale === "en" ? "Selected" : "Seleccionado") : (locale === "en" ? "Select" : "Seleccionar")}
          </button>
          <CategorySelect
            options={categoryOptions}
            disabled={isCategorySaving}
            onChange={onCategoryChange}
            value={product.category}
          />
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(223,210,194,0.55)] sm:w-auto"
            onClick={onEdit}
            type="button"
          >
            <Edit3 size={16} />
            {locale === "en" ? "Edit" : "Editar"}
          </button>
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(180,94,84,0.18)] px-4 text-sm font-semibold text-[#8c4e47] transition hover:bg-[rgba(190,110,95,0.08)] sm:w-auto"
            onClick={onDelete}
            type="button"
          >
            <Trash2 size={16} />
            {locale === "en" ? "Delete" : "Eliminar"}
          </button>
        </div>
      </div>
    </article>
  );
}

function CategorySelect({
  disabled,
  onChange,
  options = defaultCategoryOptions,
  value,
}: {
  disabled: boolean;
  onChange: (nextCategory: string) => void;
  options?: string[];
  value?: string;
}) {
  const locale = activeDashboardLocale;
  const listId = useId();
  const [draftValue, setDraftValue] = useState(value ?? "");
  const categoryOptions = Array.from(new Set([normalizeCategoryLabel(value, ""), ...options].filter(Boolean)));

  useEffect(() => {
    setDraftValue(value ?? "");
  }, [value]);

  function commitCategory(nextValue = draftValue) {
    const normalized = normalizeCategoryLabel(nextValue);
    setDraftValue(normalized);
    if (normalized !== value) onChange(normalized);
  }

  return (
    <>
    <input
      className="h-11 w-full min-w-0 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(223,210,194,0.45)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[rgba(118,93,71,0.24)] focus:ring-4 focus:ring-[rgba(197,123,87,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      list={listId}
      onBlur={(event) => commitCategory(event.target.value)}
      onChange={(event) => setDraftValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitCategory();
        }
      }}
      placeholder={locale === "en" ? "Type or choose category" : "Escribe o elige categoria"}
      value={draftValue}
    />
    <datalist id={listId}>
      {categoryOptions.map((option) => (
        <option key={option} value={option} />
      ))}
    </datalist>
    </>
  );
}

function CategoryEmojiPicker({
  category,
  fallbackEmoji,
  onChange,
}: {
  category?: ProductCategory;
  fallbackEmoji: string;
  onChange: (emoji: string) => void;
}) {
  const locale = activeDashboardLocale;
  const selectedEmoji = category?.emoji || fallbackEmoji;
  const [customEmoji, setCustomEmoji] = useState(selectedEmoji);

  useEffect(() => {
    setCustomEmoji(selectedEmoji);
  }, [selectedEmoji]);

  function commitCustomEmoji(value = customEmoji) {
    const emoji = value.trim().slice(0, 16);
    if (emoji) onChange(emoji);
  }

  return (
    <details className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <summary
        aria-label={locale === "en" ? "Edit category emoji" : "Editar emoji de categoría"}
        className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(223,210,194,0.35)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(223,210,194,0.6)]"
      >
        <span aria-hidden="true" className="text-lg">{selectedEmoji}</span>
        <span className="hidden sm:inline">{locale === "en" ? "Emoji" : "Emoji"}</span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-[min(22rem,calc(100vw-3rem))] rounded-[22px] border border-[rgba(118,93,71,0.14)] bg-[var(--surface-base)] p-3 shadow-[0_18px_42px_rgba(20,14,10,0.2)]">
        <p className="text-xs leading-5 text-[var(--text-soft)]">
          {category
            ? (locale === "en" ? "Choose an icon for this category." : "Elige el icono de esta categoría.")
            : (locale === "en" ? "Save a product in this category first." : "Primero guarda un producto de esta categoría.")}
        </p>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {categoryEmojiQuickOptions.map((emoji) => (
            <button
              aria-label={locale === "en" ? `Use ${emoji}` : `Usar ${emoji}`}
              className={`grid h-9 place-items-center rounded-xl text-xl transition ${selectedEmoji === emoji ? "bg-[var(--text-strong)]" : "bg-[var(--panel-strong)] hover:bg-white"}`}
              disabled={!category}
              key={emoji}
              onClick={() => {
                setCustomEmoji(emoji);
                onChange(emoji);
              }}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">{locale === "en" ? "Custom emoji" : "Emoji personalizado"}</span>
          <input
            className="h-10 w-full rounded-xl border border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] px-3 text-center text-lg outline-none focus:border-[rgba(197,123,87,0.4)]"
            disabled={!category}
            maxLength={16}
            onBlur={(event) => commitCustomEmoji(event.target.value)}
            onChange={(event) => setCustomEmoji(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitCustomEmoji();
              }
            }}
            value={customEmoji}
          />
        </label>
      </div>
    </details>
  );
}

function EmojiSelect({
  description,
  name,
  onChange,
  value,
}: {
  description?: string;
  name: string;
  onChange: (emoji: string) => void;
  value?: string;
}) {
  const locale = activeDashboardLocale;
  const suggestedEmoji = inferProductEmoji({ description, name });
  const selectedEmoji = value || suggestedEmoji;
  const quickOptions = Array.from(new Set([selectedEmoji, suggestedEmoji, ...foodEmojiPalette])).slice(0, 96);
  const extendedOptions = Array.from(new Set([...quickOptions, ...availableProductEmojis])).slice(0, 720);

  return (
    <div className="rounded-[22px] border border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Emoji</p>
          <p className="mt-1 text-xs text-[var(--text-soft)]">{locale === "en" ? "Suggested from name and description" : "Sugerido por nombre y descripcion"}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--panel-strong)] text-[1.5rem] ring-1 ring-[rgba(118,93,71,0.1)]">
          {selectedEmoji}
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(14,minmax(0,1fr))]">
        {quickOptions.map((emoji) => (
          <button
            aria-label={locale === "en" ? `Select emoji ${emoji}` : `Seleccionar emoji ${emoji}`}
            className={`grid h-9 w-9 place-items-center rounded-xl text-[1.25rem] transition ${
              selectedEmoji === emoji
                ? "bg-[var(--text-strong)] shadow-[0_8px_20px_rgba(20,14,10,0.18)]"
                : "bg-[var(--panel-strong)] hover:bg-white"
            }`}
            key={emoji}
            onClick={() => onChange(emoji)}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>
      <details className="mt-3 rounded-[18px] border border-[rgba(118,93,71,0.1)] bg-[var(--panel-strong)] p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          {locale === "en" ? `Expanded collection · ${extendedOptions.length} emojis` : `Coleccion ampliada · ${extendedOptions.length} emojis`}
        </summary>
        <div className="mt-3 grid max-h-80 grid-cols-8 gap-1.5 overflow-y-auto pr-1 app-scrollbar sm:grid-cols-10 lg:grid-cols-[repeat(14,minmax(0,1fr))]">
          {extendedOptions.map((emoji) => (
            <button
              aria-label={locale === "en" ? `Select emoji ${emoji}` : `Seleccionar emoji ${emoji}`}
              className={`grid h-9 w-9 place-items-center rounded-xl text-[1.25rem] transition ${
                selectedEmoji === emoji
                  ? "bg-[var(--text-strong)] shadow-[0_8px_20px_rgba(20,14,10,0.18)]"
                  : "bg-[var(--surface-base)] hover:bg-white"
              }`}
              key={`extended-${emoji}`}
              onClick={() => onChange(emoji)}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function ProductTypeSelector({ onChange, value }: { onChange: (value: Product["productType"]) => void; value: Product["productType"] }) {
  const locale = activeDashboardLocale;
  const options = [
    {
      id: "simple" as const,
      title: locale === "en" ? "Simple product" : "Producto simple",
      copy: locale === "en" ? "Fixed dish. The customer orders it as-is." : "Plato fijo. El cliente lo pide tal como esta.",
    },
    {
      id: "composite" as const,
      title: locale === "en" ? "Composite product" : "Producto compuesto",
      copy: locale === "en" ? "Dish with component groups the customer must choose in WhatsApp." : "Plato con grupos de componentes que el cliente debe elegir por WhatsApp.",
    },
  ];

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Product type" : "Tipo de producto"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              className={`rounded-[22px] border px-4 py-4 text-left transition ${
                active
                  ? "border-[rgba(197,123,87,0.28)] bg-[rgba(197,123,87,0.1)] text-[var(--text-strong)]"
                  : "border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
              }`}
              key={option.id}
              onClick={() => onChange(option.id)}
              type="button"
            >
              <p className="text-sm font-extrabold">{option.title}</p>
              <p className="mt-2 text-xs leading-5">{option.copy}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompositeOptionsEditor({ onChange, options }: { onChange: (options: ProductOption[]) => void; options: ProductOption[] }) {
  const locale = activeDashboardLocale;
  function updateOption(index: number, patch: Partial<ProductOption>) {
    onChange(options.map((option, optionIndex) => (optionIndex === index ? { ...option, ...patch } : option)));
  }

  function updateValue(optionIndex: number, valueIndex: number, patch: Partial<ProductOption["values"][number]>) {
    onChange(options.map((option, currentOptionIndex) => {
      if (currentOptionIndex !== optionIndex) return option;
      return {
        ...option,
        values: option.values.map((value, currentValueIndex) => (
          currentValueIndex === valueIndex ? { ...value, ...patch } : value
        )),
      };
    }));
  }

  function addValue(optionIndex: number) {
    onChange(options.map((option, currentOptionIndex) => {
      if (currentOptionIndex !== optionIndex) return option;
      const nextSortOrder = option.values.reduce((max, value) => Math.max(max, value.sortOrder), -10) + 10;
      return {
        ...option,
        values: [
          ...option.values,
          { name: "", priceDelta: 0, isActive: true, sortOrder: nextSortOrder },
        ],
      };
    }));
  }

  function removeValue(optionIndex: number, valueIndex: number) {
    onChange(options.map((option, currentOptionIndex) => {
      if (currentOptionIndex !== optionIndex) return option;
      return {
        ...option,
        values: option.values.filter((_, currentValueIndex) => currentValueIndex !== valueIndex),
      };
    }));
  }

  return (
    <section className="rounded-[26px] border border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Dish components" : "Componentes del plato"}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
            {locale === "en"
              ? "Create groups like Soup, Carb or Salad. WhatsApp asks the customer about required groups with multiple active options; if only one active option remains, it is included automatically."
              : "Crea grupos como Sopa, Carbohidrato o Ensalada. WhatsApp le preguntara al cliente los grupos requeridos que tengan varias opciones activas; si solo queda una opcion activa, se incluye automaticamente."}
          </p>
        </div>
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923]"
          onClick={() => onChange([...options, createEmptyCompositeOption(options.length * 10)])}
          type="button"
        >
          <Plus size={16} />
          {locale === "en" ? "Add group" : "Agregar grupo"}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {options.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-[rgba(118,93,71,0.22)] px-4 py-8 text-center text-sm leading-6 text-[var(--text-soft)]">
            {locale === "en"
              ? "Add at least one choice group so the customer can configure this dish."
              : "Agrega al menos un grupo de eleccion para que el cliente pueda configurar este plato."}
          </div>
        ) : null}

        {options.map((option, optionIndex) => (
          <article className="rounded-[24px] border border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] p-4" key={`option-${option.sortOrder}-${optionIndex}`}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto]">
              <TextInput
                label={locale === "en" ? "Group" : "Grupo"}
                onChange={(value) => updateOption(optionIndex, { name: value })}
                placeholder={locale === "en" ? "Ex. Soups" : "Ej. Sopas"}
                value={option.name}
              />
              <TextInput
                label="Min"
                onChange={(value) => updateOption(optionIndex, { minSelect: Number(value), isRequired: Number(value) > 0 })}
                placeholder="1"
                type="number"
                value={String(option.minSelect)}
              />
              <TextInput
                label="Max"
                onChange={(value) => updateOption(optionIndex, { maxSelect: Number(value) })}
                placeholder="1"
                type="number"
                value={String(option.maxSelect)}
              />
              <button
                className="self-end inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(180,94,84,0.18)] px-3 text-sm font-semibold text-[#8c4e47] transition hover:bg-[rgba(190,110,95,0.08)]"
                onClick={() => onChange(options.filter((_, currentIndex) => currentIndex !== optionIndex))}
                type="button"
              >
                {locale === "en" ? "Remove" : "Quitar"}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {option.values.map((value, valueIndex) => (
                <div className="rounded-[18px] bg-[var(--surface-base)] p-3" key={`value-${value.sortOrder}-${valueIndex}`}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <input
                      className="h-11 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
                      onChange={(event) => updateValue(optionIndex, valueIndex, { name: event.target.value, priceDelta: 0 })}
                      placeholder={locale === "en" ? "Ex. Lentil soup" : "Ej. Sopa de lentejas"}
                      value={value.name}
                    />
                    <label className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-soft)]">
                      <input
                        checked={value.isActive}
                        onChange={(event) => updateValue(optionIndex, valueIndex, { isActive: event.target.checked })}
                        type="checkbox"
                      />
                      {locale === "en" ? "Active" : "Activo"}
                    </label>
                    <details className="group">
                      <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--panel-strong)]">
                        {locale === "en" ? "Specifications" : "Especificaciones"}
                      </summary>
                      <div className="mt-2 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] p-3">
                        <textarea
                          className="min-h-20 w-full resize-none rounded-2xl border border-[rgba(118,93,71,0.12)] bg-white/70 px-3 py-2 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
                          onChange={(event) => updateValue(optionIndex, valueIndex, { description: event.target.value })}
                          placeholder={locale === "en" ? "Ex. In plum sauce" : "Ej. En salsa de ciruela"}
                          value={value.description ?? ""}
                        />
                      </div>
                    </details>
                    <button
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(180,94,84,0.18)] px-3 text-sm font-semibold text-[#8c4e47]"
                      onClick={() => removeValue(optionIndex, valueIndex)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-muted)]"
              onClick={() => addValue(optionIndex)}
              type="button"
            >
              <Plus size={15} />
              {locale === "en" ? "Add option" : "Agregar opcion"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProductModal({
  categoryOptions,
  imageColumnReady,
  initialProduct,
  onClose,
  onSave,
}: {
  categoryOptions: string[];
  imageColumnReady: boolean;
  initialProduct: Partial<Product>;
  onClose: () => void;
  onSave: (product: ProductFormValue) => Promise<void>;
}) {
  const [form, setForm] = useState<ProductFormValue>(() => {
    const productType = initialProduct.productType ?? "simple";
    return {
      ...initialProduct,
      productType,
      category: initialProduct.category ?? categoryOptions[0] ?? "General",
      isActive: initialProduct.isActive ?? true,
      options: productType === "composite" && (!initialProduct.options || initialProduct.options.length === 0)
        ? createDefaultCompositeOptions()
        : initialProduct.options,
    };
  });
  const [previewUrl, setPreviewUrl] = useState(initialProduct.imageUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const locale = activeDashboardLocale;
  const productType = form.productType ?? "simple";
  const modalTitle = form.id
    ? (locale === "en" ? "Edit product" : "Editar producto")
    : productType === "composite"
      ? (locale === "en" ? "New composite product" : "Nuevo producto compuesto")
      : (locale === "en" ? "New product" : "Nuevo producto");

  return (
    <Modal title={modalTitle} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setIsSaving(true);
          try {
            await onSave({
              ...form,
              basePrice: Number(form.basePrice ?? 0),
              emoji: form.emoji || inferProductEmoji({
                name: form.name ?? "Producto",
                description: form.description,
              }),
              options: form.productType === "composite" ? normalizeProductOptions(form.options) : [],
              productType: form.productType ?? "simple",
              isActive: form.isActive ?? true,
            });
          } finally {
            setIsSaving(false);
          }
        }}
      >
        <TextInput label={locale === "en" ? "Name" : "Nombre"} onChange={(value) => setForm({ ...form, name: value })} placeholder={locale === "en" ? "Ex. Executive lunch" : "Ej. Almuerzo ejecutivo"} value={form.name ?? ""} />
        <TextInput label={locale === "en" ? "Base price" : "Precio base"} onChange={(value) => setForm({ ...form, basePrice: Number(value) })} placeholder="22000" type="number" value={String(form.basePrice ?? "")} />
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Category" : "Categoria"}</span>
          <CategorySelect
            options={categoryOptions}
            disabled={false}
            onChange={(category) => setForm({ ...form, category })}
            value={form.category}
          />
        </label>
        <ProductTypeSelector
          onChange={(productType) => setForm({
            ...form,
            productType,
            options: productType === "composite" && (!form.options || form.options.length === 0)
              ? createDefaultCompositeOptions()
              : form.options,
          })}
          value={productType}
        />
        <EmojiSelect
          description={form.description}
          name={form.name ?? "Producto"}
          onChange={(emoji) => setForm({ ...form, emoji })}
          value={form.emoji}
        />
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Image" : "Imagen"}</span>
          <div className="rounded-[22px] border border-dashed border-[rgba(118,93,71,0.18)] bg-[rgba(248,241,232,0.72)] p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="shrink-0">
                <ProductImage
                  description={form.description}
                  emoji={form.emoji}
                  imageUrl={previewUrl}
                  large
                  name={form.name ?? "Producto"}
                />
              </div>
              <div className="min-w-0 flex-1">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full text-sm text-[var(--text-soft)] file:mr-3 file:rounded-2xl file:border-0 file:bg-[var(--text-strong)] file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!imageColumnReady}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setForm({ ...form, imageFile: file, imageUrl: undefined });
                    setPreviewUrl(URL.createObjectURL(file));
                  }}
                  type="file"
                />
                <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">
                  {imageColumnReady
                    ? (locale === "en" ? "Upload JPG, PNG or WebP. The image is stored in the product-images bucket." : "Sube JPG, PNG o WebP. La imagen se guarda en el bucket product-images.")
                    : (locale === "en" ? "Image upload is disabled: the products.image_url migration is still missing. The product can still be saved." : "Imagen desactivada: falta aplicar la migracion products.image_url. El producto igual se puede guardar.")}
                </p>
              </div>
            </div>
          </div>
        </label>
        <TextInput label={locale === "en" ? "Description" : "Descripcion"} onChange={(value) => setForm({ ...form, description: value })} placeholder={locale === "en" ? "Short WhatsApp description" : "Descripcion corta para WhatsApp"} value={form.description ?? ""} />
        {productType === "composite" && (
          <CompositeOptionsEditor
            options={form.options ?? []}
            onChange={(options) => setForm({ ...form, options })}
          />
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(248,241,232,0.6)]"
            onClick={onClose}
            type="button"
          >
            {locale === "en" ? "Cancel" : "Cancelar"}
          </button>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSaving}
            type="submit"
          >
            {isSaving && <Loader2 className="animate-spin" size={16} />}
            {isSaving ? (locale === "en" ? "Saving" : "Guardando") : (locale === "en" ? "Save product" : "Guardar producto")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfigRequiredScreen({ locale }: { locale: "en" | "es" }) {
  return (
    <StandaloneFrame
      eyebrow={locale === "en" ? "Configuration required" : "Configuracion requerida"}
      title={locale === "en" ? "Enable Supabase Auth to enter the dashboard" : "Activa Supabase Auth para entrar al dashboard"}
      description={locale === "en"
        ? "Before using the interface, define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login."
        : "Antes de usar la interfaz, define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para habilitar el login."}
    />
  );
}

function LoadingScreen({ locale }: { locale: "en" | "es" }) {
  return (
    <CenteredStatus
      title={locale === "en" ? "Loading session" : "Cargando sesion"}
      description={locale === "en"
        ? "We are restoring the operator session and preparing the dashboard shell."
        : "Estamos recuperando la sesion del operador y preparando la shell del dashboard."}
    />
  );
}

function TenantLoadingScreen({ locale }: { locale: "en" | "es" }) {
  return (
    <CenteredStatus
      title={locale === "en" ? "Resolving restaurant" : "Resolviendo empresa"}
      description={locale === "en"
        ? "We are validating the user and loading assigned tenants before opening operations."
        : "Validamos el usuario y buscamos los tenants asignados antes de cargar la operacion."}
    />
  );
}

function TenantErrorScreen({ error, locale, onLogout }: { error: string; locale: "en" | "es"; onLogout: () => Promise<void> }) {
  return (
    <StandaloneFrame
      actions={(
        <button
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--panel)] px-5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)]"
          onClick={() => void onLogout()}
          type="button"
        >
          {locale === "en" ? "Log out" : "Salir"}
        </button>
      )}
      eyebrow={locale === "en" ? "Restaurant could not be loaded" : "No se pudo cargar la empresa"}
      title={locale === "en" ? "The user exists, but the tenant could not be resolved" : "El usuario existe, pero el tenant no pudo resolverse"}
      description={locale === "en"
        ? "The session is active, but the dashboard could not resolve permissions or visible tenants from the backend."
        : "La sesion esta activa, pero el dashboard no logro consultar el backend para resolver permisos o tenants visibles."}
    >
      <div className="rounded-[22px] border border-[rgba(180,94,84,0.18)] bg-[rgba(190,110,95,0.08)] px-4 py-4 text-sm leading-6 text-[#f4d6cf]">
        {error}
      </div>
    </StandaloneFrame>
  );
}

function LoginScreen({
  error,
  locale,
  onChangeLocale,
  onLogin,
}: {
  error: string;
  locale: "en" | "es";
  onChangeLocale: (locale: "en" | "es") => void;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="grid min-h-screen place-items-center bg-[linear-gradient(180deg,#221d18_0%,#181512_100%)] px-3 py-4 sm:px-6 sm:py-8">
      <div className="relative grid w-full max-w-[1380px] overflow-hidden rounded-[36px] border border-[rgba(255,250,244,0.16)] bg-[#17120f] shadow-[0_32px_100px_rgba(0,0,0,0.34)] lg:min-h-[820px] lg:grid-cols-[minmax(0,1fr)_520px]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(10,8,6,0.08) 0%, rgba(10,8,6,0.08) 54%, rgba(10,8,6,0.52) 72%, rgba(10,8,6,0.88) 100%), url('/login-hero.png')",
            backgroundPosition: "left center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
          }}
        />
        <div className="absolute inset-y-0 right-0 hidden w-[46%] bg-[linear-gradient(90deg,rgba(14,11,9,0.12)_0%,rgba(14,11,9,0.34)_18%,rgba(14,11,9,0.7)_46%,rgba(14,11,9,0.9)_100%)] lg:block" />
        <div className="absolute inset-y-0 right-0 hidden w-[44%] backdrop-blur-[12px] lg:block" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(255,209,146,0.14),transparent_24%),radial-gradient(circle_at_68%_18%,rgba(255,236,216,0.08),transparent_18%),linear-gradient(180deg,rgba(8,7,6,0.02),rgba(8,7,6,0.18))]" />
        <div className="absolute right-4 top-4 z-20">
          <LanguageToggle locale={locale} onChange={onChangeLocale} />
        </div>
        <div className="relative hidden lg:block" />
        <form
          className="relative z-10 flex min-h-[100svh] items-center justify-center p-4 sm:p-6 lg:min-h-[820px] lg:justify-start lg:px-12 xl:px-16"
          onSubmit={async (event) => {
            event.preventDefault();
            setIsSubmitting(true);
            try {
              await onLogin(email, password);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="w-full max-w-[432px] rounded-[30px] border border-[rgba(255,255,255,0.14)] bg-[rgba(18,14,11,0.38)] p-6 text-[var(--text-on-dark)] shadow-[0_28px_70px_rgba(0,0,0,0.3)] backdrop-blur-[20px] sm:rounded-[34px] sm:p-9 lg:-translate-x-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgba(246,236,223,0.52)]">42day dashboard</p>
            <h1 className="app-display mt-5 text-[2.7rem] leading-none text-[var(--text-on-dark)] sm:text-[3.8rem]">{locale === "en" ? "Log in" : "Iniciar sesion"}</h1>
            <p className="mt-4 max-w-[28rem] text-[15px] leading-7 text-[rgba(246,236,223,0.72)]">
              {locale === "en" ? "Operational access for restaurants and administration." : "Acceso operativo para restaurantes y administracion."}
            </p>
            <div className="mt-9 space-y-5">
              <TextInput
                hidePasswordLabel={locale === "en" ? "Hide password" : "Ocultar contrasena"}
                label={locale === "en" ? "Email" : "Correo"}
                onChange={setEmail}
                placeholder="empresa@correo.com"
                showPasswordLabel={locale === "en" ? "Show password" : "Mostrar contrasena"}
                value={email}
              />
              <TextInput
                hidePasswordLabel={locale === "en" ? "Hide password" : "Ocultar contrasena"}
                label={locale === "en" ? "Password" : "Contrasena"}
                onChange={setPassword}
                placeholder="********"
                showPasswordLabel={locale === "en" ? "Show password" : "Mostrar contrasena"}
                type="password"
                value={password}
              />
            </div>
            {error && <p className="mt-4 text-sm font-medium text-[#9a4b43]">{error}</p>}
            <button
              className="mt-7 inline-flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[var(--success)] px-4 text-base font-semibold text-white transition hover:bg-[#456c56] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting && <Loader2 className="animate-spin" size={16} />}
              {isSubmitting ? (locale === "en" ? "Signing in" : "Entrando") : (locale === "en" ? "Sign in" : "Iniciar sesion")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NoTenantScreen({ locale, onLogout }: { locale: "en" | "es"; onLogout: () => Promise<void> }) {
  return (
    <StandaloneFrame
      actions={(
        <button
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--panel)] px-5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)]"
          onClick={() => void onLogout()}
          type="button"
        >
          {locale === "en" ? "Log out" : "Salir"}
        </button>
      )}
      eyebrow={locale === "en" ? "User without tenant" : "Usuario sin tenant"}
      title={locale === "en" ? "This account has no active tenant relationship" : "La cuenta no tiene relacion activa con ningun tenant"}
      description={locale === "en"
        ? "The user exists in Supabase Auth, but still has no active relation in control.tenant_users."
        : "El usuario existe en Supabase Auth, pero aun no tiene una relacion activa en control.tenant_users."}
    />
  );
}

type AdminRestaurantCreateForm = {
  name: string;
  slug: string;
  experienceMode: "connected" | "standalone";
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
  locationName: string;
  locationAddress: string;
  locationPhone: string;
  deliveryFeeFixed: string;
};

type AdminRestaurantEditForm = {
  name: string;
  status: AdminRestaurantStatus;
  timezone: string;
  currency: string;
  automationEnabled: boolean;
  locationName: string;
  locationAddress: string;
  locationPhone: string;
  deliveryFeeFixed: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  locationAutomationEnabled: boolean;
};

type AdminMemberForm = {
  email: string;
  name: string;
  role: AdminRestaurantMember["role"];
  password: string;
};

type AdminSection = "overview" | "settings" | "users" | "analytics";

const emptyAdminRestaurantCreateForm: AdminRestaurantCreateForm = {
  name: "",
  slug: "",
  experienceMode: "connected",
  ownerEmail: "",
  ownerName: "",
  ownerPassword: "",
  locationName: "Sede principal",
  locationAddress: "",
  locationPhone: "",
  deliveryFeeFixed: "0",
};

const emptyAdminMemberForm: AdminMemberForm = {
  email: "",
  name: "",
  role: "encargado",
  password: "",
};

function getAdminStatusCopy(locale: "en" | "es"): Record<AdminRestaurantStatus, { label: string; description: string; className: string }> {
  return {
    active: {
      label: locale === "en" ? "Active" : "Activo",
      description: locale === "en" ? "Operating normally and visible in public access points." : "Opera normalmente y aparece en accesos publicos.",
      className: "bg-[rgba(79,122,97,0.12)] text-[var(--success)]",
    },
    suspended: {
      label: locale === "en" ? "Paused" : "Pausado",
      description: locale === "en" ? "Access is preserved, but operations and automation are stopped." : "Acceso conservado, operacion y automatizacion detenidas.",
      className: "bg-[rgba(158,108,72,0.14)] text-[var(--warning)]",
    },
    inactive: {
      label: locale === "en" ? "Inactive" : "Inactivo",
      description: locale === "en" ? "Removed from daily operations without deleting historical data." : "Retirado de operacion diaria sin borrar datos historicos.",
      className: "bg-[rgba(118,93,71,0.1)] text-[var(--text-soft)]",
    },
  };
}

function buildAdminRestaurantEditForm(restaurant: AdminRestaurant): AdminRestaurantEditForm {
  return {
    name: restaurant.name,
    status: restaurant.status,
    timezone: restaurant.timezone,
    currency: restaurant.currency,
    automationEnabled: restaurant.automationEnabled,
    locationName: restaurant.location?.name ?? "Sede principal",
    locationAddress: restaurant.location?.address ?? "",
    locationPhone: restaurant.location?.phone ?? "",
    deliveryFeeFixed: String(restaurant.location?.deliveryFeeFixed ?? 0),
    pickupEnabled: restaurant.location?.pickupEnabled ?? true,
    deliveryEnabled: restaurant.location?.deliveryEnabled ?? true,
    locationAutomationEnabled: restaurant.location?.automationEnabled ?? true,
  };
}

function getAdminErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DashboardApiError) {
    if (error.backendError === "restaurant_owner_email_required") return "El correo del encargado es obligatorio.";
    if (error.backendError === "restaurant_provision_verification_failed") return "El restaurante se creo parcialmente, pero no quedo listo para operar. Revisa tenant, sede, menu inicial y usuario encargado.";
    if (error.backendError === "restaurant_provision_failed") return "No se pudo crear la estructura del restaurante.";
    return error.backendError ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function AdminOverviewScreen({ overview, onLogout }: { overview: AdminOverview; onLogout: () => Promise<void> }) {
  const { locale, setLocale } = useDashboardLocale();
  const adminStatusCopy = getAdminStatusCopy(locale);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [restaurantSearch, setRestaurantSearch] = useState("");
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [createForm, setCreateForm] = useState<AdminRestaurantCreateForm>(emptyAdminRestaurantCreateForm);
  const [editForm, setEditForm] = useState<AdminRestaurantEditForm | null>(null);
  const [memberForm, setMemberForm] = useState<AdminMemberForm>(emptyAdminMemberForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<{ label: string; password: string } | null>(null);

  const selectedRestaurant = useMemo(
    () => restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) ?? restaurants[0],
    [restaurants, selectedRestaurantId],
  );
  const activeRestaurantCount = restaurants.length > 0
    ? restaurants.filter((restaurant) => restaurant.status === "active").length
    : overview.activeRestaurantCount;
  const suspendedRestaurantCount = restaurants.filter((restaurant) => restaurant.status === "suspended").length;
  const inactiveRestaurantCount = restaurants.filter((restaurant) => restaurant.status === "inactive").length;
  const totalMemberCount = restaurants.reduce((sum, restaurant) => sum + restaurant.members.length, 0);
  const totalOrdersToday = restaurants.reduce((sum, restaurant) => sum + restaurant.metrics.ordersTodayCount, 0);
  const totalPendingOrders = restaurants.reduce((sum, restaurant) => sum + restaurant.metrics.pendingOrderCount, 0);
  const totalRevenueToday = restaurants.reduce((sum, restaurant) => sum + restaurant.metrics.revenueToday, 0);
  const filteredRestaurants = useMemo(() => {
    const query = restaurantSearch.trim().toLowerCase();
    if (!query) return restaurants;
    return restaurants.filter((restaurant) => (
      restaurant.name.toLowerCase().includes(query)
      || restaurant.slug.toLowerCase().includes(query)
      || restaurant.schemaName.toLowerCase().includes(query)
      || restaurant.members.some((member) => (
        (member.email ?? "").toLowerCase().includes(query)
        || (member.name ?? "").toLowerCase().includes(query)
      ))
    ));
  }, [restaurantSearch, restaurants]);

  useEffect(() => {
    let mounted = true;

    async function loadRestaurants() {
      setIsLoading(true);
      try {
        const payload = await listAdminRestaurants();
        if (!mounted) return;
        setRestaurants(payload.restaurants);
        setSelectedRestaurantId((current) => (
          current && payload.restaurants.some((restaurant) => restaurant.id === current)
            ? current
            : payload.restaurants[0]?.id ?? ""
        ));
        setError("");
      } catch (loadError) {
        if (!mounted) return;
        setError(getAdminErrorMessage(loadError, locale === "en" ? "Restaurants could not be loaded." : "No se pudieron cargar los restaurantes."));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadRestaurants();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedRestaurant) {
      setEditForm(buildAdminRestaurantEditForm(selectedRestaurant));
    }
  }, [selectedRestaurant]);

  async function reloadRestaurants(nextSelectedId?: string) {
    const payload = await listAdminRestaurants();
    setRestaurants(payload.restaurants);
    setSelectedRestaurantId((current) => {
      const preferred = nextSelectedId ?? current;
      if (preferred && payload.restaurants.some((restaurant) => restaurant.id === preferred)) return preferred;
      return payload.restaurants[0]?.id ?? "";
    });
    return payload.restaurants;
  }

  async function handleCreateRestaurant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.name.trim()) {
      setError(locale === "en" ? "Restaurant name is required." : "El nombre del restaurante es obligatorio.");
      return;
    }

    if (!createForm.ownerEmail.trim()) {
      setError(locale === "en" ? "Owner email is required." : "El correo del encargado es obligatorio.");
      return;
    }

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await createAdminRestaurant({
        name: createForm.name.trim(),
        slug: createForm.slug.trim() || undefined,
        automationEnabled: createForm.experienceMode === "connected",
        ownerEmail: createForm.ownerEmail.trim() || undefined,
        ownerName: createForm.ownerName.trim() || undefined,
        ownerPassword: createForm.ownerPassword || undefined,
        locationName: createForm.locationName.trim() || "Sede principal",
        locationAddress: createForm.locationAddress.trim() || undefined,
        locationPhone: createForm.locationPhone.trim() || undefined,
        deliveryFeeFixed: Number(createForm.deliveryFeeFixed || 0),
      });
      await reloadRestaurants(payload.restaurant.id);
      setCreateForm(emptyAdminRestaurantCreateForm);
      setNotice(locale === "en" ? `Restaurant created: ${payload.restaurant.name}` : `Restaurante creado: ${payload.restaurant.name}`);
      if (payload.temporaryPassword) {
        setPasswordNotice({
          label: payload.owner?.email ? `Owner ${payload.owner.email}` : (locale === "en" ? "Initial owner" : "Owner inicial"),
          password: payload.temporaryPassword,
        });
      }
    } catch (createError) {
      setError(getAdminErrorMessage(createError, locale === "en" ? "The restaurant could not be created." : "No se pudo crear el restaurante."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveRestaurant() {
    if (!selectedRestaurant || !editForm) return;

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await updateAdminRestaurant(selectedRestaurant.id, {
        name: editForm.name.trim(),
        status: editForm.status,
        timezone: editForm.timezone.trim() || "America/Bogota",
        currency: editForm.currency.trim() || "COP",
        automationEnabled: editForm.automationEnabled,
        locationName: editForm.locationName.trim() || "Sede principal",
        locationAddress: editForm.locationAddress.trim(),
        locationPhone: editForm.locationPhone.trim(),
        deliveryFeeFixed: Number(editForm.deliveryFeeFixed || 0),
        pickupEnabled: editForm.pickupEnabled,
        deliveryEnabled: editForm.deliveryEnabled,
        locationAutomationEnabled: editForm.locationAutomationEnabled,
      });
      if (payload.restaurant) {
        setRestaurants((current) => current.map((restaurant) => (
          restaurant.id === payload.restaurant?.id ? payload.restaurant : restaurant
        )));
      } else {
        await reloadRestaurants(selectedRestaurant.id);
      }
      setNotice(locale === "en" ? "Restaurant updated." : "Restaurante actualizado.");
    } catch (saveError) {
      setError(getAdminErrorMessage(saveError, locale === "en" ? "The restaurant could not be updated." : "No se pudo actualizar el restaurante."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRestaurantStatus(status: AdminRestaurantStatus) {
    if (!selectedRestaurant) return;
    setEditForm((current) => current ? { ...current, status, automationEnabled: status === "active" ? current.automationEnabled : false } : current);
    setIsSaving(true);
    setError("");
    try {
      const payload = await updateAdminRestaurant(selectedRestaurant.id, {
        status,
        automationEnabled: status === "active" ? selectedRestaurant.automationEnabled : false,
      });
      if (payload.restaurant) {
        setRestaurants((current) => current.map((restaurant) => (
          restaurant.id === payload.restaurant?.id ? payload.restaurant : restaurant
        )));
      } else {
        await reloadRestaurants(selectedRestaurant.id);
      }
      setNotice(status === "active" ? "Restaurante reactivado." : "Restaurante pausado.");
    } catch (statusError) {
      setError(getAdminErrorMessage(statusError, "No se pudo cambiar el estado del restaurante."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRestaurant() {
    if (!selectedRestaurant) return;
    const confirmed = window.confirm(`Esto inactiva ${selectedRestaurant.name}, sus usuarios y canales. Los datos historicos se conservan. Continuar?`);
    if (!confirmed) return;

    setIsSaving(true);
    setError("");
    try {
      await deleteAdminRestaurant(selectedRestaurant.id);
      await reloadRestaurants();
      setNotice("Restaurante inactivado.");
    } catch (deleteError) {
      setError(getAdminErrorMessage(deleteError, "No se pudo inactivar el restaurante."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRestaurant || !memberForm.email.trim()) return;

    setIsSaving(true);
    setError("");
    try {
      const payload = await createAdminRestaurantMember(selectedRestaurant.id, {
        email: memberForm.email.trim(),
        name: memberForm.name.trim() || undefined,
        role: memberForm.role,
        password: memberForm.password || undefined,
      });
      await reloadRestaurants(selectedRestaurant.id);
      setMemberForm(emptyAdminMemberForm);
      setPasswordNotice({
        label: payload.member.email ?? memberForm.email,
        password: payload.temporaryPassword,
      });
      setNotice("Miembro agregado al restaurante.");
    } catch (memberError) {
      setError(getAdminErrorMessage(memberError, "No se pudo agregar el miembro."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateMember(member: AdminRestaurantMember, patch: Partial<Pick<AdminRestaurantMember, "role" | "status" | "name">>) {
    if (!selectedRestaurant) return;
    setIsSaving(true);
    setError("");
    try {
      const payload = await updateAdminRestaurantMember(selectedRestaurant.id, member.userId, patch);
      if (payload.restaurant) {
        setRestaurants((current) => current.map((restaurant) => (
          restaurant.id === payload.restaurant?.id ? payload.restaurant : restaurant
        )));
      } else {
        await reloadRestaurants(selectedRestaurant.id);
      }
      setNotice("Usuario actualizado.");
    } catch (memberError) {
      setError(getAdminErrorMessage(memberError, "No se pudo actualizar el usuario."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveMember(member: AdminRestaurantMember) {
    if (!selectedRestaurant) return;
    const confirmed = window.confirm(`Quitar acceso a ${member.email ?? member.userId}?`);
    if (!confirmed) return;

    setIsSaving(true);
    setError("");
    try {
      await deleteAdminRestaurantMember(selectedRestaurant.id, member.userId);
      await reloadRestaurants(selectedRestaurant.id);
      setNotice("Usuario inactivado.");
    } catch (memberError) {
      setError(getAdminErrorMessage(memberError, "No se pudo inactivar el usuario."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetMemberPassword(member: AdminRestaurantMember) {
    if (!selectedRestaurant) return;
    const requestedPassword = window.prompt(
      `Nueva contrasena para ${member.email ?? member.userId}`,
      selectedRestaurant.defaultPassword,
    );
    if (requestedPassword === null) return;

    setIsSaving(true);
    setError("");
    try {
      const payload = await resetAdminRestaurantMemberPassword(
        selectedRestaurant.id,
        member.userId,
        requestedPassword.trim() || undefined,
      );
      setPasswordNotice({
        label: member.email ?? member.userId,
        password: payload.temporaryPassword,
      });
      setNotice("Contrasena restablecida.");
    } catch (passwordError) {
      setError(getAdminErrorMessage(passwordError, "No se pudo restablecer la contrasena."));
    } finally {
      setIsSaving(false);
    }
  }

  async function copyToClipboard(value: string) {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setNotice("Copiado al portapapeles.");
  }

  return (
    <div className="min-h-screen px-3 py-3 sm:px-4">
      <main className="mx-auto min-h-[calc(100vh-1.5rem)] w-full max-w-[1480px] rounded-[22px] border border-[var(--shell-border)] bg-[rgba(32,28,25,0.96)] p-3 text-[var(--text-on-dark)] shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:rounded-[26px] sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--shell-border)] pb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.48)]">{locale === "en" ? "42day admin" : "Administrador 42day"}</p>
            <h1 className="mt-2 text-2xl font-extrabold text-[var(--text-on-dark)] sm:text-3xl">{locale === "en" ? "Restaurant management" : "Gestion de restaurantes"}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[rgba(246,236,223,0.68)]">
              {locale === "en"
                ? "Central console for provisioning, users, operational status, metrics and configuration of each restaurant."
                : "Consola central para alta, usuarios, estado operativo, metricas y configuracion de cada restaurante."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageToggle locale={locale} onChange={setLocale} />
            <button
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.06)] px-4 text-sm font-semibold text-[rgba(246,236,223,0.82)] transition hover:bg-[rgba(255,248,240,0.12)] hover:text-[var(--text-on-dark)]"
              onClick={() => void onLogout()}
              type="button"
            >
              {locale === "en" ? "Log out" : "Salir"}
            </button>
          </div>
        </header>

        <section className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <AdminMetricCard icon={<Store size={18} />} label={locale === "en" ? "Active restaurants" : "Restaurantes activos"} value={String(activeRestaurantCount)} />
          <AdminMetricCard icon={<Power size={18} />} label={locale === "en" ? "Paused" : "Pausados"} value={String(suspendedRestaurantCount)} />
          <AdminMetricCard icon={<Users size={18} />} label={locale === "en" ? "Linked users" : "Usuarios vinculados"} value={String(totalMemberCount)} />
          <AdminMetricCard icon={<ClipboardList size={18} />} label={locale === "en" ? "Orders today" : "Pedidos hoy"} value={String(totalOrdersToday)} />
          <AdminMetricCard icon={<Bell size={18} />} label={locale === "en" ? "Pending today" : "Pendientes hoy"} value={String(totalPendingOrders)} />
          <AdminMetricCard icon={<Utensils size={18} />} label={locale === "en" ? "Revenue today" : "Ingresos hoy"} value={formatPrice(totalRevenueToday)} />
          <AdminMetricCard icon={<Trash2 size={18} />} label={locale === "en" ? "Inactive" : "Inactivos"} value={String(inactiveRestaurantCount)} />
        </section>

        {(error || notice || passwordNotice) && (
          <section className="mb-6 grid gap-3">
            {error && (
              <div className="rounded-[22px] border border-[rgba(180,94,84,0.2)] bg-[rgba(190,110,95,0.12)] px-4 py-3 text-sm font-semibold text-[#f3b7aa]">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-[22px] border border-[rgba(119,162,126,0.2)] bg-[rgba(79,122,97,0.13)] px-4 py-3 text-sm font-semibold text-[#cbe5d2]">
                {notice}
              </div>
            )}
            {passwordNotice && (
              <div className="rounded-[24px] border border-[rgba(255,242,227,0.12)] bg-[rgba(255,248,240,0.08)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.48)]">{locale === "en" ? "Temporary password" : "Contrasena temporal"}</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-on-dark)]">{passwordNotice.label}</p>
                    <p className="mt-1 rounded-2xl bg-[rgba(14,11,9,0.32)] px-3 py-2 font-mono text-sm text-[rgba(246,236,223,0.9)]">
                      {passwordNotice.password}
                    </p>
                  </div>
                  <button
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--panel)] px-4 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--panel-strong)]"
                    onClick={() => void copyToClipboard(passwordNotice.password)}
                    type="button"
                  >
                    <Copy size={16} />
                    {locale === "en" ? "Copy" : "Copiar"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="app-panel overflow-hidden rounded-[24px]">
            <div className="border-b border-[rgba(118,93,71,0.12)] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Restaurants" : "Restaurantes"}</p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--text-strong)]">{restaurants.length} {locale === "en" ? "clients" : "clientes"}</h2>
                </div>
                {isLoading && <Loader2 className="animate-spin text-[var(--text-soft)]" size={18} />}
              </div>
              <label className="mt-4 flex h-11 items-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.82)] px-3">
                <Search size={16} className="text-[var(--text-faint)]" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
                  onChange={(event) => setRestaurantSearch(event.target.value)}
                  placeholder={locale === "en" ? "Search by name, slug, schema or user" : "Buscar por nombre, slug, schema o usuario"}
                  value={restaurantSearch}
                />
              </label>
            </div>

            <div className="app-scrollbar max-h-[calc(100vh-390px)] min-h-[260px] overflow-y-auto p-3">
              {filteredRestaurants.length === 0 && !isLoading ? (
                <div className="rounded-[18px] bg-[var(--surface-base)] px-4 py-8 text-center text-sm text-[var(--text-soft)]">
                  {locale === "en" ? "No restaurants match this filter." : "No hay restaurantes para ese filtro."}
                </div>
              ) : filteredRestaurants.map((restaurant) => (
                <button
                  className={`w-full rounded-[18px] border p-3 text-left transition ${
                    selectedRestaurant?.id === restaurant.id
                      ? "border-[rgba(197,123,87,0.38)] bg-[rgba(236,222,205,0.92)] shadow-[inset_4px_0_0_rgba(197,123,87,0.72)]"
                      : "border-transparent bg-transparent hover:border-[rgba(118,93,71,0.1)] hover:bg-[rgba(255,251,246,0.7)]"
                  }`}
                  key={restaurant.id}
                  onClick={() => setSelectedRestaurantId(restaurant.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--text-strong)]">{restaurant.name}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-[var(--text-faint)]">{restaurant.slug}</p>
                    </div>
                    <AdminStatusBadge status={restaurant.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px] font-bold text-[var(--text-soft)] sm:grid-cols-3">
                    <span className="rounded-xl bg-[var(--surface-base)] px-2 py-2">{restaurant.members.length} {locale === "en" ? "users" : "usuarios"}</span>
                    <span className="rounded-xl bg-[var(--surface-base)] px-2 py-2">{restaurant.metrics.ordersTodayCount} {locale === "en" ? "orders" : "pedidos"}</span>
                    <span className="rounded-xl bg-[var(--surface-base)] px-2 py-2">{restaurant.automationEnabled ? (locale === "en" ? "Full platform" : "Plataforma completa") : (locale === "en" ? "Menu only" : "Solo carta")}</span>
                  </div>
                </button>
              ))}
            </div>

            <details className="border-t border-[rgba(118,93,71,0.12)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-bold text-[var(--text-strong)] sm:px-5">
                <span className="inline-flex items-center gap-2">
                  <UserPlus size={16} />
                  {locale === "en" ? "Create restaurant" : "Crear restaurante"}
                </span>
                <Plus size={16} className="text-[var(--text-faint)]" />
              </summary>
              <form className="grid gap-4 border-t border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.42)] p-4 sm:p-5" onSubmit={(event) => void handleCreateRestaurant(event)}>
                <AdminTextInput
                  label={locale === "en" ? "Restaurant name" : "Nombre restaurante"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, name: value }))}
                  placeholder={locale === "en" ? "Ex. Arepas del Parque" : "Ej. Arepas del Parque"}
                  value={createForm.name}
                />
                <AdminTextInput
                  label={locale === "en" ? "Public slug" : "Slug publico"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, slug: value }))}
                  placeholder="arepas-del-parque"
                  value={createForm.slug}
                />
                <AdminSelect
                  label={locale === "en" ? "Product mode" : "Modalidad del producto"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, experienceMode: value as AdminRestaurantCreateForm["experienceMode"] }))}
                  value={createForm.experienceMode}
                >
                  <option value="connected">{locale === "en" ? "Full platform + WhatsApp automation" : "Plataforma completa + automatización WhatsApp"}</option>
                  <option value="standalone">{locale === "en" ? "Digital menu + AI waiter only" : "Solo carta digital + mesero IA"}</option>
                </AdminSelect>
                <AdminTextInput
                  label={locale === "en" ? "Owner email" : "Correo encargado"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, ownerEmail: value }))}
                  placeholder="admin@restaurante.com"
                  required
                  value={createForm.ownerEmail}
                />
                <AdminTextInput
                  label={locale === "en" ? "Owner name" : "Nombre encargado"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, ownerName: value }))}
                  placeholder={locale === "en" ? "Manager" : "Encargado"}
                  value={createForm.ownerName}
                />
                <AdminTextInput
                  label={locale === "en" ? "Initial password" : "Contrasena inicial"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, ownerPassword: value }))}
                  placeholder={locale === "en" ? "leave empty to use slug_42*password" : "vacio usa slug_42*password"}
                  type="password"
                  value={createForm.ownerPassword}
                />
                <AdminTextInput
                  label={locale === "en" ? "Location" : "Sede"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, locationName: value }))}
                  placeholder={locale === "en" ? "Main location" : "Sede principal"}
                  value={createForm.locationName}
                />
                <AdminTextInput
                  label={locale === "en" ? "Address" : "Direccion"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, locationAddress: value }))}
                  placeholder={locale === "en" ? "Business address" : "Direccion comercial"}
                  value={createForm.locationAddress}
                />
                <AdminTextInput
                  label={locale === "en" ? "Location phone" : "Telefono sede"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, locationPhone: value }))}
                  placeholder="+57..."
                  value={createForm.locationPhone}
                />
                <AdminTextInput
                  label={locale === "en" ? "Fixed delivery fee" : "Domicilio fijo"}
                  onChange={(value) => setCreateForm((current) => ({ ...current, deliveryFeeFixed: value }))}
                  placeholder="0"
                  type="number"
                  value={createForm.deliveryFeeFixed}
                />
              <button
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                {locale === "en" ? "Create restaurant" : "Crear restaurante"}
              </button>
            </form>
            </details>
          </aside>

          <section className="app-panel min-h-[720px] overflow-hidden rounded-[24px]">
            {!selectedRestaurant || !editForm ? (
              <div className="grid min-h-[720px] place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--surface-base)] text-[var(--text-soft)]">
                    <Store size={20} />
                  </span>
                  <h2 className="mt-5 text-2xl font-extrabold text-[var(--text-strong)]">{locale === "en" ? "No restaurant selected" : "Sin restaurante seleccionado"}</h2>
                  <p className="mt-3 max-w-md text-sm leading-7 text-[var(--text-soft)]">
                    {locale === "en"
                      ? "Create or select a restaurant to edit information, users and operational behavior."
                      : "Crea o selecciona un restaurante para editar informacion, usuarios y comportamiento operativo."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.46)] p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminStatusBadge status={selectedRestaurant.status} />
                        <span className="rounded-full bg-[var(--surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
                          {selectedRestaurant.slug}
                        </span>
                        <span className="rounded-full bg-[var(--surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
                          {selectedRestaurant.automationEnabled ? (locale === "en" ? "Full platform" : "Plataforma completa") : (locale === "en" ? "Digital menu only" : "Solo carta digital")}
                        </span>
                      </div>
                      <h2 className="mt-3 truncate text-3xl font-extrabold text-[var(--text-strong)]">{selectedRestaurant.name}</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-soft)]">
                        {adminStatusCopy[selectedRestaurant.status].description}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <a
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-base)] sm:w-auto"
                        href={selectedRestaurant.cartaUrlPath}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink size={16} />
                        {locale === "en" ? "Public menu" : "Carta publica"}
                      </a>
                      <button
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-base)] sm:w-auto"
                        onClick={() => void copyToClipboard(selectedRestaurant.defaultPassword)}
                        type="button"
                      >
                        <Copy size={16} />
                        {locale === "en" ? "Default password" : "Password default"}
                      </button>
                    </div>
                  </div>

                  <nav className="mt-5 flex flex-wrap gap-2 rounded-[18px] bg-[var(--surface-base)] p-2">
                    {[
                      { id: "overview" as const, label: locale === "en" ? "Overview" : "Resumen", icon: ClipboardList },
                      { id: "analytics" as const, label: locale === "en" ? "Analytics" : "Analítica", icon: BarChart3 },
                      { id: "settings" as const, label: locale === "en" ? "Settings" : "Ajustes", icon: Power },
                      { id: "users" as const, label: locale === "en" ? "Users" : "Usuarios", icon: Users },
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const active = adminSection === tab.id;
                      return (
                        <button
                          className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition sm:flex-none ${
                            active
                              ? "bg-[var(--panel-strong)] text-[var(--text-strong)] shadow-sm"
                              : "text-[var(--text-soft)] hover:bg-[rgba(255,251,246,0.55)]"
                          }`}
                          key={tab.id}
                          onClick={() => setAdminSection(tab.id)}
                          type="button"
                        >
                          <Icon size={16} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </nav>
                </div>

                {adminSection === "overview" && (
                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_330px]">
                    <div className="p-5 sm:p-6">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Today's behavior" : "Comportamiento de hoy"}</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <AdminBehaviorMetric label={locale === "en" ? "Active products" : "Productos activos"} value={String(selectedRestaurant.metrics.activeProductCount)} />
                        <AdminBehaviorMetric label={locale === "en" ? "Menu dishes" : "Platos en menu"} value={String(selectedRestaurant.metrics.todayMenuItemCount)} />
                        <AdminBehaviorMetric label={locale === "en" ? "Orders today" : "Pedidos hoy"} value={String(selectedRestaurant.metrics.ordersTodayCount)} />
                        <AdminBehaviorMetric label={locale === "en" ? "Pending" : "Pendientes"} value={String(selectedRestaurant.metrics.pendingOrderCount)} />
                        <AdminBehaviorMetric label={locale === "en" ? "Completed" : "Completados"} value={String(selectedRestaurant.metrics.completedTodayCount)} />
                        <AdminBehaviorMetric label={locale === "en" ? "Revenue today" : "Ingresos hoy"} value={formatPrice(selectedRestaurant.metrics.revenueToday)} />
                      </div>

                      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.6)] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Channels" : "Canales"}</p>
                          <p className="mt-3 text-sm font-semibold text-[var(--text-strong)]">
                            {selectedRestaurant.location?.pickupEnabled ? (locale === "en" ? "Pickup enabled" : "Pickup activo") : (locale === "en" ? "Pickup disabled" : "Pickup apagado")}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[var(--text-strong)]">
                            {selectedRestaurant.location?.deliveryEnabled ? (locale === "en" ? "Delivery enabled" : "Domicilio activo") : (locale === "en" ? "Delivery disabled" : "Domicilio apagado")}
                          </p>
                        </div>
                        <div className="rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.6)] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Location" : "Sede"}</p>
                          <p className="mt-3 text-sm font-semibold text-[var(--text-strong)]">{selectedRestaurant.location?.name ?? (locale === "en" ? "Main location" : "Sede principal")}</p>
                          <p className="mt-1 text-sm text-[var(--text-soft)]">{selectedRestaurant.location?.phone || (locale === "en" ? "No phone" : "Sin telefono")}</p>
                        </div>
                        <div className="rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.6)] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Users" : "Usuarios"}</p>
                          <p className="mt-3 text-2xl font-extrabold text-[var(--text-strong)]">{selectedRestaurant.members.length}</p>
                          <p className="text-sm text-[var(--text-soft)]">{locale === "en" ? "linked to the restaurant" : "vinculados al restaurante"}</p>
                        </div>
                      </div>
                    </div>

                    <aside className="border-t border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.46)] p-5 xl:border-l xl:border-t-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Technical summary" : "Resumen tecnico"}</p>
                      <div className="mt-4 space-y-3 text-sm text-[var(--text-soft)]">
                        <AdminInfoLine label="Tenant ID" value={selectedRestaurant.id} />
                        <AdminInfoLine label="Schema" value={selectedRestaurant.schemaName} />
                        <AdminInfoLine label={locale === "en" ? "Menu" : "Carta"} value={selectedRestaurant.cartaUrlPath} />
                        <AdminInfoLine label={locale === "en" ? "Public page" : "Pagina publica"} value={selectedRestaurant.publicProfileUrlPath} />
                        <AdminInfoLine label={locale === "en" ? "Last order" : "Ultimo pedido"} value={formatDateTime(selectedRestaurant.metrics.lastOrderAt)} />
                        <AdminInfoLine label={locale === "en" ? "Created" : "Creado"} value={formatDateTime(selectedRestaurant.createdAt)} />
                        <AdminInfoLine label={locale === "en" ? "Updated" : "Actualizado"} value={formatDateTime(selectedRestaurant.updatedAt)} />
                      </div>
                    </aside>
                  </div>
                )}

                {adminSection === "analytics" && (
                  <AnalyticsSection
                    locale={locale}
                    restaurants={restaurants}
                    selectedRestaurant={selectedRestaurant}
                  />
                )}

                {adminSection === "settings" && (
                  <div className="p-5 sm:p-6">
                    <div className="max-w-5xl">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Operational settings" : "Configuracion operativa"}</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <AdminTextInput
                          label={locale === "en" ? "Name" : "Nombre"}
                          onChange={(value) => setEditForm((current) => current ? { ...current, name: value } : current)}
                          placeholder={locale === "en" ? "Business name" : "Nombre comercial"}
                          value={editForm.name}
                        />
                        <AdminSelect
                          label={locale === "en" ? "Status" : "Estado"}
                          onChange={(value) => setEditForm((current) => current ? { ...current, status: value as AdminRestaurantStatus } : current)}
                          value={editForm.status}
                        >
                          <option value="active">{locale === "en" ? "Active" : "Activo"}</option>
                          <option value="suspended">{locale === "en" ? "Paused" : "Pausado"}</option>
                          <option value="inactive">{locale === "en" ? "Inactive" : "Inactivo"}</option>
                        </AdminSelect>
                        <AdminTextInput
                          label={locale === "en" ? "Timezone" : "Zona horaria"}
                          onChange={(value) => setEditForm((current) => current ? { ...current, timezone: value } : current)}
                          placeholder="America/Bogota"
                          value={editForm.timezone}
                        />
                        <AdminTextInput
                          label={locale === "en" ? "Currency" : "Moneda"}
                          onChange={(value) => setEditForm((current) => current ? { ...current, currency: value } : current)}
                          placeholder="COP"
                          value={editForm.currency}
                        />
                      </div>

                      <div className="mt-5 grid gap-3 rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-[var(--surface-base)] p-4 sm:grid-cols-2 xl:grid-cols-3">
                        <AdminToggle
                          checked={editForm.automationEnabled}
                          label={editForm.automationEnabled
                            ? (locale === "en" ? "Full platform" : "Plataforma completa")
                            : (locale === "en" ? "Digital menu only" : "Solo carta digital")}
                          onChange={(checked) => setEditForm((current) => current ? {
                            ...current,
                            automationEnabled: checked,
                            locationAutomationEnabled: checked,
                          } : current)}
                        />
                        <AdminToggle
                          checked={editForm.pickupEnabled}
                          label={locale === "en" ? "Pickup" : "Recoger en local"}
                          onChange={(checked) => setEditForm((current) => current ? { ...current, pickupEnabled: checked } : current)}
                        />
                        <AdminToggle
                          checked={editForm.deliveryEnabled}
                          label={locale === "en" ? "Delivery" : "Domicilio"}
                          onChange={(checked) => setEditForm((current) => current ? { ...current, deliveryEnabled: checked } : current)}
                        />
                      </div>

                      <div className="mt-6">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Restaurant information" : "Informacion del restaurante"}</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <AdminTextInput
                            label={locale === "en" ? "Location name" : "Nombre sede"}
                            onChange={(value) => setEditForm((current) => current ? { ...current, locationName: value } : current)}
                            placeholder={locale === "en" ? "Main location" : "Sede principal"}
                            value={editForm.locationName}
                          />
                          <AdminTextInput
                            label={locale === "en" ? "Phone" : "Telefono"}
                            onChange={(value) => setEditForm((current) => current ? { ...current, locationPhone: value } : current)}
                            placeholder="+57..."
                            value={editForm.locationPhone}
                          />
                          <AdminTextInput
                            label={locale === "en" ? "Address" : "Direccion"}
                            onChange={(value) => setEditForm((current) => current ? { ...current, locationAddress: value } : current)}
                            placeholder={locale === "en" ? "Business address" : "Direccion comercial"}
                            value={editForm.locationAddress}
                          />
                          <AdminTextInput
                            label={locale === "en" ? "Fixed delivery fee" : "Domicilio fijo"}
                            onChange={(value) => setEditForm((current) => current ? { ...current, deliveryFeeFixed: value } : current)}
                            placeholder="0"
                            type="number"
                            value={editForm.deliveryFeeFixed}
                          />
                        </div>
                      </div>

                      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <button
                          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          disabled={isSaving}
                          onClick={() => void handleSaveRestaurant()}
                          type="button"
                        >
                          {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                          Guardar cambios
                        </button>
                        <button
                          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(158,108,72,0.24)] px-5 text-sm font-semibold text-[var(--warning)] transition hover:bg-[rgba(158,108,72,0.08)] sm:w-auto"
                          onClick={() => void handleRestaurantStatus(selectedRestaurant.status === "active" ? "suspended" : "active")}
                          type="button"
                        >
                          <Power size={16} />
                          {selectedRestaurant.status === "active" ? "Pausar" : "Reactivar"}
                        </button>
                        <button
                          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(180,94,84,0.24)] px-5 text-sm font-semibold text-[#9a4b43] transition hover:bg-[rgba(190,110,95,0.08)] sm:w-auto"
                          onClick={() => void handleDeleteRestaurant()}
                          type="button"
                        >
                          <Trash2 size={16} />
                          Borrar acceso
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {adminSection === "users" && (
                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Users" : "Usuarios"}</p>
                          <h3 className="mt-2 text-lg font-semibold text-[var(--text-strong)]">{selectedRestaurant.members.length} {locale === "en" ? "members" : "miembros"}</h3>
                        </div>
                        <Users className="text-[var(--text-faint)]" size={18} />
                      </div>
                    <div className="mt-4 space-y-3">
                      {selectedRestaurant.members.length === 0 ? (
                        <div className="rounded-[22px] bg-[var(--surface-base)] px-4 py-8 text-center text-sm text-[var(--text-soft)]">
                          {locale === "en" ? "This restaurant does not have users yet." : "Este restaurante aun no tiene usuarios."}
                        </div>
                      ) : selectedRestaurant.members.map((member) => (
                        <AdminMemberRow
                          isSaving={isSaving}
                          key={member.userId}
                          member={member}
                          onRemove={() => void handleRemoveMember(member)}
                          onResetPassword={() => void handleResetMemberPassword(member)}
                          onUpdate={(patch) => void handleUpdateMember(member, patch)}
                        />
                      ))}
                    </div>
                  </div>

                  <form className="border-t border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.46)] p-5 xl:border-l xl:border-t-0 sm:p-6" onSubmit={(event) => void handleCreateMember(event)}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "New member" : "Nuevo miembro"}</p>
                    <h3 className="mt-2 text-lg font-bold text-[var(--text-strong)]">{locale === "en" ? "Add user" : "Agregar usuario"}</h3>
                    <div className="mt-5 space-y-4">
                      <AdminTextInput
                        label={locale === "en" ? "Email" : "Correo"}
                        onChange={(value) => setMemberForm((current) => ({ ...current, email: value }))}
                        placeholder="usuario@restaurante.com"
                        value={memberForm.email}
                      />
                      <AdminTextInput
                        label={locale === "en" ? "Name" : "Nombre"}
                        onChange={(value) => setMemberForm((current) => ({ ...current, name: value }))}
                        placeholder={locale === "en" ? "Display name" : "Nombre visible"}
                        value={memberForm.name}
                      />
                      <AdminSelect
                        label={locale === "en" ? "Role" : "Rol"}
                        onChange={(value) => setMemberForm((current) => ({ ...current, role: value as AdminRestaurantMember["role"] }))}
                        value={memberForm.role}
                      >
                        <option value="encargado">{locale === "en" ? "Manager" : "Encargado"}</option>
                        <option value="trabajador">{locale === "en" ? "Worker" : "Trabajador"}</option>
                      </AdminSelect>
                      <AdminTextInput
                        label={locale === "en" ? "Password" : "Contrasena"}
                        onChange={(value) => setMemberForm((current) => ({ ...current, password: value }))}
                        placeholder={selectedRestaurant.defaultPassword}
                        type="password"
                        value={memberForm.password}
                      />
                    </div>
                    <button
                      className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSaving}
                      type="submit"
                    >
                      {isSaving ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />}
                      {locale === "en" ? "Add member" : "Agregar miembro"}
                    </button>
                  </form>
                </div>
                )}
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function AdminMetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.045)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgba(246,236,223,0.48)]">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[rgba(255,248,240,0.08)] text-[rgba(246,236,223,0.72)]">{icon}</span>
      </div>
      <p className="mt-2 truncate text-2xl font-extrabold text-[var(--text-on-dark)]">{value}</p>
    </div>
  );
}

function AdminBehaviorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-[var(--surface-base)] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{label}</p>
      <p className="mt-2 truncate text-lg font-bold text-[var(--text-strong)]">{value}</p>
    </div>
  );
}

function AdminTextInput(props: { label: string; onChange: (value: string) => void; placeholder: string; required?: boolean; type?: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{props.label}</span>
      <input
        className="h-12 w-full rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.82)] px-4 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:bg-white focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        required={props.required}
        type={props.type ?? "text"}
        value={props.value}
      />
    </label>
  );
}

function AdminSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</span>
      <select
        className="h-12 w-full rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.82)] px-4 text-sm font-semibold text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:bg-white focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function AdminToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-pressed={checked}
      className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition ${
        checked
          ? "border-[rgba(79,122,97,0.18)] bg-[rgba(79,122,97,0.1)] text-[var(--success)]"
          : "border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.56)] text-[var(--text-soft)]"
      }`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      {label}
      <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-[var(--success)]" : "bg-[var(--text-faint)]"}`} />
    </button>
  );
}

function AdminStatusBadge({ status }: { status: AdminRestaurantStatus }) {
  const locale = activeDashboardLocale;
  const adminStatusCopy = getAdminStatusCopy(locale);
  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${adminStatusCopy[status].className}`}>
      {adminStatusCopy[status].label}
    </span>
  );
}

function AdminInfoLine({ label, value }: { label: string; value?: string }) {
  const locale = activeDashboardLocale;
  return (
    <div className="rounded-2xl bg-[rgba(255,251,246,0.62)] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{label}</p>
      <p className="mt-1 break-all text-xs font-semibold text-[var(--text-strong)]">{value || (locale === "en" ? "no data" : "sin dato")}</p>
    </div>
  );
}

function AdminMemberRow({
  isSaving,
  member,
  onRemove,
  onResetPassword,
  onUpdate,
}: {
  isSaving: boolean;
  member: AdminRestaurantMember;
  onRemove: () => void;
  onResetPassword: () => void;
  onUpdate: (patch: Partial<Pick<AdminRestaurantMember, "role" | "status" | "name">>) => void;
}) {
  const locale = activeDashboardLocale;
  return (
    <article className="rounded-[22px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.72)] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-[var(--text-strong)]">{member.email ?? member.userId}</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              member.status === "active"
                ? "bg-[rgba(79,122,97,0.12)] text-[var(--success)]"
                : "bg-[rgba(118,93,71,0.1)] text-[var(--text-soft)]"
            }`}>
              {member.status === "active" ? (locale === "en" ? "Active" : "Activo") : (locale === "en" ? "Inactive" : "Inactivo")}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold text-[var(--text-faint)]">
            {(member.name || (locale === "en" ? "Unnamed" : "Sin nombre"))} | {locale === "en" ? "Last login" : "Ultimo ingreso"} {formatDateTime(member.lastSignInAt)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <select
            className="h-10 w-full rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.82)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none sm:w-auto"
            disabled={isSaving}
            onChange={(event) => onUpdate({ role: event.target.value as AdminRestaurantMember["role"] })}
            value={member.role}
          >
            <option value="encargado">{locale === "en" ? "Manager" : "Encargado"}</option>
            <option value="trabajador">{locale === "en" ? "Worker" : "Trabajador"}</option>
          </select>
          <button
            className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-base)] sm:w-auto"
            disabled={isSaving}
            onClick={() => onUpdate({ status: member.status === "active" ? "inactive" : "active" })}
            type="button"
          >
            {member.status === "active" ? (locale === "en" ? "Pause" : "Pausar") : (locale === "en" ? "Activate" : "Activar")}
          </button>
          <button
            className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[var(--surface-base)] sm:w-auto"
            disabled={isSaving}
            onClick={onResetPassword}
            type="button"
          >
            {locale === "en" ? "Reset password" : "Restablecer contrasena"}
          </button>
          <button
            className="grid h-10 w-full place-items-center rounded-2xl border border-[rgba(180,94,84,0.2)] text-[#9a4b43] transition hover:bg-[rgba(190,110,95,0.08)] sm:w-10"
            disabled={isSaving}
            onClick={onRemove}
            title={locale === "en" ? "Remove access" : "Quitar acceso"}
            type="button"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-[rgba(14,11,9,0.55)] p-0 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div className="app-panel reveal-up max-h-[96vh] w-full overflow-hidden rounded-t-[28px] sm:max-h-[92vh] sm:max-w-2xl sm:rounded-[30px]">
        <div className="flex items-center justify-between border-b border-[rgba(118,93,71,0.12)] px-5 py-4 sm:px-6">
          <h3 className="app-display text-[2rem] leading-none text-[var(--text-strong)]">{title}</h3>
          <button
            className="grid h-10 w-10 place-items-center rounded-2xl border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] transition hover:bg-white"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="app-scrollbar max-h-[calc(96vh-84px)] overflow-y-auto p-4 sm:max-h-[calc(92vh-84px)] sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function StandaloneFrame({
  actions,
  children,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <div className="w-full max-w-[720px] rounded-[30px] border border-[rgba(255,242,227,0.1)] bg-[rgba(30,26,23,0.92)] p-6 text-[var(--text-on-dark)] shadow-[0_30px_90px_rgba(0,0,0,0.32)] sm:rounded-[34px] sm:p-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.42)]">{eyebrow}</p>
        <h1 className="app-display mt-6 text-[2.5rem] leading-none sm:text-[3.6rem]">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-[rgba(246,236,223,0.72)] sm:text-[15px]">{description}</p>
        {children && <div className="mt-6">{children}</div>}
        {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
      </div>
    </div>
  );
}

function CenteredStatus({ description, title }: { description: string; title: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <div className="rounded-[30px] border border-[rgba(255,242,227,0.1)] bg-[rgba(30,26,23,0.92)] px-8 py-8 text-center text-[var(--text-on-dark)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.05)]">
          <Loader2 className="animate-spin" size={20} />
        </div>
        <p className="app-display mt-5 text-[2.5rem] leading-none">{title}</p>
        <p className="mt-3 max-w-md text-sm leading-7 text-[rgba(246,236,223,0.68)]">{description}</p>
      </div>
    </div>
  );
}

function LoginHighlight({ copy, title }: { copy: string; title: string }) {
  return (
    <div className="rounded-[22px] border border-[rgba(255,242,227,0.08)] bg-[rgba(255,248,240,0.04)] p-4">
      <p className="text-sm font-semibold text-[var(--text-on-dark)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[rgba(246,236,223,0.56)]">{copy}</p>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="app-display text-[2.25rem] leading-none text-[var(--text-on-dark)] sm:text-[2.8rem]">{title}</h2>
      {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[rgba(246,236,223,0.68)] sm:text-[15px]">{subtitle}</p> : null}
    </div>
  );
}

function TextInput(props: {
  hidePasswordLabel?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  showPasswordLabel?: string;
  type?: string;
  value: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = props.type === "password";
  const resolvedType = isPassword ? (showPassword ? "text" : "password") : props.type ?? "text";

  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{props.label}</span>
      <div className="relative">
        <input
          className={`h-12 w-full rounded-2xl border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.86)] px-4 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:bg-white focus:ring-4 focus:ring-[rgba(197,123,87,0.08)] ${isPassword ? "pr-12" : ""}`}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          type={resolvedType}
          value={props.value}
        />
        {isPassword ? (
          <button
            aria-label={showPassword ? (props.hidePasswordLabel ?? "Ocultar contrasena") : (props.showPasswordLabel ?? "Mostrar contrasena")}
            className="absolute inset-y-0 right-1 my-1 grid w-10 place-items-center rounded-xl text-[var(--text-soft)] transition hover:bg-[rgba(118,93,71,0.08)] hover:text-[var(--text-strong)]"
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        ) : null}
      </div>
    </label>
  );
}

function ProductImage({
  description,
  emoji,
  imageUrl,
  large = false,
  name,
}: {
  description?: string;
  emoji?: string;
  imageUrl?: string;
  large?: boolean;
  name: string;
}) {
  const locale = activeDashboardLocale;
  const size = large ? "h-24 w-24 rounded-[22px]" : "h-16 w-16 rounded-[18px]";

  if (!imageUrl) {
    const resolvedEmoji = emoji || inferProductEmoji({ description, name });

    return (
      <div
        className={`grid shrink-0 place-items-center bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.52),transparent_42%),linear-gradient(135deg,var(--surface-base),var(--surface-strong))] ring-1 ring-[rgba(118,93,71,0.1)] ${size}`}
        title={locale === "en" ? `Product emoji: ${resolvedEmoji}` : `Emoji del producto: ${resolvedEmoji}`}
      >
        <span
          aria-label={locale === "en" ? `Product emoji for ${name}` : `Emoji del producto para ${name}`}
          className={`${large ? "text-[2.7rem]" : "text-[1.9rem]"} drop-shadow-[0_8px_14px_rgba(20,14,10,0.12)]`}
          role="img"
        >
          {resolvedEmoji}
        </span>
      </div>
    );
  }

  return <img alt={name} className={`shrink-0 object-cover ring-1 ring-[rgba(118,93,71,0.12)] ${size}`} src={imageUrl} />;
}

function StatSurface({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-panel rounded-[26px] px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</p>
      <p className="app-display mt-4 text-[3rem] leading-none text-[var(--text-strong)]">{value}</p>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[rgba(255,242,227,0.12)] bg-[rgba(32,28,25,0.96)] px-5 py-3 text-sm font-semibold text-[var(--text-on-dark)] shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur lg:bottom-6">
      <Check size={16} />
      {message}
    </div>
  );
}
