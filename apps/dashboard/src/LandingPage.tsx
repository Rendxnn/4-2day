import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChefHat,
  Clock3,
  CreditCard,
  LayoutDashboard,
  Menu,
  MessageCircle,
  PackageCheck,
  QrCode,
  ScanSearch,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  UploadCloud,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { MarketingFooter } from "./marketing/MarketingFooter";
import { useMarketingMetadata } from "./marketing/MarketingMetadata";

type LandingLocale = "en" | "es";

const LANDING_LOCALE_STORAGE_KEY = "parahoy-landing-locale";

type NavItem = {
  href: string;
  label: string;
};

type ProblemCard = {
  copy: string;
  icon: typeof MessageCircle;
  title: string;
  visual: "chat" | "kitchen" | "payment" | "rush";
};

type FlowStep = {
  copy: string;
  eyebrow: string;
  title: string;
  visual: "menu" | "ai" | "ops";
};

type FeatureCard = {
  copy: string;
  icon: typeof UploadCloud;
  points: string[];
  title: string;
  visual: "menu" | "chat" | "states" | "payment" | "qr" | "control";
};

type UseCase = {
  copy: string;
  title: string;
};

function getSalesWhatsappUrl(locale: LandingLocale) {
  const text = locale === "en"
    ? "hi, I'm interested in learning more about how ParaHoy works and how it could help me organize my restaurant orders through WhatsApp. I would like to schedule a demo to see the platform in action, resolve some questions, and understand how it would fit my business."
    : "Hola, estoy interesado en conocer mejor cómo funciona ParaHoy y cómo podría ayudarme a organizar los pedidos de mi restaurante por WhatsApp. Me gustaría agendar una demostración para ver la plataforma en acción, resolver algunas dudas y entender cómo se adaptaría a mi negocio.";
  return `https://wa.me/573207085729?text=${encodeURIComponent(text)}`;
}

function getLandingCopy(locale: LandingLocale) {
  if (locale === "en") {
    const faqs = [
      "Can AI get an order wrong?",
      "Can I review before sending to the kitchen?",
      "Can I upload my menu from Excel, PDF, or photo?",
      "What happens if an item sells out?",
      "Does it work with bank transfer payments?",
      "Do I need to change my WhatsApp number?",
      "Can I publish a QR menu?",
      "How long does initial setup take?",
      "Can I step into a conversation manually?",
      "Does it work for small restaurants?",
    ];

    return {
      access: "Log in",
      actionScheduleDemo: "Book a demo",
      brandTagline: "WhatsApp ordering for restaurants",
      chips: ["Upload menu from file or photo", "Clear order states", "Digital menu with AI waiter"],
      cartaProduct: {
        badge: "Also available on its own",
        body: "Give every visitor a digital menu that explains dishes, answers questions, and recommends real products from today's menu. You can start with the menu only and add WhatsApp automation later.",
        cta: "Explore with an expert waiter",
        points: ["Every dish opens into a clear detail", "Visual, contextual recommendations", "Share by QR, link, or social media"],
        title: "A digital menu that knows how to sell, even without WhatsApp automation.",
      },
      featureBadge: "Product",
      featureCards: [
        {
          title: "Smart menu",
          copy: "Upload your menu from file, photo, or text. Edit products, prices, categories, and availability from one panel.",
          icon: UploadCloud,
          points: ["Excel, PDF, CSV, photo, or text", "Categories and variants", "Panel-based updates"],
          visual: "menu",
        },
        {
          title: "AI order capture",
          copy: "AI understands natural language, asks for missing details, and summarizes the order before confirmation.",
          icon: Bot,
          points: ["Validation questions", "Clear notes and quantities", "Summary before confirmation"],
          visual: "chat",
        },
        {
          title: "Kitchen-ready states",
          copy: "Every order moves through clear states: new, payment pending, confirmed, in prep, and ready.",
          icon: PackageCheck,
          points: ["State visibility", "Operational queue", "Time-based priority"],
          visual: "states",
        },
        {
          title: "Transfer payments",
          copy: "Mark orders as payment pending, attach proof, and confirm manually before prep starts.",
          icon: CreditCard,
          points: ["Payment pending flow", "Proof review", "Manual confirmation"],
          visual: "payment",
        },
        {
          title: "Digital menu with AI waiter",
          copy: "Publish a menu that explains dishes and makes timely recommendations, with or without WhatsApp automation.",
          icon: QrCode,
          points: ["Standalone product", "QR ready to share", "Synced with availability"],
          visual: "qr",
        },
        {
          title: "Human control",
          copy: "Your team can step in, edit, confirm, or pause automation whenever necessary.",
          icon: ShieldCheck,
          points: ["Manual edits", "Live intervention", "Clear rules before kitchen"],
          visual: "control",
        },
      ] as FeatureCard[],
      featureIntro: {
        overline: "Features",
        subtitle: "The platform is built so every order stays clear from the first message to delivery.",
        title: "What you need to sell on WhatsApp with more control.",
      },
      faqAnswers: Object.fromEntries([
        [faqs[0] as string, "It can ask for clarification when details are missing, and the restaurant still keeps final validation before sending anything to the kitchen."],
        [faqs[1] as string, "Yes. The order arrives ready to review, edit, and confirm before it reaches the kitchen."],
        [faqs[2] as string, "Yes. Upload accepts Excel, CSV, PDF, image, or text before publishing."],
        [faqs[3] as string, "You can hide it or mark it unavailable so it stops being offered immediately."],
        [faqs[4] as string, "Yes. The order can remain payment pending until your team confirms it manually."],
        [faqs[5] as string, "The integration is prepared to run with the WhatsApp channel setup the restaurant chooses."],
        [faqs[6] as string, "Yes. The digital menu with its expert AI waiter can be used as a standalone product, even if you do not automate WhatsApp yet."],
        [faqs[7] as string, "It depends on your menu and channel, but the goal is to get menu and flow live without a long setup cycle."],
        [faqs[8] as string, "Yes. Your team can intervene, edit, or confirm whenever the situation requires it."],
        [faqs[9] as string, "Yes. It is designed for teams that want more sales without adding more operational mess."],
      ]) as Record<string, string>,
      faqs,
      finalCta: {
        body: "Start receiving clear orders, controlled payments, and an organized kitchen from one platform.",
        title: "Stop copying orders out of WhatsApp.",
      },
      flowCard: {
        copy: "Less waiting, fewer mistakes, and better internal order.",
        title: "Shorter response time",
      },
      flowIntro: {
        overline: "Flow",
        subtitle: "Each step shows how a messy chat becomes a clear order your kitchen can actually operate.",
        title: "From scattered messages to kitchen-ready orders.",
      },
      flowSteps: [
        {
          eyebrow: "Step 1",
          title: "Upload your menu",
          copy: "Upload Excel, CSV, PDF, image, or text. ParaHoy detects products, prices, categories, variants, and availability.",
          visual: "menu",
        },
        {
          eyebrow: "Step 2",
          title: "AI asks and validates",
          copy: "It asks follow-up questions, confirms products, and collects delivery and payment details before closing the order.",
          visual: "ai",
        },
        {
          eyebrow: "Step 3",
          title: "Your team operates in order",
          copy: "The order lands in the panel with state, notes, payment, and kitchen context already structured.",
          visual: "ops",
        },
      ] as FlowStep[],
      hero: {
        badge: "WhatsApp, AI, and operations connected",
        body: "The AI handles it, organizes the orders, and your kitchen prepares.",
        title: "Your WhatsApp no longer has to be chaos.",
      },
      localeLabel: "Language",
      mobileMenu: {
        close: "Close menu",
        open: "Open menu",
      },
      navItems: [
        { href: "#como-funciona", label: "How it works" },
        { href: "#carta-ia", label: "AI menu" },
        { href: "#producto", label: "Platform" },
        { href: "#funciones", label: "Features" },
        { href: "#faq", label: "FAQ" },
      ] as NavItem[],
      product: {
        actionConfirm: "Confirm",
        actionSendKitchen: "Send to kitchen",
        detailAddress: "Address",
        detailNotes: "Notes",
        detailPayment: "Payment",
        detailProducts: "Products",
        detailQuantities: "Quantities",
        detailTitle: "Order #2841",
        detailUser: "Laura M. - WhatsApp",
        filterConfirmed: "Confirmed",
        filterNew: "New",
        filterPaymentPending: "Payment pending",
        filterReady: "Ready",
        filterPreparing: "In prep",
        intro: {
          overline: "Team view",
          subtitle: "Every order arrives with items, notes, payment, and next steps in one view.",
          title: "See the full order before it reaches the kitchen.",
        },
        orderAddress: "Laureles, Medellin",
        orderNotes: "One protein without sauce",
        orderPayment: "Transfer pending",
        orderProducts: "2 lunch specials",
        orderQuantities: "2 plates + 1 lemonade",
        panelRealtime: "Real-time orders",
        panelTitle: "Today's orders",
        payments: "Payments",
        pendingLabel: "Payment pending",
        pillNew: "18 new",
        pillPending: "4 payment pending",
        pillPreparing: "7 in prep",
        search: "Search",
        settings: "Settings",
        sidebarOrdersLive: "Live orders",
        sidebarCustomers: "Customers",
        sidebarMenu: "Menu",
        sidebarOrders: "Orders",
        statusConfirmed: "Confirmed",
      },
      problemCards: [
        {
          title: "Incomplete orders",
          copy: "Customers send products, address, and changes across separate messages.",
          icon: MessageCircle,
          visual: "chat",
        },
        {
          title: "Kitchen without context",
          copy: "Important notes get lost inside long chat threads.",
          icon: ChefHat,
          visual: "kitchen",
        },
        {
          title: "Mixed payments",
          copy: "Proof of payment and confirmations end up buried inside the conversation.",
          icon: Wallet,
          visual: "payment",
        },
        {
          title: "Rush hours with no control",
          copy: "The team responds late and some orders get lost completely.",
          icon: Clock3,
          visual: "rush",
        },
      ] as ProblemCard[],
      statuses: {
        confirmed: "Confirmed",
        preparing: "In prep",
        new: "New",
      },
      faqIntro: {
        overline: "Frequently asked questions",
        subtitle: "Direct answers to the questions that usually appear before switching on the service.",
        title: "Questions teams ask before automating WhatsApp orders.",
      },
    };
  }

  const faqs = [
    "La IA puede equivocarse con un pedido?",
    "Puedo revisar antes de enviar a cocina?",
    "Puedo subir mi menu en Excel, PDF o foto?",
    "Que pasa si un producto se agota?",
    "Funciona con pagos por transferencia?",
    "Necesito cambiar mi numero de WhatsApp?",
    "Puedo tener carta digital con QR?",
    "Cuanto tarda la configuracion inicial?",
    "Puedo intervenir manualmente una conversacion?",
    "Sirve para restaurantes pequenos?",
  ];

  return {
    access: "Ingresar",
    actionScheduleDemo: "Agendar una prueba",
    brandTagline: "Pedidos por WhatsApp para restaurantes",
    chips: ["Carga menu por archivo o foto", "Estados claros", "Carta con mesero IA"],
    cartaProduct: {
      badge: "También disponible por separado",
      body: "Dale a cada visitante una carta digital que explica los platos, responde preguntas y recomienda productos reales del menú del día. Puedes empezar solo con la carta y sumar la automatización de WhatsApp después.",
      cta: "Explorar con un mesero experto",
      points: ["Cada plato abre un detalle claro", "Recomendaciones visuales y contextuales", "Comparte por QR, enlace o redes"],
      title: "Una carta digital que sabe vender, incluso sin automatizar WhatsApp.",
    },
    featureBadge: "Producto",
    featureCards: [
      {
        title: "Menu inteligente",
        copy: "Carga tu carta desde archivo, foto o texto. Edita productos, precios, categorias y disponibilidad desde el panel.",
        icon: UploadCloud,
        points: ["Excel, PDF, CSV, foto o texto", "Categorias y variantes", "Actualizacion desde el panel"],
        visual: "menu",
      },
      {
        title: "Toma de pedidos con IA",
        copy: "La IA entiende lenguaje natural, hace preguntas cuando faltan datos y resume el pedido antes de confirmarlo.",
        icon: Bot,
        points: ["Preguntas de validacion", "Notas y cantidades claras", "Resumen antes de confirmar"],
        visual: "chat",
      },
      {
        title: "Estados para cocina",
        copy: "Cada pedido avanza por estados claros: nuevo, pendiente de pago, confirmado, en preparacion y listo.",
        icon: PackageCheck,
        points: ["Visibilidad por estado", "Cola operativa", "Prioridad por tiempo"],
        visual: "states",
      },
      {
        title: "Pagos por transferencia",
        copy: "Marca pedidos como pendientes, adjunta comprobantes y confirma manualmente antes de preparar.",
        icon: CreditCard,
        points: ["Pedido pendiente de pago", "Revision de comprobante", "Confirmacion manual"],
        visual: "payment",
      },
      {
        title: "Carta digital con mesero IA",
        copy: "Publica una carta que explica los platos y recomienda en el momento justo, con o sin automatización de WhatsApp.",
        icon: QrCode,
        points: ["Producto independiente", "QR listo para compartir", "Conectado a disponibilidad"],
        visual: "qr",
      },
      {
        title: "Control humano",
        copy: "El equipo puede intervenir, editar, confirmar o pausar la automatizacion cuando sea necesario.",
        icon: ShieldCheck,
        points: ["Edicion manual", "Intervencion en vivo", "Reglas claras antes de cocina"],
        visual: "control",
      },
    ] as FeatureCard[],
    featureIntro: {
      overline: "Funciones",
      subtitle: "La plataforma esta pensada para que el pedido quede claro desde el primer mensaje hasta la entrega.",
      title: "Lo que necesitas para vender por WhatsApp con mas orden.",
    },
    faqAnswers: Object.fromEntries([
      [faqs[0] as string, "Puede pedir aclaraciones cuando falten datos, y el restaurante mantiene la validacion final antes de confirmar o enviar a cocina."],
      [faqs[1] as string, "Si. El pedido llega listo para revisar, editar y confirmar antes de enviarlo a cocina."],
      [faqs[2] as string, "Si. La carga acepta Excel, CSV, PDF, imagen o texto antes de publicarlo."],
      [faqs[3] as string, "Puedes ocultarlo o marcarlo no disponible para que deje de ofrecerse de inmediato."],
      [faqs[4] as string, "Si. El pedido puede quedar pendiente de pago y esperar confirmacion manual antes de prepararse."],
      [faqs[5] as string, "La integracion se prepara para operar con la configuracion del canal que defina el restaurante."],
      [faqs[6] as string, "Sí. La carta digital con su mesero experto IA se puede contratar como producto independiente, aunque todavía no automatices WhatsApp."],
      [faqs[7] as string, "Depende del menu y del canal, pero la idea es dejar operativa la carta y el flujo sin procesos largos."],
      [faqs[8] as string, "Si. El equipo puede intervenir, editar o confirmar cuando la situacion lo requiera."],
      [faqs[9] as string, "Si. Esta pensado para equipos que quieren vender mas sin sumar complejidad al dia a dia."],
    ]) as Record<string, string>,
    faqs,
    finalCta: {
      body: "Empieza a recibir pedidos claros, pagos controlados y cocina organizada desde una sola plataforma.",
      title: "Deja de copiar pedidos desde WhatsApp.",
    },
    flowCard: {
      copy: "Menos espera, menos errores y mejor orden interno.",
      title: "Respuesta mas corta",
    },
    flowIntro: {
      overline: "Flujo",
      subtitle: "Cada paso muestra como el pedido pasa de mensajes incompletos a una orden clara para cocina.",
      title: "De mensajes incompletos a pedidos claros para cocina.",
    },
    flowSteps: [
      {
        eyebrow: "Paso 1",
        title: "Carga tu menu",
        copy: "Sube Excel, CSV, PDF, imagen o texto. ParaHoy detecta productos, precios, categorias, variantes y disponibilidad.",
        visual: "menu",
      },
      {
        eyebrow: "Paso 2",
        title: "La IA conversa y valida",
        copy: "Responde preguntas, confirma productos, pide direccion, metodo de entrega y pago antes de cerrar el pedido.",
        visual: "ai",
      },
      {
        eyebrow: "Paso 3",
        title: "El equipo opera con orden",
        copy: "El pedido llega al panel con estado, notas, pago y contexto para cocina y entrega.",
        visual: "ops",
      },
    ] as FlowStep[],
    hero: {
      badge: "WhatsApp, IA y operacion conectados",
      body: "La IA lo atiende, ordena los pedidos y tu cocina prepara.",
      title: "Tu WhatsApp ya no tiene que ser un caos.",
    },
    localeLabel: "Idioma",
    mobileMenu: {
      close: "Cerrar menu",
      open: "Abrir menu",
    },
    navItems: [
      { href: "#como-funciona", label: "Como funciona" },
      { href: "#carta-ia", label: "Carta IA" },
      { href: "#producto", label: "Plataforma" },
      { href: "#funciones", label: "Funciones" },
      { href: "#faq", label: "Preguntas" },
    ] as NavItem[],
    product: {
      actionConfirm: "Confirmar",
      actionSendKitchen: "Enviar a cocina",
      detailAddress: "Direccion",
      detailNotes: "Notas",
      detailPayment: "Pago",
      detailProducts: "Productos",
      detailQuantities: "Cantidades",
      detailTitle: "Pedido #2841",
      detailUser: "Laura M. - WhatsApp",
      filterConfirmed: "Confirmado",
      filterNew: "Nuevo",
      filterPaymentPending: "Pendiente de pago",
      filterReady: "Listo",
      filterPreparing: "En preparacion",
      intro: {
        overline: "Vista del equipo",
        subtitle: "Cada pedido llega con productos, notas, pago y siguientes pasos en una sola vista.",
        title: "Todo el pedido claro antes de que entre a cocina.",
      },
      orderAddress: "Laureles, Medellin",
      orderNotes: "Una proteina sin salsa",
      orderPayment: "Transferencia pendiente",
      orderProducts: "2 almuerzos del dia",
      orderQuantities: "2 platos + 1 limonada",
      panelRealtime: "Seguimiento en tiempo real",
      panelTitle: "Pedidos de hoy",
      payments: "Pagos",
      pendingLabel: "Pendiente de pago",
      pillNew: "18 nuevos",
      pillPending: "4 pendientes de pago",
      pillPreparing: "7 en preparacion",
      search: "Buscar",
      settings: "Configuracion",
      sidebarOrdersLive: "Pedidos en tiempo real",
      sidebarCustomers: "Clientes",
      sidebarMenu: "Menu",
      sidebarOrders: "Pedidos",
      statusConfirmed: "Confirmado",
    },
    problemCards: [
      {
        title: "Pedidos incompletos",
        copy: "El cliente escribe productos, direccion y cambios en mensajes separados.",
        icon: MessageCircle,
        visual: "chat",
      },
      {
        title: "Cocina sin contexto",
        copy: "Las notas importantes se pierden entre chats largos.",
        icon: ChefHat,
        visual: "kitchen",
      },
      {
        title: "Pagos mezclados",
        copy: "Comprobantes y confirmaciones quedan enterrados en la conversacion.",
        icon: Wallet,
        visual: "payment",
      },
      {
        title: "Horas pico sin control",
        copy: "El equipo responde tarde y algunos pedidos se pierden.",
        icon: Clock3,
        visual: "rush",
      },
    ] as ProblemCard[],
    statuses: {
      confirmed: "Confirmado",
      preparing: "En preparacion",
      new: "Nuevo",
    },
    faqIntro: {
      overline: "Preguntas frecuentes",
      subtitle: "Respuestas directas para las dudas que suelen aparecer antes de activar el servicio.",
      title: "Preguntas antes de automatizar pedidos por WhatsApp.",
    },
  };
}

type LandingCopy = ReturnType<typeof getLandingCopy>;

const diagnosticDefaults = {
  dailyOrders: 45,
  responseMinutes: 11,
  staffCount: 2,
  manualPayments: true,
};

const useCases: UseCase[] = [
  { title: "Menu del dia", copy: "Recibe pedidos repetitivos sin responder lo mismo 50 veces." },
  { title: "Comidas rapidas", copy: "Acelera horas pico con pedidos claros y estados visibles." },
  { title: "Cafeterias", copy: "Ordena bebidas, combos y retiros sin enredar al equipo." },
  { title: "Cocinas ocultas", copy: "Opera todo desde WhatsApp con mejor control de entrega." },
  { title: "Restaurantes con domicilios", copy: "Confirma direccion, pago y notas sin perder contexto." },
  { title: "Negocios con horas pico", copy: "Reduce pedidos perdidos cuando entran varios chats al tiempo." },
];

const controlPoints = [
  "Confirmacion antes de preparar.",
  "Edicion manual de pedidos.",
  "Intervencion humana en cualquier conversacion.",
  "Control de productos agotados.",
  "Historial de cada pedido.",
  "Estados visibles para todo el equipo.",
];

const problemCards = getLandingCopy("es").problemCards;

function resolveInitialLocale(): LandingLocale {
  if (typeof window === "undefined") return "es";

  const storedLocale = window.localStorage.getItem(LANDING_LOCALE_STORAGE_KEY);
  if (storedLocale === "es" || storedLocale === "en") return storedLocale;

  return window.navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function useElementProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const raw = (viewportHeight - rect.top) / (rect.height + viewportHeight * 0.45);
      setProgress(clamp(raw));
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { progress, ref };
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

export function LandingPage() {
  const [locale, setLocale] = useState<LandingLocale>(() => resolveInitialLocale());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [heroOffset, setHeroOffset] = useState(0);
  const [heroStatusIndex, setHeroStatusIndex] = useState(0);
  const copy = getLandingCopy(locale);
  const salesWhatsappUrl = getSalesWhatsappUrl(locale);

  useMarketingMetadata({
    description: locale === "en"
      ? "ParaHoy gives restaurants a digital menu with an expert AI waiter and can turn WhatsApp conversations into clear, reviewable orders."
      : "ParaHoy ofrece una carta digital con mesero experto IA y convierte conversaciones de WhatsApp en pedidos claros para el restaurante.",
    locale,
    pathname: "/",
    title: locale === "en"
      ? "ParaHoy | Digital menu with AI waiter and WhatsApp ordering"
      : "ParaHoy | Carta digital con mesero IA y pedidos por WhatsApp",
  });

  useEffect(() => {
    const onScroll = () => {
      setHeaderSolid(window.scrollY > 18);
      setHeroOffset(clamp(window.scrollY / 520));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroStatusIndex((current) => (current + 1) % 3);
    }, 2200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <div className="min-h-screen bg-[var(--marketing-bg)] text-[var(--marketing-text)]">
      <LandingHeader
        copy={copy}
        headerSolid={headerSolid}
        locale={locale}
        mobileMenuOpen={mobileMenuOpen}
        onChangeLocale={setLocale}
        salesWhatsappUrl={salesWhatsappUrl}
        onToggleMenu={() => setMobileMenuOpen((current) => !current)}
      />
      <main>
        <HeroSection copy={copy} heroOffset={heroOffset} heroStatusIndex={heroStatusIndex} salesWhatsappUrl={salesWhatsappUrl} />
        <FlowSection copy={copy} />
        <CartaAiProductSection copy={copy} />
        <ProductSection copy={copy} />
        <FeatureSection copy={copy} />
        <FAQAccordion copy={copy} />
        <FinalCTA copy={copy} salesWhatsappUrl={salesWhatsappUrl} />
      </main>
      <MarketingFooter locale={locale} />
    </div>
  );
}

function LandingHeader({
  copy,
  headerSolid,
  locale,
  mobileMenuOpen,
  onChangeLocale,
  salesWhatsappUrl,
  onToggleMenu,
}: {
  copy: LandingCopy;
  headerSolid: boolean;
  locale: LandingLocale;
  mobileMenuOpen: boolean;
  onChangeLocale: (locale: LandingLocale) => void;
  salesWhatsappUrl: string;
  onToggleMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-50 px-3 py-3 sm:px-5">
      <div
        className={cn(
          "mx-auto max-w-7xl rounded-full border px-4 py-3 transition-all sm:px-5",
          headerSolid
            ? "border-[rgba(7,94,84,0.12)] bg-[rgba(255,253,248,0.86)] shadow-[0_18px_45px_rgba(16,22,18,0.08)] backdrop-blur-xl"
            : "border-[rgba(7,94,84,0.08)] bg-[rgba(255,253,248,0.6)] backdrop-blur-lg",
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <a className="flex min-w-0 items-center gap-3 no-underline" href="/">
            <img
              alt="ParaHoy"
              className="h-12 w-auto max-w-[190px] object-contain sm:h-14 sm:max-w-[220px]"
              src="/parahoy-logo.png"
            />
          </a>

          <nav className="hidden items-center gap-7 lg:flex">
            {copy.navItems.map((item) => (
              <a className="text-sm font-semibold text-[var(--marketing-muted)] transition hover:text-[var(--marketing-text)]" href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <LanguageToggle label={copy.localeLabel} locale={locale} onChange={onChangeLocale} />
            <a
              className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--marketing-border)] px-5 text-sm font-semibold text-[var(--marketing-text)] transition hover:border-[var(--wa-green-dark)] hover:text-[var(--wa-green-dark)]"
              href="/login"
            >
              {copy.access}
            </a>
            <a
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--wa-green)] px-5 text-sm font-semibold text-[#032a1a] shadow-[0_18px_34px_rgba(37,211,102,0.22)] transition hover:bg-[var(--wa-green-dark)] hover:text-white"
              href={salesWhatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              {copy.actionScheduleDemo}
              <ArrowRight size={16} />
            </a>
          </div>

          <button
            aria-label={mobileMenuOpen ? copy.mobileMenu.close : copy.mobileMenu.open}
            className="grid h-11 w-11 place-items-center rounded-full border border-[var(--marketing-border)] bg-white text-[var(--marketing-text)] lg:hidden"
            onClick={onToggleMenu}
            type="button"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {mobileMenuOpen ? (
          <div className="mt-4 space-y-3 border-t border-[rgba(7,94,84,0.08)] pt-4 lg:hidden">
            <div className="flex justify-start">
              <LanguageToggle label={copy.localeLabel} locale={locale} onChange={onChangeLocale} />
            </div>
            {copy.navItems.map((item) => (
              <a className="block rounded-2xl px-1 py-2 text-sm font-semibold text-[var(--marketing-muted)] transition hover:text-[var(--marketing-text)]" href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
            <div className="grid grid-cols-1 gap-2 pt-2">
              <a className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--marketing-border)] text-sm font-semibold text-[var(--marketing-text)]" href="/login">
                {copy.access}
              </a>
              <a
                className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--wa-green)] text-sm font-semibold text-[#032a1a]"
                href={salesWhatsappUrl}
                rel="noreferrer"
                target="_blank"
              >
                {copy.actionScheduleDemo}
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function HeroSection({
  copy,
  heroOffset,
  heroStatusIndex,
  salesWhatsappUrl,
}: {
  copy: LandingCopy;
  heroOffset: number;
  heroStatusIndex: number;
  salesWhatsappUrl: string;
}) {
  const statuses = [
    { label: copy.statuses.new, tone: "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]" },
    { label: copy.statuses.confirmed, tone: "bg-[rgba(7,94,84,0.12)] text-[var(--wa-green-dark)]" },
    { label: copy.statuses.preparing, tone: "bg-[rgba(255,122,26,0.14)] text-[var(--warm-accent)]" },
  ];
  const activeStatus = statuses[heroStatusIndex] ?? {
    label: copy.statuses.new,
    tone: "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]",
  };

  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-6 sm:px-6 sm:pb-22 sm:pt-10">
      <div className="pointer-events-none absolute inset-x-0 top-[-180px] h-[460px] bg-[radial-gradient(circle_at_top,rgba(37,211,102,0.16),transparent_42%),radial-gradient(circle_at_16%_38%,rgba(255,122,26,0.2),transparent_26%),radial-gradient(circle_at_80%_16%,rgba(7,94,84,0.12),transparent_30%)]" />
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-center">
        <div className="relative z-10">
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[rgba(7,94,84,0.12)] bg-white/90 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--wa-green-dark)] shadow-[0_12px_30px_rgba(22,28,24,0.06)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--wa-green)]" />
            {copy.hero.badge}
          </div>
          <h1 className="mt-6 max-w-[11ch] text-[2.9rem] font-extrabold leading-[0.92] tracking-[-0.06em] text-[var(--marketing-text)] sm:text-[4.35rem] xl:text-[4.7rem]">
            {copy.hero.title}
          </h1>
          <p className="mt-5 max-w-[18ch] text-[1.12rem] leading-[1.18] text-[var(--marketing-muted)] sm:max-w-[20ch] sm:text-[1.36rem]">
            {copy.hero.body}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex h-13 items-center justify-center gap-2 rounded-full border border-[var(--marketing-border)] bg-white px-6 text-[15px] font-bold text-[var(--marketing-text)] transition hover:border-[var(--wa-green-dark)] hover:text-[var(--wa-green-dark)]"
              href="/login"
            >
              {copy.access}
            </a>
            <a
              className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[var(--wa-green)] px-6 text-[15px] font-bold text-[#032a1a] shadow-[0_20px_40px_rgba(37,211,102,0.24)] transition hover:bg-[var(--wa-green-dark)] hover:text-white"
              href={salesWhatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              {copy.actionScheduleDemo}
              <ArrowRight size={18} />
            </a>
          </div>
        </div>

        <div className="relative min-h-[660px] sm:min-h-[700px] lg:min-h-[680px]">
          <div className="absolute inset-0 rounded-[34px] border border-[rgba(7,94,84,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(255,255,255,0.42))] shadow-[0_28px_74px_rgba(16,22,18,0.12)] backdrop-blur-xl" />
          <div className="landing-grid absolute inset-0 rounded-[34px] opacity-40" />
          <div className="pointer-events-none absolute inset-x-[8%] top-[12%] h-24 rounded-full bg-[radial-gradient(circle,rgba(37,211,102,0.14),transparent_68%)] blur-3xl" />

          <div
            className="absolute left-4 top-5 z-10 w-[78%] rounded-[26px] border border-[rgba(7,94,84,0.08)] bg-white p-4 shadow-[0_18px_34px_rgba(22,28,24,0.08)] sm:left-6 sm:top-7 sm:w-[48%] lg:left-[4%] lg:top-[11%] lg:w-[34%]"
            style={{ transform: `translate3d(0, ${heroOffset * -18}px, 0) rotate(-4deg)` }}
          >
            <MiniSurfaceHeader icon={MessageCircle} subtitle={copy.access === "Log in" ? "Customer" : "Cliente"} title="WhatsApp" tone="light" />
            <div className="mt-4 space-y-3 text-sm text-[#1f2937]">
              <ChatBubble align="left" copy={copy.access === "Log in" ? "Hi, I want 2 lunch specials and one sugar-free lemonade." : "Hola, quiero 2 almuerzos y una limonada sin azucar."} />
              <ChatBubble align="right" copy={copy.access === "Log in" ? "I will confirm items, delivery, and payment." : "Te confirmo productos, entrega y pago."} />
              <ChatBubble align="left" copy={copy.access === "Log in" ? "Delivery to Laureles. Bank transfer payment." : "Domicilio en Laureles. Pago por transferencia."} />
            </div>
          </div>

          <div
            className="absolute right-4 top-[31%] z-20 w-[76%] rounded-[28px] border border-[rgba(37,211,102,0.16)] bg-[linear-gradient(180deg,#ffffff,#f3fbf5)] p-4 shadow-[0_24px_40px_rgba(22,28,24,0.08)] sm:right-6 sm:top-[22%] sm:w-[46%] lg:left-[33%] lg:right-auto lg:top-[16%] lg:w-[27%]"
            style={{ transform: `translate3d(0, ${heroOffset * -10}px, 0)` }}
          >
            <MiniSurfaceHeader icon={Bot} subtitle={copy.access === "Log in" ? "AI" : "IA"} title={copy.access === "Log in" ? "Processing order" : "Procesando pedido"} tone="soft" />
            <div className="mt-4 rounded-[22px] border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)] p-4">
              <div className="flex items-center gap-3">
                <span className="landing-pulse grid h-10 w-10 place-items-center rounded-2xl bg-[var(--wa-green)] text-[#063e27]">
                  <Bot size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold text-[var(--marketing-text)]">{copy.access === "Log in" ? "Structured order" : "Pedido resumido"}</p>
                  <p className="text-xs text-[var(--marketing-muted)]">{copy.access === "Log in" ? "Items, notes, address, and payment" : "Items, notas, direccion y pago"}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <KeyValueLine label="Items" value={copy.access === "Log in" ? "2 lunch specials" : "2 almuerzos"} />
                <KeyValueLine label={copy.access === "Log in" ? "Drink" : "Bebida"} value={copy.access === "Log in" ? "1 lemonade" : "1 limonada"} />
                <KeyValueLine label={copy.access === "Log in" ? "Address" : "Direccion"} value="Laureles" />
                <KeyValueLine label={copy.access === "Log in" ? "Payment" : "Pago"} value={copy.access === "Log in" ? "Transfer" : "Transferencia"} />
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-4 left-4 right-4 z-30 rounded-[28px] border border-[rgba(16,24,39,0.08)] bg-[#101714] p-5 text-white shadow-[0_22px_44px_rgba(16,22,18,0.14)] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[62%] lg:bottom-[10%] lg:right-[4%] lg:w-[40%]"
            style={{ transform: `translate3d(0, ${heroOffset * -12}px, 0)` }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[rgba(236,247,240,0.52)]">{copy.access === "Log in" ? "Order ready" : "Pedido listo"}</p>
                <h3 className="mt-1 text-xl font-bold tracking-[-0.03em] text-white sm:text-2xl">{copy.access === "Log in" ? "Team summary" : "Resumen para el equipo"}</h3>
              </div>
              <span className={cn("rounded-full px-3 py-1 text-xs font-bold transition-all", activeStatus.tone)}>
                {activeStatus.label}
              </span>
            </div>
            <div className="mt-4 rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
              <p className="text-sm font-bold text-white">Pedido #2841 · Laura M.</p>
              <p className="mt-1 text-sm text-[rgba(236,247,240,0.66)]">2 almuerzos, 1 limonada · Domicilio</p>
              <div className="mt-4 space-y-2 text-sm">
                <HeroSummaryRow label={copy.access === "Log in" ? "Payment" : "Pago"} value={copy.access === "Log in" ? "Transfer pending" : "Transferencia pendiente"} />
                <HeroSummaryRow label={copy.access === "Log in" ? "Notes" : "Notas"} value={copy.access === "Log in" ? "One protein without sauce" : "Una proteina sin salsa"} />
                <HeroSummaryRow label={copy.access === "Log in" ? "Next step" : "Siguiente paso"} value={copy.access === "Log in" ? "Confirm and send to kitchen" : "Confirmar y enviar a cocina"} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-[rgba(37,211,102,0.12)] px-3 py-2 text-xs font-bold text-[var(--wa-green)]">{copy.access === "Log in" ? "18 new today" : "18 nuevos hoy"}</span>
              <span className="rounded-full bg-[rgba(255,255,255,0.08)] px-3 py-2 text-xs font-bold text-[rgba(236,247,240,0.72)]">{copy.access === "Log in" ? "7 in prep" : "7 en preparacion"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" ref={ref}>
      <div className="mx-auto max-w-7xl">
        <SectionIntro
          overline="Problema"
          subtitle="Cuando los pedidos llegan por partes, tu equipo pierde tiempo confirmando datos, copiando mensajes y revisando pagos."
          title="El problema no es WhatsApp. Es operar pedidos desde un chat desordenado."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {problemCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <article
                className={cn(
                  "landing-reveal rounded-[26px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_16px_38px_rgba(18,24,20,0.05)]",
                  visible && "is-visible",
                )}
                key={card.title}
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[rgba(7,94,84,0.08)] text-[var(--wa-green-dark)]">
                    <Icon size={18} />
                  </div>
                  <span className="rounded-full border border-[rgba(7,94,84,0.08)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--marketing-muted)]">
                    Riesgo
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-bold tracking-[-0.03em] text-[var(--marketing-text)]">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--marketing-muted)]">{card.copy}</p>
                <div className="mt-4 rounded-[18px] border border-[rgba(7,94,84,0.08)] bg-[#fbfbf8] p-3">
                  <ProblemMiniVisual visual={card.visual} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FlowSection({ copy }: { copy: LandingCopy }) {
  const { progress, ref } = useElementProgress<HTMLElement>();

  return (
    <section className="overflow-x-clip bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(245,251,246,0.92))] px-4 py-16 sm:px-6 sm:py-20" id="como-funciona" ref={ref}>
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionIntro overline={copy.flowIntro.overline} subtitle={copy.flowIntro.subtitle} title={copy.flowIntro.title} />
          <div className="mt-6 rounded-[28px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_16px_38px_rgba(18,24,20,0.05)]">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]">
                <Clock3 size={20} />
              </span>
              <div>
                <p className="text-sm font-bold text-[var(--marketing-text)]">{copy.flowCard.title}</p>
                <p className="text-sm text-[var(--marketing-muted)]">{copy.flowCard.copy}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute left-6 top-6 hidden h-[calc(100%-3rem)] w-px bg-[linear-gradient(180deg,rgba(7,94,84,0.08),rgba(7,94,84,0.18),rgba(7,94,84,0.08))] lg:block" />
          <div className="space-y-4">
            {copy.flowSteps.map((step, index) => {
              const shift = (index - 1) * 24 - progress * 26 + index * 4;

              return (
                <article
                  className="rounded-[30px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_20px_46px_rgba(18,24,20,0.06)] transition-transform duration-300 sm:p-6 lg:translate-x-[var(--landing-shift)]"
                  key={step.title}
                  style={{ "--landing-shift": `${shift}px` } as CSSProperties}
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,0.32fr)] lg:items-center lg:gap-5">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--wa-green-dark)]">{step.eyebrow}</p>
                      <h3 className="mt-3 text-[1.72rem] font-extrabold leading-none tracking-[-0.05em] text-[var(--marketing-text)] sm:text-[1.9rem]">
                        {step.title}
                      </h3>
                      <p className="mt-4 text-[14px] leading-7 text-[var(--marketing-muted)] sm:text-[15px] sm:leading-8">{step.copy}</p>
                    </div>
                    <div className="min-w-0 rounded-[22px] border border-[rgba(7,94,84,0.08)] bg-[#fbfbf8] p-3 sm:p-4">
                      <FlowMiniVisual visual={step.visual} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function CartaAiProductSection({ copy }: { copy: LandingCopy }) {
  const { ref, visible } = useReveal<HTMLElement>();
  const isEnglish = copy.access === "Log in";

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" id="carta-ia" ref={ref}>
      <div className={cn(
        "landing-reveal mx-auto grid max-w-7xl gap-7 overflow-hidden rounded-[34px] border border-[rgba(255,255,255,0.09)] bg-[linear-gradient(140deg,#101915_0%,#17241d_48%,#442b1c_100%)] p-6 text-white shadow-[0_34px_90px_rgba(17,31,24,0.18)] sm:p-8 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-center lg:p-10",
        visible && "is-visible",
      )}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#bce9cd]">
            <Sparkles size={14} />
            {copy.cartaProduct.badge}
          </span>
          <h2 className="mt-6 max-w-xl text-[2.35rem] font-extrabold leading-[1.02] tracking-[-0.055em] sm:text-[3.2rem]">
            {copy.cartaProduct.title}
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-8 text-white/68">{copy.cartaProduct.body}</p>
          <div className="mt-6 space-y-3">
            {copy.cartaProduct.points.map((point) => (
              <div className="flex items-center gap-3 text-sm font-semibold text-white/82" key={point}>
                <CheckCircle2 className="shrink-0 text-[#6fe2a0]" size={18} />
                {point}
              </div>
            ))}
          </div>
          <a className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-[#ff7a1a] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_18px_34px_rgba(255,122,26,0.24)] transition hover:-translate-y-0.5 hover:brightness-110" href="#funciones">
            {copy.cartaProduct.cta}
            <ArrowRight size={16} />
          </a>
        </div>

        <div className="relative min-h-[500px]">
          <div className="absolute inset-0 rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_70%_10%,rgba(255,155,85,0.18),transparent_28%),rgba(8,10,8,0.42)] p-4 shadow-[0_30px_70px_rgba(0,0,0,0.24)] backdrop-blur sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{isEnglish ? "Today’s menu" : "Carta de hoy"}</p>
                <p className="mt-1 text-lg font-extrabold">{isEnglish ? "House favorites" : "Favoritos de la casa"}</p>
              </div>
              <span className="rounded-full bg-white/8 px-3 py-2 text-xs font-bold text-white/64">QR + link</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { emoji: "🍔", name: isEnglish ? "House burger" : "Hamburguesa de la casa", price: "$35.000" },
                { emoji: "🥩", name: isEnglish ? "Sharing grill" : "Picada para compartir", price: "$58.000" },
              ].map((item) => (
                <article className="overflow-hidden rounded-[24px] bg-[#f7efe6] text-[#221814]" key={item.name}>
                  <div className="grid h-32 place-items-center bg-[radial-gradient(circle,white,transparent_58%),#eadbc9] text-6xl">{item.emoji}</div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-extrabold">{item.name}</p>
                      <span className="rounded-xl bg-[#241a15] px-2.5 py-1.5 text-xs font-bold text-white">{item.price}</span>
                    </div>
                    <button className="mt-4 flex w-full items-center justify-between border-t border-[#ded1c4] pt-3 text-xs font-extrabold text-[#a4582c]" type="button">
                      {isEnglish ? "View details" : "Ver detalle"}
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#ef7d32] text-white">+</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="absolute bottom-5 right-3 w-[min(90%,350px)] rounded-[25px] border border-white/12 bg-[rgba(24,17,13,0.97)] p-4 shadow-[0_28px_70px_rgba(0,0,0,0.46)] sm:right-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#ef7d32]"><ChefHat size={19} /></span>
              <div>
                <p className="text-sm font-extrabold">{isEnglish ? "Your expert AI waiter" : "Tu mesero experto IA"}</p>
                <p className="text-xs text-white/46">{isEnglish ? "Knows today’s real menu" : "Conoce la carta real de hoy"}</p>
              </div>
            </div>
            <p className="mt-3 rounded-[17px] rounded-bl-md bg-white/[0.07] p-3 text-sm leading-6 text-white/82">
              {isEnglish
                ? "That sharing grill is great for 3 or 4 people. If you like a little heat, ask for the house spicy sauce."
                : "Esa picada va muy bien para 3 o 4 personas. Si les gusta un toque de fuego, pregunten por la salsa picante de la casa."}
            </p>
            <div className="mt-3 flex items-center justify-between rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-white/38">
              {isEnglish ? "Ask about a dish…" : "Pregunta por un plato…"}
              <Send size={14} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductSection({ copy }: { copy: LandingCopy }) {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" id="producto" ref={ref}>
      <div className="mx-auto max-w-7xl">
        <SectionIntro overline={copy.product.intro.overline} subtitle={copy.product.intro.subtitle} title={copy.product.intro.title} />
        <article className={cn("landing-reveal mt-8 overflow-hidden rounded-[30px] border border-[var(--marketing-border)] bg-white shadow-[0_24px_64px_rgba(18,24,20,0.08)]", visible && "is-visible")}>
          <div className="grid lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="border-b border-[rgba(7,94,84,0.08)] bg-[#f7f7f3] p-5 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-3">
                <img alt="ParaHoy" className="h-10 w-10 rounded-2xl object-cover" src="/Logo.png" />
                <div>
                  <p className="text-sm font-bold text-[var(--marketing-text)]">ParaHoy</p>
                  <p className="text-xs text-[var(--marketing-muted)]">{copy.product.sidebarOrdersLive}</p>
                </div>
              </div>
              <div className="mt-6 space-y-2">
                {[
                  { icon: LayoutDashboard, label: copy.product.sidebarOrders, active: true },
                  { icon: UploadCloud, label: copy.product.sidebarMenu },
                  { icon: Users, label: copy.product.sidebarCustomers },
                  { icon: CreditCard, label: copy.product.payments },
                  { icon: Settings2, label: copy.product.settings },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold",
                        item.active
                          ? "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]"
                          : "text-[var(--marketing-muted)]",
                      )}
                      key={item.label}
                    >
                      <Icon size={16} />
                      {item.label}
                    </div>
                  );
                })}
              </div>
            </aside>

            <div className="p-5">
              <div className="flex flex-col gap-4 border-b border-[rgba(7,94,84,0.08)] pb-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--marketing-muted)]">{copy.product.panelRealtime}</p>
                  <h3 className="mt-2 text-[1.8rem] font-extrabold leading-none tracking-[-0.04em] text-[var(--marketing-text)]">{copy.product.panelTitle}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[copy.product.filterNew, copy.product.filterPaymentPending, copy.product.filterConfirmed, copy.product.filterPreparing, copy.product.filterReady].map((filterLabel, index) => (
                    <span
                      className={cn(
                        "rounded-full px-3 py-2 text-xs font-bold",
                        index === 0
                          ? "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]"
                          : "border border-[var(--marketing-border)] text-[var(--marketing-muted)]",
                      )}
                      key={filterLabel}
                    >
                      {filterLabel}
                    </span>
                  ))}
                  <div className="flex h-10 items-center gap-2 rounded-2xl border border-[var(--marketing-border)] px-3 text-sm text-[var(--marketing-muted)]">
                    <Search size={15} />
                    {copy.product.search}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricPill label={copy.product.pillNew} tone="green" />
                    <MetricPill label={copy.product.pillPreparing} tone="dark" />
                    <MetricPill label={copy.product.pillPending} tone="warm" />
                  </div>

                  <div className="mt-4 rounded-[24px] border border-[var(--marketing-border)] bg-[#fbfbf8] p-3">
                    <div className="grid gap-3 lg:grid-cols-3">
                      <StatusColumn
                        orders={[
                          { customer: "Laura M.", total: "$34.000", channel: "WhatsApp", time: copy.access === "Log in" ? "2 min ago" : "Hace 2 min" },
                          { customer: "Camilo P.", total: "$21.500", channel: "WhatsApp", time: copy.access === "Log in" ? "5 min ago" : "Hace 5 min" },
                        ]}
                        title={copy.product.filterNew}
                        tone="green"
                      />
                      <StatusColumn
                        orders={[
                          { customer: "Sara T.", total: "$19.000", channel: "WhatsApp", time: copy.product.pendingLabel },
                        ]}
                        title={copy.product.filterPaymentPending}
                        tone="warm"
                      />
                      <StatusColumn
                        orders={[
                          { customer: "Nora C.", total: "$27.000", channel: "WhatsApp", time: copy.access === "Log in" ? "In kitchen" : "En cocina" },
                          { customer: "Juan D.", total: "$32.000", channel: "WhatsApp", time: copy.access === "Log in" ? "Ready to dispatch" : "Listo para salir" },
                        ]}
                        title={copy.product.statusConfirmed}
                        tone="dark"
                      />
                    </div>
                  </div>
                </div>

                <article className="min-w-0 rounded-[24px] border border-[var(--marketing-border)] bg-[#fcfcfa] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[var(--marketing-text)]">{copy.product.detailTitle}</p>
                      <p className="mt-1 text-sm text-[var(--marketing-muted)]">Laura M. · WhatsApp</p>
                    </div>
                    <span className="rounded-full bg-[rgba(37,211,102,0.12)] px-3 py-1 text-xs font-bold text-[var(--wa-green-dark)]">
                      {copy.product.filterNew}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3 text-sm">
                    <DetailRow label={copy.product.detailProducts} value={copy.product.orderProducts} />
                    <DetailRow label={copy.product.detailQuantities} value={copy.product.orderQuantities} />
                    <DetailRow label={copy.product.detailNotes} value={copy.product.orderNotes} />
                    <DetailRow label={copy.product.detailAddress} value={copy.product.orderAddress} />
                    <DetailRow label={copy.product.detailPayment} value={copy.product.orderPayment} />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <ActionButton tone="primary">{copy.product.actionConfirm}</ActionButton>
                    <ActionButton tone="secondary">{copy.product.actionSendKitchen}</ActionButton>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function FeatureSection({ copy }: { copy: LandingCopy }) {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section className="bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(255,255,255,0.96))] px-4 py-16 sm:px-6 sm:py-20" id="funciones" ref={ref}>
      <div className="mx-auto max-w-7xl">
        <SectionIntro overline={copy.featureIntro.overline} subtitle={copy.featureIntro.subtitle} title={copy.featureIntro.title} />
        <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {copy.featureCards.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article
                className={cn(
                  "landing-reveal flex h-full flex-col rounded-[28px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_18px_46px_rgba(18,24,20,0.06)]",
                  visible && "is-visible",
                )}
                key={feature.title}
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(7,94,84,0.08)] text-[var(--wa-green-dark)]">
                    <Icon size={20} />
                  </div>
                  <span className="rounded-full border border-[rgba(7,94,84,0.08)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--marketing-muted)]">
                    {copy.featureBadge}
                  </span>
                </div>
                <h3 className="mt-4 text-[1.35rem] font-bold tracking-[-0.04em] text-[var(--marketing-text)]">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--marketing-muted)]">{feature.copy}</p>
                <div className="mt-4 rounded-[18px] border border-[rgba(7,94,84,0.08)] bg-[#fbfbf8] p-3">
                  <FeatureMiniVisual visual={feature.visual} />
                </div>
                <div className="mt-4 space-y-3">
                  {feature.points.map((point) => (
                    <div className="flex items-start gap-3 text-sm text-[var(--marketing-muted)]" key={point}>
                      <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--wa-green)]" size={17} />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RestaurantUseCases() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" ref={ref}>
      <div className="mx-auto max-w-7xl">
        <SectionIntro
          overline="Para restaurantes"
          subtitle="Casos concretos donde el problema se repite todos los dias."
          title="Hecho para restaurantes que venden todos los dias por WhatsApp."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {useCases.map((item, index) => (
            <article
              className={cn(
                "landing-reveal rounded-[26px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_16px_40px_rgba(18,24,20,0.05)]",
                visible && "is-visible",
              )}
              key={item.title}
              style={{ transitionDelay: `${index * 75}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-bold tracking-[-0.03em] text-[var(--marketing-text)]">{item.title}</p>
                <span className="rounded-full bg-[rgba(255,122,26,0.1)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--warm-accent)]">
                  Caso real
                </span>
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--marketing-muted)]">{item.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HumanControlSection() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" ref={ref}>
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center">
        <div className="rounded-[30px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#0b1613,#101827)] p-7 text-white shadow-[0_28px_72px_rgba(10,16,13,0.18)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[rgba(237,246,240,0.72)]">
            <ShieldCheck size={14} />
            Confianza operativa
          </div>
          <h2 className="mt-6 text-[2.15rem] font-extrabold leading-[1.02] tracking-[-0.05em]">
            La IA ayuda, pero tu restaurante mantiene el control.
          </h2>
          <p className="mt-5 text-[15px] leading-8 text-[rgba(237,246,240,0.72)]">
            ParaHoy no manda pedidos a cocina sin reglas claras. Tu equipo puede revisar, editar y confirmar cuando lo necesite.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {controlPoints.map((point, index) => (
            <article
              className={cn(
                "landing-reveal rounded-[24px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_16px_36px_rgba(18,24,20,0.05)]",
                visible && "is-visible",
              )}
              key={point}
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 shrink-0 text-[var(--wa-green)]" size={18} />
                <p className="text-sm font-semibold leading-7 text-[var(--marketing-text)]">{point}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DiagnosticCalculatorPreview({
  diagnostic,
  onChange,
  weeklyHigh,
  weeklyLow,
}: {
  diagnostic: typeof diagnosticDefaults;
  onChange: (value: typeof diagnosticDefaults) => void;
  weeklyHigh: number;
  weeklyLow: number;
}) {
  return (
    <section className="bg-[linear-gradient(180deg,rgba(255,255,255,0.6),rgba(245,251,246,0.9))] px-4 py-16 sm:px-6 sm:py-20" id="diagnostico">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
        <div>
          <SectionIntro
            overline="Diagnostico"
            subtitle="Calcula en menos de un minuto si tu WhatsApp esta frenando tus ventas."
            title="Cuantos pedidos estas perdiendo por responder tarde?"
          />
          <div className="mt-8 rounded-[28px] border border-[var(--marketing-border)] bg-white p-6 shadow-[0_20px_50px_rgba(18,24,20,0.06)]">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Pedidos diarios aproximados">
                <input
                  className="landing-input"
                  min={1}
                  onChange={(event) => onChange({ ...diagnostic, dailyOrders: Number(event.target.value) || 0 })}
                  type="number"
                  value={diagnostic.dailyOrders}
                />
              </Field>
              <Field label="Tiempo promedio de respuesta">
                <div className="relative">
                  <input
                    className="landing-input pr-14"
                    min={0}
                    onChange={(event) => onChange({ ...diagnostic, responseMinutes: Number(event.target.value) || 0 })}
                    type="number"
                    value={diagnostic.responseMinutes}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-[var(--marketing-muted)]">min</span>
                </div>
              </Field>
              <Field label="Personas atendiendo WhatsApp">
                <input
                  className="landing-input"
                  min={1}
                  onChange={(event) => onChange({ ...diagnostic, staffCount: Number(event.target.value) || 1 })}
                  type="number"
                  value={diagnostic.staffCount}
                />
              </Field>
              <Field label="Confirmas pagos manualmente">
                <div className="flex h-[3.25rem] items-center justify-between rounded-2xl border border-[rgba(7,94,84,0.12)] bg-white px-4">
                  <span className="text-sm font-semibold text-[var(--marketing-text)]">
                    {diagnostic.manualPayments ? "Si" : "No"}
                  </span>
                  <button
                    aria-label="Cambiar confirmacion manual de pagos"
                    className={cn(
                      "relative h-7 w-12 rounded-full transition",
                      diagnostic.manualPayments ? "bg-[var(--wa-green)]" : "bg-[rgba(7,94,84,0.16)]",
                    )}
                    onClick={() => onChange({ ...diagnostic, manualPayments: !diagnostic.manualPayments })}
                    type="button"
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-5 w-5 rounded-full bg-white transition",
                        diagnostic.manualPayments ? "left-6" : "left-1",
                      )}
                    />
                  </button>
                </div>
              </Field>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#0b1613,#111827)] p-6 text-white shadow-[0_28px_72px_rgba(10,16,13,0.18)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[rgba(237,246,240,0.62)]">Resultado visual</p>
              <h3 className="mt-3 text-[2rem] font-extrabold leading-none tracking-[-0.04em]">Impacto semanal</h3>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(37,211,102,0.14)] text-[var(--wa-green)]">
              <ScanSearch size={20} />
            </span>
          </div>
          <div className="mt-6 rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-5">
            <p className="text-xl font-bold leading-9 text-white">
              Podrias estar perdiendo entre {weeklyLow} y {weeklyHigh} pedidos por semana por demoras o errores operativos.
            </p>
            <p className="mt-4 text-sm leading-7 text-[rgba(237,246,240,0.72)]">
              Este bloque puede conectarse luego a una calculadora comercial mas precisa. Por ahora ya deja clara la oportunidad.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <MetricPill label={`${diagnostic.dailyOrders} pedidos por dia`} tone="green" />
            <MetricPill label={`${diagnostic.responseMinutes} min de respuesta`} tone="dark" />
            <MetricPill label={`${diagnostic.staffCount} personas en WhatsApp`} tone="warm" />
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQAccordion({ copy }: { copy: LandingCopy }) {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20" id="faq">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="rounded-[28px] border border-[var(--marketing-border)] bg-white p-6 shadow-[0_20px_50px_rgba(18,24,20,0.06)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--wa-green-dark)]">{copy.faqIntro.overline}</p>
          <h2 className="mt-4 text-[2.2rem] font-extrabold leading-[1.02] tracking-[-0.05em] text-[var(--marketing-text)]">
            {copy.faqIntro.title}
          </h2>
          <p className="mt-4 text-[15px] leading-8 text-[var(--marketing-muted)]">
            {copy.faqIntro.subtitle}
          </p>
        </div>
        <div className="space-y-3">
          {copy.faqs.map((question) => (
            <details className="group rounded-[24px] border border-[var(--marketing-border)] bg-white p-5 shadow-[0_14px_34px_rgba(18,24,20,0.05)]" key={question}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-bold text-[var(--marketing-text)]">
                <span>{question}</span>
                <ChevronDown className="shrink-0 text-[var(--marketing-muted)] transition group-open:rotate-180" size={20} />
              </summary>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--marketing-muted)]">{copy.faqAnswers[question]}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA({ copy, salesWhatsappUrl }: { copy: LandingCopy; salesWhatsappUrl: string }) {
  return (
    <section className="px-4 pb-8 pt-4 sm:px-6 sm:pb-10">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[32px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(135deg,#08140f,#101827_56%,#20110b_100%)] px-6 py-10 text-white shadow-[0_32px_80px_rgba(9,13,17,0.24)] sm:px-10 sm:py-14">
        <div className="max-w-3xl">
          <h2 className="mt-4 text-[2.3rem] font-extrabold leading-[0.98] tracking-[-0.05em] sm:text-[3.3rem]">
            {copy.finalCta.title}
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-8 text-[rgba(232,242,236,0.72)]">
            {copy.finalCta.body}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a className="inline-flex h-13 items-center justify-center rounded-full border border-[rgba(255,255,255,0.16)] px-6 text-sm font-bold text-white transition hover:bg-[rgba(255,255,255,0.08)]" href="/login">
              {copy.access}
            </a>
            <a
              className="inline-flex h-13 items-center justify-center rounded-full bg-[var(--wa-green)] px-6 text-sm font-bold text-[#032a1a] transition hover:bg-[#1eb957]"
              href={salesWhatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              {copy.actionScheduleDemo}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function LanguageToggle({
  label,
  locale,
  onChange,
}: {
  label: string;
  locale: LandingLocale;
  onChange: (locale: LandingLocale) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--marketing-border)] bg-white px-2 py-2">
      <span className="hidden pl-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--marketing-muted)] sm:block">
        {label}
      </span>
      {(["es", "en"] as LandingLocale[]).map((option) => (
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition",
            locale === option
              ? "bg-[var(--wa-green)] text-[#032a1a]"
              : "text-[var(--marketing-muted)] hover:text-[var(--marketing-text)]",
          )}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function MiniSurfaceHeader({
  icon: Icon,
  subtitle,
  title,
  tone,
}: {
  icon: typeof UploadCloud;
  subtitle: string;
  title: string;
  tone: "light" | "soft";
}) {
  const toneClass = tone === "soft"
    ? "bg-[rgba(255,122,26,0.1)] text-[var(--warm-accent)]"
    : "bg-[rgba(37,211,102,0.1)] text-[var(--wa-green-dark)]";

  return (
    <div className="flex items-center gap-3">
      <span className={cn("grid h-10 w-10 place-items-center rounded-2xl", toneClass)}>
        <Icon size={18} />
      </span>
      <div>
        <p className="text-sm font-bold text-[var(--marketing-text)]">{title}</p>
        <p className="text-xs text-[var(--marketing-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

function ChatBubble({ align, copy }: { align: "left" | "right"; copy: string }) {
  return (
    <div className={cn("flex", align === "right" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-[18px] px-3 py-3 text-[13px] leading-6 shadow-[0_10px_20px_rgba(18,24,20,0.05)]",
          align === "right"
            ? "bg-[rgba(37,211,102,0.15)] text-[var(--marketing-text)]"
            : "bg-[#f5f2eb] text-[var(--marketing-text)]",
        )}
      >
        {copy}
      </div>
    </div>
  );
}

function KeyValueLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-[rgba(7,94,84,0.08)] pb-2">
      <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--marketing-muted)]">{label}</span>
      <span className="min-w-0 max-w-[58%] break-words text-right text-sm font-semibold text-[var(--marketing-text)]">{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--marketing-muted)]">{label}</span>
      <span className="min-w-0 max-w-[58%] break-words text-right text-sm font-semibold text-[var(--marketing-text)]">{value}</span>
    </div>
  );
}

function HeroSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[rgba(236,247,240,0.46)]">{label}</span>
      <span className="min-w-0 max-w-[58%] break-words text-right text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function MetricPill({ label, tone }: { label: string; tone: "dark" | "green" | "warm" }) {
  const toneClass = tone === "green"
    ? "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]"
    : tone === "warm"
      ? "bg-[rgba(255,122,26,0.14)] text-[var(--warm-accent)]"
      : "bg-[rgba(7,94,84,0.1)] text-[var(--wa-green-dark)]";

  return <div className={cn("min-w-0 rounded-[18px] px-4 py-3 text-[13px] font-bold sm:text-sm", toneClass)}>{label}</div>;
}

function StatusColumn({
  orders,
  title,
  tone,
}: {
  orders: Array<{ channel: string; customer: string; time: string; total: string }>;
  title: string;
  tone: "dark" | "green" | "warm";
}) {
  return (
    <div className="min-w-0 rounded-[20px] border border-[var(--marketing-border)] bg-white p-3">
      <MetricPill label={title} tone={tone} />
      <div className="mt-3 space-y-3">
        {orders.map((order) => (
          <article className="rounded-[16px] border border-[rgba(7,94,84,0.08)] bg-[#fcfcfa] p-3" key={`${order.customer}-${order.total}`}>
            <p className="text-sm font-bold text-[var(--marketing-text)]">{order.customer}</p>
            <p className="mt-1 text-xs text-[var(--marketing-muted)]">{order.channel} · {order.time}</p>
            <p className="mt-2 text-sm font-semibold text-[var(--marketing-text)]">{order.total}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ children, tone }: { children: ReactNode; tone: "primary" | "secondary" }) {
  return (
    <button
      className={cn(
        "inline-flex h-11 w-full items-center justify-center rounded-full px-4 text-sm font-bold transition sm:w-auto",
        tone === "primary"
          ? "bg-[var(--wa-green)] text-[#032a1a] hover:bg-[var(--wa-green-dark)] hover:text-white"
          : "border border-[var(--marketing-border)] text-[var(--marketing-text)] hover:border-[var(--wa-green-dark)]",
      )}
      type="button"
    >
      {children}
    </button>
  );
}

function ProblemMiniVisual({ visual }: { visual: ProblemCard["visual"] }) {
  if (visual === "chat") {
    return (
      <div className="space-y-2">
        <MiniBubble tone="neutral">2 almuerzos</MiniBubble>
        <MiniBubble tone="neutral">Domicilio en...</MiniBubble>
        <MiniBubble tone="green">Falta direccion completa</MiniBubble>
      </div>
    );
  }

  if (visual === "kitchen") {
    return (
      <div className="space-y-2">
        <MiniBadge label="Pedido #2841" tone="dark" />
        <MiniLine left="Notas" right="No aparece la salsa" />
        <MiniLine left="Cocina" right="Sin contexto" />
      </div>
    );
  }

  if (visual === "payment") {
    return (
      <div className="space-y-2">
        <MiniBadge label="Comprobante" tone="warm" />
        <MiniLine left="Transferencia" right="Sin revisar" />
        <MiniLine left="Estado" right="Pendiente" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MiniLine left="08:12" right="Nuevo pedido" />
      <MiniLine left="08:14" right="Otro chat" />
      <MiniBadge label="Equipo saturado" tone="green" />
    </div>
  );
}

function FlowMiniVisual({ visual }: { visual: FlowStep["visual"] }) {
  if (visual === "menu") {
    return (
      <div className="space-y-2">
        <MiniBadge label="Excel / PDF / Foto" tone="dark" />
        <MiniLine left="Categorias" right="Detectadas" />
        <MiniLine left="Precios" right="Listos" />
      </div>
    );
  }

  if (visual === "ai") {
    return (
      <div className="space-y-2">
        <MiniBubble tone="neutral">Es para domicilio?</MiniBubble>
        <MiniBubble tone="green">Pago por transferencia</MiniBubble>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MiniBadge label="Confirmado" tone="green" />
      <MiniLine left="Cocina" right="En preparacion" />
      <MiniLine left="Entrega" right="Lista" />
    </div>
  );
}

function FeatureMiniVisual({ visual }: { visual: FeatureCard["visual"] }) {
  if (visual === "menu") {
    return (
      <div className="space-y-2">
        <MiniLine left="Menu del dia" right="15 productos" />
        <MiniLine left="Variantes" right="Activas" />
      </div>
    );
  }

  if (visual === "chat") {
    return (
      <div className="space-y-2">
        <MiniBubble tone="neutral">Falta metodo de pago</MiniBubble>
        <MiniBubble tone="green">Transferencia confirmada</MiniBubble>
      </div>
    );
  }

  if (visual === "states") {
    return (
      <div className="flex flex-wrap gap-2">
        <MiniBadge label="Nuevo" tone="green" />
        <MiniBadge label="Pendiente" tone="warm" />
        <MiniBadge label="Listo" tone="dark" />
      </div>
    );
  }

  if (visual === "payment") {
    return (
      <div className="space-y-2">
        <MiniLine left="Comprobante" right="Adjunto" />
        <MiniBadge label="Revision manual" tone="warm" />
      </div>
    );
  }

  if (visual === "qr") {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="grid h-14 w-14 grid-cols-3 gap-1 rounded-xl bg-[#f4f4ef] p-2">
          {Array.from({ length: 9 }).map((_, index) => (
            <span className={cn("rounded-[3px]", index % 2 === 0 ? "bg-[var(--marketing-text)]" : "bg-transparent")} key={index} />
          ))}
        </div>
        <MiniBadge label="Carta conectada" tone="green" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MiniLine left="Intervencion" right="Activa" />
      <MiniBadge label="Editar pedido" tone="dark" />
    </div>
  );
}

function MiniBubble({ children, tone }: { children: ReactNode; tone: "green" | "neutral" }) {
  return (
    <div className={cn("min-w-0 rounded-[14px] px-3 py-2 text-[12px] font-semibold break-words", tone === "green" ? "bg-[rgba(37,211,102,0.14)] text-[var(--wa-green-dark)]" : "bg-white text-[var(--marketing-muted)]")}>
      {children}
    </div>
  );
}

function MiniBadge({ label, tone }: { label: string; tone: "dark" | "green" | "warm" }) {
  const toneClass = tone === "green"
    ? "bg-[rgba(37,211,102,0.12)] text-[var(--wa-green-dark)]"
    : tone === "warm"
      ? "bg-[rgba(255,122,26,0.14)] text-[var(--warm-accent)]"
      : "bg-[rgba(7,94,84,0.1)] text-[var(--wa-green-dark)]";

  return <div className={cn("inline-flex rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em]", toneClass)}>{label}</div>;
}

function MiniLine({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] border border-[rgba(7,94,84,0.08)] bg-white px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-[11px] font-semibold text-[var(--marketing-muted)] sm:text-[12px]">{left}</span>
      <span className="min-w-0 max-w-[52%] break-words text-right text-[11px] font-bold text-[var(--marketing-text)] sm:text-[12px]">{right}</span>
    </div>
  );
}

function SectionIntro({
  overline,
  subtitle,
  title,
}: {
  overline: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--wa-green-dark)]">{overline}</p>
      <h2 className="mt-4 text-[2.25rem] font-extrabold leading-[1.02] tracking-[-0.05em] text-[var(--marketing-text)] sm:text-[3rem]">
        {title}
      </h2>
      <p className="mt-4 text-[15px] leading-8 text-[var(--marketing-muted)] sm:text-base">{subtitle}</p>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--marketing-muted)]">{label}</span>
      {children}
    </label>
  );
}
