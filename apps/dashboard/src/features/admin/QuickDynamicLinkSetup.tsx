import { DynamicLinkValidationError, parseDynamicLinkReference } from "@42day/core";
import { Check, Clipboard, Loader2, QrCode, ScanLine, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { DashboardApiError, getDynamicLinkByCode, quickConfigureDynamicLink } from "../../api";
import type { AdminRestaurant, DynamicLinkUnit } from "../../api";
import { DynamicLinkQrScanner } from "./DynamicLinkQrScanner";
import { formatDynamicLinkLookupFailure } from "./dynamicLinkQuickSetupErrors";

type AssociationChoice = "preserve" | "clear" | string;
type Phase = "scan" | "manual" | "resolving" | "form" | "confirm" | "saving" | "success" | "archived";

type Props = {
  restaurants: AdminRestaurant[];
  onClose: () => void;
  onUpdated: (unit: DynamicLinkUnit) => void;
};

const permanentBaseUrl = "https://go.thaledon.com";

export function QuickDynamicLinkSetup({ restaurants, onClose, onUpdated }: Props) {
  const [phase, setPhase] = useState<Phase>("scan");
  const [unit, setUnit] = useState<DynamicLinkUnit>();
  const [reference, setReference] = useState("");
  const [label, setLabel] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [association, setAssociation] = useState<AssociationChoice>("preserve");
  const [error, setError] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const resolveReference = useCallback(async (value: string) => {
    setReference(value.slice(0, 500));
    setPhase("resolving");
    setError("");
    try {
      const code = parseDynamicLinkReference(value, permanentBaseUrl);
      const result = await getDynamicLinkByCode(code);
      setUnit(result.unit);
      setLabel(result.unit.label);
      setDestinationUrl(result.unit.destinationUrl ?? "");
      setAssociation("preserve");
      setCopyFailed(false);
      setCopied(false);
      setPhase(result.unit.status === "archived" ? "archived" : "form");
    } catch (resolveError) {
      setError(formatResolveError(resolveError));
      setPhase("manual");
    }
  }, []);

  function requestSave() {
    if (!unit) return;
    if (!label.trim()) { setError("La etiqueta o nombre del lugar es obligatoria."); return; }
    try {
      const url = new URL(destinationUrl.trim());
      if (url.protocol !== "https:") throw new Error("invalid");
    } catch {
      setError("Usa una URL HTTPS válida para el destino.");
      return;
    }
    setError("");
    if (unit.status === "active" && hasDestinationChanged(unit.destinationUrl, destinationUrl)) {
      setPhase("confirm");
      return;
    }
    void save();
  }

  async function save() {
    if (!unit) return;
    setPhase("saving");
    setError("");
    try {
      const result = await quickConfigureDynamicLink(unit.id, {
        revision: unit.revision,
        label: label.trim(),
        destinationUrl: destinationUrl.trim(),
        ...(association === "preserve" ? {} : { tenantId: association === "clear" ? null : association }),
      });
      setUnit(result.unit);
      onUpdated(result.unit);
      setCopyFailed(false);
      setCopied(false);
      setPhase("success");
    } catch (saveError) {
      setError(formatError(saveError));
      setPhase("form");
    }
  }

  async function copyNfcLink() {
    if (!unit) return;
    try {
      await navigator.clipboard.writeText(unit.publicUrl);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  }

  function scanAnother() {
    setUnit(undefined);
    setReference("");
    setLabel("");
    setDestinationUrl("");
    setAssociation("preserve");
    setError("");
    setCopyFailed(false);
    setCopied(false);
    setPhase("scan");
  }

  const isWorking = phase === "resolving" || phase === "saving";
  return <div aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-[var(--surface-base)]" role="dialog">
    <div className="mx-auto min-h-full w-full max-w-xl px-4 pb-28 pt-5 sm:px-6">
      <div className="flex items-center justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Inventario físico</p><h2 className="mt-1 text-2xl font-extrabold text-[var(--text-strong)]">Configuración rápida</h2></div><button aria-label="Cerrar configuración rápida" className="grid h-11 w-11 place-items-center rounded-xl border border-[rgba(118,93,71,0.14)]" onClick={onClose} type="button"><X size={20} /></button></div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">Escanea la unidad que tienes en la mano. El lector no abre el enlace ni guarda imágenes de cámara.</p>

      {phase === "scan" && <><div className="mt-6"><DynamicLinkQrScanner onDetected={(value) => void resolveReference(value)} onUnavailable={() => setPhase("manual")} /></div><button className="mt-4 w-full rounded-xl border border-[rgba(118,93,71,0.14)] px-4 py-3 text-sm font-bold" onClick={() => setPhase("manual")} type="button">Pegar enlace o escribir código</button></>}
      {(phase === "manual" || phase === "resolving") && <div className="mt-6 rounded-2xl border border-[rgba(118,93,71,0.14)] bg-white p-4"><label className="block text-sm font-bold text-[var(--text-strong)]">Enlace permanente o código<input autoCapitalize="characters" className="mt-2 h-12 w-full rounded-xl border border-[rgba(118,93,71,0.16)] px-3 font-mono text-sm" disabled={phase === "resolving"} onChange={(event) => setReference(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void resolveReference(reference); }} placeholder="go.thaledon.com/r/ABC…" value={reference} /></label><button className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--text-strong)] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={!reference.trim() || phase === "resolving"} onClick={() => void resolveReference(reference)} type="button">{phase === "resolving" ? <Loader2 className="animate-spin" size={17} /> : <ScanLine size={17} />}Buscar unidad</button><button className="mt-3 w-full text-sm font-bold text-[var(--text-soft)] underline" onClick={() => setPhase("scan")} type="button">Usar cámara</button></div>}
      {phase === "archived" && <StateCard><p className="font-bold text-[var(--text-strong)]">{unit?.publicCode} está archivada.</p><p className="mt-2 text-sm text-[var(--text-soft)]">Las unidades archivadas no se pueden cambiar desde configuración rápida.</p><button className="mt-5 w-full rounded-xl bg-[var(--text-strong)] px-4 py-3 text-sm font-bold text-white" onClick={scanAnother} type="button">Escanear otra</button></StateCard>}
      {(phase === "form" || phase === "saving" || phase === "confirm") && unit && <div className="mt-6 space-y-4"><div className="rounded-2xl bg-white p-4 shadow-sm"><p className="font-mono text-sm font-bold text-[var(--text-strong)]">{unit.publicCode}</p><p className="mt-1 break-all text-xs text-[var(--text-soft)]">{unit.publicUrl}</p><p className="mt-3 text-sm text-[var(--text-soft)]">Estado: <span className="font-bold text-[var(--text-strong)]">{unit.status}</span> · Negocio: <span className="font-bold text-[var(--text-strong)]">{restaurants.find((restaurant) => restaurant.id === unit.tenantId)?.name ?? "Sin asignar"}</span></p></div><label className="block text-sm font-bold text-[var(--text-strong)]">Etiqueta o nombre del lugar<input className="mt-2 h-12 w-full rounded-xl border border-[rgba(118,93,71,0.16)] px-3 text-base font-normal" disabled={isWorking} onChange={(event) => setLabel(event.target.value)} value={label} /></label><label className="block text-sm font-bold text-[var(--text-strong)]">URL destino<input className="mt-2 h-12 w-full rounded-xl border border-[rgba(118,93,71,0.16)] px-3 text-base font-normal" disabled={isWorking} inputMode="url" onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://…" value={destinationUrl} /></label><label className="block text-sm font-bold text-[var(--text-strong)]">Negocio <span className="font-normal text-[var(--text-soft)]">(opcional)</span><select className="mt-2 h-12 w-full rounded-xl border border-[rgba(118,93,71,0.16)] bg-white px-3 text-base font-normal" disabled={isWorking} onChange={(event) => setAssociation(event.target.value)} value={association}><option value="preserve">Mantener: {restaurants.find((restaurant) => restaurant.id === unit.tenantId)?.name ?? "sin asignar"}</option><option value="clear">Sin asignar</option>{restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label>{phase === "confirm" && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm"><p className="font-bold">Vas a cambiar el destino de una unidad activa.</p><p className="mt-2 break-all text-[var(--text-soft)]"><span className="font-semibold">Actual:</span> {unit.destinationUrl}</p><p className="mt-2 break-all text-[var(--text-soft)]"><span className="font-semibold">Nuevo:</span> {destinationUrl.trim()}</p><div className="mt-4 grid grid-cols-2 gap-3"><button className="rounded-xl border px-3 py-3 font-bold" onClick={() => setPhase("form")} type="button">Cancelar</button><button className="rounded-xl bg-[var(--text-strong)] px-3 py-3 font-bold text-white" onClick={() => void save()} type="button">Confirmar</button></div></div>}{phase !== "confirm" && <button className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[var(--text-strong)] px-4 py-3 text-base font-bold text-white disabled:opacity-60" disabled={isWorking} onClick={requestSave} type="button">{isWorking ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}Guardar y activar</button>}</div>}
      {phase === "success" && unit && <StateCard><div className="flex items-center gap-2 text-[var(--success)]"><Check size={21} /><p className="font-bold">Unidad activada y guardada.</p></div><p className="mt-4 text-sm text-[var(--text-soft)]">Programa este mismo enlace en el chip NFC.</p><code className="mt-3 block break-all rounded-xl bg-[var(--surface-base)] p-3 text-sm font-bold text-[var(--text-strong)]">{unit.publicUrl}</code><button className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--text-strong)] px-4 text-sm font-bold text-white" onClick={() => void copyNfcLink()} type="button"><Clipboard size={17} />Copiar enlace para NFC</button>{copied && <p aria-live="polite" className="mt-3 text-sm font-semibold text-[var(--success)]">Enlace copiado para programar el NFC.</p>}{copyFailed && <><p className="mt-3 text-sm text-[#9a4b43]">No se pudo usar el portapapeles. Selecciona y copia el enlace manualmente.</p><input aria-label="Enlace para NFC" className="mt-2 h-12 w-full rounded-xl border px-3 font-mono text-xs" readOnly value={unit.publicUrl} onFocus={(event) => event.currentTarget.select()} /></>}<button className="mt-4 w-full rounded-xl border border-[rgba(118,93,71,0.14)] px-4 py-3 text-sm font-bold" onClick={scanAnother} type="button"><QrCode className="mr-2 inline" size={17} />Escanear otra</button></StateCard>}
      {error && <p aria-live="assertive" className="mt-5 rounded-xl bg-[rgba(190,110,95,0.12)] px-3 py-3 text-sm font-semibold text-[#9a4b43]">{error}</p>}
    </div>
  </div>;
}

function StateCard({ children }: { children: ReactNode }) { return <div className="mt-6 rounded-2xl border border-[rgba(118,93,71,0.14)] bg-white p-5">{children}</div>; }
function hasDestinationChanged(current: string | undefined, next: string) { try { return new URL(current ?? "").toString() !== new URL(next.trim()).toString(); } catch { return current?.trim() !== next.trim(); } }
function formatResolveError(error: unknown) {
  if (error instanceof DynamicLinkValidationError) return "El QR no contiene un código válido ni una URL propia de go.thaledon.com/r/CÓDIGO.";
  if (!(error instanceof DashboardApiError)) return "No fue posible consultar la unidad por un error de red. Inténtalo otra vez.";
  return formatDynamicLinkLookupFailure(error);
}
function formatError(error: unknown) { if (error instanceof DashboardApiError) { if (error.backendError === "dynamic_link_stale") return "Esta unidad cambió en otra sesión. Vuelve a escanearla antes de guardar."; if (error.backendError === "dynamic_link_archived") return "La unidad fue archivada y no puede modificarse."; return "No se pudo guardar. Revisa la URL destino e inténtalo de nuevo."; } return "No se pudo guardar por un error de red. Inténtalo de nuevo."; }
