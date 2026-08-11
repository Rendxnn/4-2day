import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem } from "@42day/types";
import { ArrowLeft, Check, Loader2, MessageCircle, Minus, Plus, Send, Sparkles, X } from "lucide-react";
import { askPublicCartaConcierge } from "../../api";
import { resolveCartaRecommendationIds } from "./recommendations";

type ConciergeMessage = {
  id: string;
  role: "visitor" | "assistant";
  text: string;
  recommendedItemIds?: string[];
};

type ConciergePromptRequest = {
  id: string;
  text: string;
};

type PublicCartaConciergeProps = {
  menuItems: MenuItem[];
  onDismissProactiveItem: () => void;
  promptRequest?: ConciergePromptRequest;
  proactiveItem?: MenuItem;
  restaurantName?: string;
  tenantSlug: string;
};

const QUICK_QUESTIONS = [
  "¿Qué me recomiendas hoy?",
  "¿Cuál plato alcanza para compartir?",
  "¿Qué opción combina mejor con una bebida?",
];

export function PublicCartaConcierge({
  menuItems,
  onDismissProactiveItem,
  promptRequest,
  proactiveItem,
  restaurantName,
  tenantSlug,
}: PublicCartaConciergeProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [inspectedItem, setInspectedItem] = useState<MenuItem>();
  const [messages, setMessages] = useState<ConciergeMessage[]>(() => [buildWelcomeMessage(restaurantName)]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledPromptRef = useRef<string | undefined>(undefined);
  const menuItemById = useMemo(() => new Map(menuItems.map((item) => [item.id, item])), [menuItems]);

  useEffect(() => {
    setMessages((current) => current.length === 1 && current[0]?.id === "welcome"
      ? [buildWelcomeMessage(restaurantName)]
      : current);
  }, [restaurantName]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open, sending]);

  useEffect(() => {
    if (!promptRequest || handledPromptRef.current === promptRequest.id) return;
    handledPromptRef.current = promptRequest.id;
    setOpen(true);
    setDraft(promptRequest.text);
    window.setTimeout(() => textareaRef.current?.focus(), 120);
  }, [promptRequest]);

  async function send(question: string) {
    const text = question.trim().replace(/\s+/g, " ");
    if (text.length < 2 || sending) return;

    const visitorMessage: ConciergeMessage = { id: crypto.randomUUID(), role: "visitor", text };
    const priorHistory = messages.slice(-6).map((message) => ({
      role: message.role === "visitor" ? "visitor" as const : "assistant" as const,
      text: message.text,
    }));
    setMessages((current) => [...current, visitorMessage]);
    setDraft("");
    setError("");
    setSending(true);

    try {
      const response = await askPublicCartaConcierge(tenantSlug, {
        question: text,
        history: [...priorHistory, { role: "visitor", text }],
      });
      const recommendedItemIds = resolveCartaRecommendationIds({
        apiItemIds: response.recommendedItemIds,
        answer: response.answer,
        menuItems,
        question: text,
      });
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.answer,
        recommendedItemIds,
      }]);
    } catch {
      setError("No pude responder ahora mismo. Intenta de nuevo en un momento.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] sm:hidden" onClick={() => { setOpen(false); setInspectedItem(undefined); }} />
      )}
      <section aria-label="Mesero de la carta" className={`fixed z-50 transition duration-300 ${open ? "bottom-3 left-3 right-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-[420px]" : "bottom-5 right-5 sm:bottom-7 sm:right-7"}`}>
        {open ? (
          <div className="overflow-hidden rounded-[28px] border border-[rgba(255,242,227,0.22)] bg-[rgba(22,16,12,0.96)] shadow-[0_30px_100px_rgba(0,0,0,0.52)] backdrop-blur-2xl">
            <header className="relative overflow-hidden border-b border-white/10 bg-[linear-gradient(135deg,#ec7c2f_0%,#ce4d1e_62%,#762214_100%)] px-5 py-4 text-white">
              <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <WaiterAvatar className="h-11 w-11 rounded-2xl" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/72"><Sparkles size={11} /> Mesero experto IA</p>
                    <h2 className="truncate text-base font-extrabold">Pregunta por la carta</h2>
                  </div>
                </div>
                <button aria-label="Cerrar mesero" className="grid h-9 w-9 place-items-center rounded-xl bg-black/15 transition hover:bg-black/25" onClick={() => { setOpen(false); setInspectedItem(undefined); }} type="button"><X size={18} /></button>
              </div>
            </header>

            <div className="app-scrollbar max-h-[min(59vh,510px)] min-h-[300px] overflow-y-auto bg-[radial-gradient(circle_at_85%_0%,rgba(232,130,65,0.11),transparent_30%),#17110e] px-4 py-4">
              {inspectedItem ? (
                <ConciergeInlineProductDetail
                  item={inspectedItem}
                  onAsk={() => {
                    setDraft(`Cuéntame más sobre ${getItemName(inspectedItem)}`);
                    setInspectedItem(undefined);
                    window.setTimeout(() => textareaRef.current?.focus(), 120);
                  }}
                  onBack={() => setInspectedItem(undefined)}
                />
              ) : (
                <>
                  <div className="space-y-3">
                    {messages.map((message) => {
                      const recommendations = (message.recommendedItemIds ?? [])
                        .map((itemId) => menuItemById.get(itemId))
                        .filter((item): item is MenuItem => Boolean(item));
                      return (
                        <div key={message.id}>
                          <div className={`flex gap-2.5 ${message.role === "visitor" ? "justify-end" : "justify-start"}`}>
                            {message.role === "assistant" && <WaiterAvatar className="mt-1 h-7 w-7 rounded-[10px]" />}
                            <p className={`max-w-[84%] rounded-[18px] px-3.5 py-2.5 text-sm leading-5 ${message.role === "visitor" ? "rounded-br-md bg-[#ed7f35] font-medium text-white shadow-[0_8px_20px_rgba(126,47,12,0.22)]" : "rounded-bl-md border border-white/10 bg-[rgba(255,248,240,0.08)] text-[rgba(255,246,237,0.88)]"}`}>{message.text}</p>
                          </div>
                          {recommendations.length > 0 && (
                            <div className="ml-9 mt-2 space-y-2" aria-label="Productos recomendados">
                              {recommendations.map((item) => (
                                <ConciergeProductRow item={item} key={item.id} onInspect={() => setInspectedItem(item)} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {sending && (
                      <div className="flex items-center gap-2.5"><WaiterAvatar className="h-7 w-7 rounded-[10px]" /><p className="rounded-[18px] rounded-bl-md border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white/60"><Loader2 className="inline animate-spin" size={14} /> Pensando en algo rico…</p></div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  {messages.length === 1 && !sending && (
                    <div className="mt-4 flex flex-wrap gap-2 pl-9">
                      {QUICK_QUESTIONS.map((question) => (
                        <button className="rounded-full border border-[rgba(255,212,169,0.18)] bg-[rgba(237,127,53,0.1)] px-3 py-2 text-left text-xs font-semibold text-[rgba(255,232,211,0.92)] transition hover:bg-[rgba(237,127,53,0.18)]" key={question} onClick={() => void send(question)} type="button">{question}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <form className="border-t border-white/10 bg-[#130e0c] p-3" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
              {error && <p className="mb-2 px-1 text-xs leading-5 text-[#ffae9c]">{error}</p>}
              <div className="flex items-end gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] p-1.5 focus-within:border-[rgba(255,169,101,0.5)]">
                <textarea aria-label="Tu pregunta sobre la carta" className="max-h-24 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-white outline-none placeholder:text-white/38" disabled={sending} maxLength={420} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} placeholder="Ej. ¿Ese plato es para compartir?" ref={textareaRef} rows={1} value={draft} />
                <button aria-label="Enviar pregunta" className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[#ef7d32] text-white transition hover:brightness-110 disabled:opacity-45" disabled={sending || draft.trim().length < 2} type="submit"><Send size={16} /></button>
              </div>
              <p className="px-1 pt-2 text-[10px] leading-4 text-white/35">Pregunta con confianza: ingredientes, porciones, sabores o recomendaciones.</p>
            </form>
          </div>
        ) : (
          <div className="flex items-end gap-3">
            {proactiveItem && (
              <div className="w-[min(76vw,310px)] rounded-[22px] border border-white/20 bg-[rgba(25,18,14,0.96)] p-3.5 text-white shadow-[0_20px_64px_rgba(0,0,0,0.48)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-5">¿Te cuento qué hace especial <span className="text-[#ffab70]">{getItemName(proactiveItem)}</span>?</p>
                  <button aria-label="Ocultar sugerencia" className="text-white/45 hover:text-white" onClick={onDismissProactiveItem} type="button"><X size={15} /></button>
                </div>
                <button className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-[#ef7d32] px-3 py-2 text-xs font-extrabold transition hover:brightness-110" onClick={() => {
                  onDismissProactiveItem();
                  setOpen(true);
                  setDraft(`Cuéntame sobre ${getItemName(proactiveItem)}`);
                  window.setTimeout(() => textareaRef.current?.focus(), 120);
                }} type="button"><Sparkles size={12} /> Sí, cuéntame</button>
              </div>
            )}
            <button aria-label="Abrir mesero de la carta" className="group relative grid h-[68px] w-[68px] shrink-0 place-items-center overflow-hidden rounded-[24px] border border-[#f0d8c5] bg-[#fffaf4] text-white shadow-[0_18px_44px_rgba(36,20,12,0.52)] transition hover:-translate-y-1 hover:shadow-[0_24px_54px_rgba(36,20,12,0.64)]" onClick={() => setOpen(true)} type="button">
              <span className="absolute -inset-1 rounded-[27px] border border-[#ffbd7c]/40 opacity-0 transition group-hover:opacity-100" />
              <img alt="" aria-hidden="true" className="h-[58px] w-[58px] object-contain" src="/logo-sin-fondo.png" />
              <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#1a120e] bg-[#fff1df] text-[#d8591f]"><Sparkles size={10} /></span>
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function ConciergeProductRow({ item, onInspect }: { item: MenuItem; onInspect: () => void }) {
  const product = item.product;
  const name = getItemName(item);
  const price = item.priceOverride ?? product?.basePrice ?? 0;
  return (
    <button className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.06] p-2.5 text-left transition hover:border-[#ef9a62]/35 hover:bg-white/[0.1]" onClick={onInspect} type="button">
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#eee1d4] text-2xl">
        {product?.imageUrl ? <img alt="" className="h-full w-full object-cover" src={product.imageUrl} /> : (product?.emoji || "🍽️")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-white">{name}</span>
        <span className="mt-0.5 block text-xs font-semibold text-[#ffb47e]">{formatPrice(price)}</span>
      </span>
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#ef7d32] text-white"><Plus size={15} /></span>
      <span className="sr-only">Ver detalle de {name}</span>
    </button>
  );
}

function ConciergeInlineProductDetail({
  item,
  onAsk,
  onBack,
}: {
  item: MenuItem;
  onAsk: () => void;
  onBack: () => void;
}) {
  const product = item.product;
  const name = getItemName(item);
  const price = item.priceOverride ?? product?.basePrice ?? 0;
  const activeOptions = product?.options
    ?.map((option) => ({ ...option, values: option.values.filter((value) => value.isActive) }))
    .filter((option) => option.values.length > 0) ?? [];

  return (
    <article aria-label={`Detalle de ${name}`} className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.06]">
      <div className="relative h-40 overflow-hidden bg-[#eee1d4]">
        {product?.imageUrl ? (
          <img alt={name} className="h-full w-full object-cover" src={product.imageUrl} />
        ) : (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle,rgba(255,255,255,0.9),transparent_56%),#e7d6c3] text-6xl">
            {product?.emoji || "🍽️"}
          </div>
        )}
        <button aria-label="Volver a la conversación" className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-xl border border-white/25 bg-black/40 text-white backdrop-blur transition hover:bg-black/60" onClick={onBack} type="button">
          <ArrowLeft size={17} />
        </button>
        <span className="absolute bottom-3 right-3 rounded-xl bg-black/65 px-3 py-2 text-xs font-extrabold text-white backdrop-blur">{formatPrice(price)}</span>
      </div>
      <div className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ffad73]">{product?.category || "Carta"}</p>
        <h3 className="mt-1.5 text-xl font-extrabold tracking-[-0.03em] text-white">{name}</h3>
        <p className="mt-2 text-sm leading-6 text-white/62">{product?.description || "Disponible hoy en la carta."}</p>

        {activeOptions.length > 0 && (
          <div className="mt-4 space-y-3 rounded-[18px] border border-white/8 bg-black/15 p-3">
            {activeOptions.map((option) => (
              <div key={option.id ?? option.name}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-extrabold text-white/88">{option.name}</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-1 text-[9px] font-bold text-white/48">
                    {option.minSelect === option.maxSelect ? (
                      <><Check size={9} /> Elige {option.maxSelect}</>
                    ) : (
                      <><Minus size={8} /> {option.minSelect}<Plus size={8} /> {option.maxSelect}</>
                    )}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {option.values.slice(0, 8).map((value) => (
                    <span className="rounded-full border border-white/8 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-white/62" key={value.id ?? value.name}>
                      {value.name}{value.priceDelta > 0 ? ` +${formatPrice(value.priceDelta)}` : ""}
                    </span>
                  ))}
                  {option.values.length > 8 && <span className="px-1 py-1 text-[10px] font-semibold text-white/38">+{option.values.length - 8} opciones</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#ef7d32] px-4 py-3 text-sm font-extrabold text-white transition hover:brightness-110" onClick={onAsk} type="button">
          <MessageCircle size={15} />
          Preguntar por este plato
        </button>
      </div>
    </article>
  );
}

function buildWelcomeMessage(restaurantName: string | undefined): ConciergeMessage {
  return {
    id: "welcome",
    role: "assistant",
    text: `¡Hola! Soy el mesero digital de ${restaurantName ?? "esta carta"}. Puedo contarte qué lleva cada plato, para cuántas personas alcanza y qué combina mejor. ¿Qué se te antoja hoy?`,
  };
}

function getItemName(item: MenuItem): string {
  return item.displayName ?? item.product?.name ?? "este plato";
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

function WaiterAvatar({ className }: { className: string }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden border border-white/20 bg-[#fffaf4] shadow-[0_8px_20px_rgba(0,0,0,0.2)] ${className}`}>
      <img alt="" aria-hidden="true" className="h-[88%] w-[88%] object-contain" src="/logo-sin-fondo.png" />
    </span>
  );
}
