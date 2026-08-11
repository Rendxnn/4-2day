import { useEffect } from "react";
import type { MenuItem } from "@42day/types";
import { ChefHat, Check, MessageCircle, Minus, Plus, Sparkles, X } from "lucide-react";

type PublicCartaProductDetailProps = {
  fallbackEmoji: string;
  formatPrice: (value: number) => string;
  item: MenuItem;
  onAskWaiter: (item: MenuItem) => void;
  onClose: () => void;
};

export function PublicCartaProductDetail({
  fallbackEmoji,
  formatPrice,
  item,
  onAskWaiter,
  onClose,
}: PublicCartaProductDetailProps) {
  const product = item.product;
  const name = item.displayName ?? product?.name ?? "Producto";
  const price = item.priceOverride ?? product?.basePrice ?? 0;
  const activeOptions = product?.options
    ?.map((option) => ({ ...option, values: option.values.filter((value) => value.isActive) }))
    .filter((option) => option.values.length > 0) ?? [];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-labelledby="carta-product-title"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <article className="app-scrollbar max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-[34px] border border-white/15 bg-[#f8f1e8] shadow-[0_40px_140px_rgba(0,0,0,0.62)] sm:max-h-[88vh] sm:rounded-[38px]">
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-[300px] overflow-hidden bg-[#e8d9c7] sm:min-h-[390px]">
            {product?.imageUrl ? (
              <img alt={name} className="absolute inset-0 h-full w-full object-cover" src={product.imageUrl} />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.72),transparent_50%),linear-gradient(145deg,#f6ede2,#d8c1a8)]">
                <span aria-label={name} className="text-[7rem] drop-shadow-[0_22px_40px_rgba(46,31,21,0.18)]" role="img">{product?.emoji || fallbackEmoji}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent p-6 pt-20 text-white">
              <p className="inline-flex rounded-full border border-white/20 bg-black/20 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] backdrop-blur">
                {product?.category || "Carta"}
              </p>
            </div>
            <button
              aria-label="Cerrar detalle"
              className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-2xl border border-white/25 bg-black/35 text-white backdrop-blur transition hover:bg-black/55"
              onClick={onClose}
              type="button"
            >
              <X size={19} />
            </button>
          </div>

          <div className="p-6 sm:p-8 lg:p-9">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#9a684b]">
                  <Sparkles size={12} />
                  Detalle del plato
                </p>
                <h2 className="app-display mt-3 text-[2.6rem] leading-[0.94] tracking-[-0.055em] text-[#261b15] sm:text-[3.25rem]" id="carta-product-title">{name}</h2>
              </div>
              <p className="shrink-0 rounded-2xl bg-[#241a15] px-4 py-2.5 text-sm font-extrabold text-white">{formatPrice(price)}</p>
            </div>

            <p className="mt-5 text-[15px] leading-7 text-[#78675c]">
              {product?.description || "Disponible hoy. Pregúntale al mesero de la carta si quieres conocer más detalles antes de elegir."}
            </p>

            {activeOptions.length > 0 && (
              <div className="mt-6 space-y-4 rounded-[26px] border border-[#dfd1c2] bg-white/60 p-5">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#9a806f]">Opciones del plato</p>
                {activeOptions.map((option) => (
                  <div key={option.id ?? option.name}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-extrabold text-[#2d211a]">{option.name}</p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#eee3d7] px-2.5 py-1 text-[10px] font-bold text-[#785f4e]">
                        {option.minSelect === option.maxSelect ? (
                          <><Check size={10} /> Elige {option.maxSelect}</>
                        ) : (
                          <>
                            <Minus size={9} /> {option.minSelect}
                            <Plus size={9} /> {option.maxSelect}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {option.values.map((value) => (
                        <span className="rounded-full border border-[#e4d6c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#705f54]" key={value.id ?? value.name}>
                          {value.name}{value.priceDelta > 0 ? ` +${formatPrice(value.priceDelta)}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              className="mt-7 flex w-full items-center justify-between rounded-[22px] bg-[#211713] px-5 py-4 text-left text-white shadow-[0_18px_40px_rgba(41,25,16,0.22)] transition hover:-translate-y-0.5 hover:bg-[#34231a]"
              onClick={() => onAskWaiter(item)}
              type="button"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#ef7d32]"><ChefHat size={19} /></span>
                <span>
                  <span className="block text-sm font-extrabold">Preguntarle al mesero</span>
                  <span className="mt-0.5 block text-xs text-white/58">Ingredientes, porciones, combinaciones o recomendaciones</span>
                </span>
              </span>
              <MessageCircle className="shrink-0 text-[#ffad73]" size={19} />
            </button>

            <p className="mt-3 text-center text-[11px] leading-5 text-[#9a887b]">
              El mesero digital puede ayudarte con ingredientes, porciones y recomendaciones.
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}
