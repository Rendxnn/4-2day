import { useEffect, useState } from "react";
import {
  BarChart3,
  Camera,
  ExternalLink,
  Globe2,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Save,
  Share2,
  Users,
} from "lucide-react";
import type {
  RestaurantPublicProfileSettings,
  UpdateRestaurantPublicProfileSettingsRequest,
} from "@42day/types";
import {
  getRestaurantPublicProfileSettings,
  updateRestaurantPublicProfileSettings,
} from "../../api";

const emptySettings: UpdateRestaurantPublicProfileSettingsRequest = {
  profileEnabled: true,
};

export function RestaurantPublicProfileSection({
  locale,
  onNotify,
  tenantSlug,
}: {
  locale: "en" | "es";
  onNotify: (message: string) => void;
  tenantSlug: string;
}) {
  const [settings, setSettings] = useState<RestaurantPublicProfileSettings>();
  const [form, setForm] = useState<UpdateRestaurantPublicProfileSettingsRequest>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getRestaurantPublicProfileSettings(tenantSlug)
      .then((snapshot) => {
        if (!active) return;
        setSettings(snapshot);
        setForm(toForm(snapshot));
        setError("");
      })
      .catch(() => {
        if (active) setError(locale === "en" ? "The public page settings could not be loaded." : "No se pudo cargar la configuración de la página pública.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, tenantSlug]);

  function patch<K extends keyof UpdateRestaurantPublicProfileSettingsRequest>(
    key: K,
    value: UpdateRestaurantPublicProfileSettingsRequest[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateRestaurantPublicProfileSettings(tenantSlug, form);
      setSettings(updated);
      setForm(toForm(updated));
      onNotify(locale === "en" ? "Public page saved." : "Página pública guardada.");
    } catch {
      setError(locale === "en"
        ? "Check phone numbers and links before saving."
        : "Revisa los teléfonos y enlaces antes de guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-[rgba(255,242,227,0.12)] bg-[rgba(255,250,244,0.88)] shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
      <div className="bg-[linear-gradient(135deg,#19130f,#3b291f)] p-5 text-white sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#f5ad78]">
              {locale === "en" ? "Shareable restaurant page" : "Página compartible del restaurante"}
            </p>
            <h2 className="app-display mt-2 text-[2.25rem] leading-none sm:text-[2.8rem]">
              {locale === "en" ? "Menu, contact and social media" : "Carta, contacto y redes sociales"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/62">
              {locale === "en"
                ? "Create one link for the menu, WhatsApp, social media, directions and the future service survey."
                : "Reúne en un solo enlace la carta, WhatsApp, redes, cómo llegar y la futura encuesta de servicio."}
            </p>
          </div>
          {settings && (
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-bold transition hover:bg-white/16" href={settings.publicUrlPath} rel="noreferrer" target="_blank">
                <ExternalLink size={15} />
                {locale === "en" ? "Preview page" : "Ver página"}
              </a>
              <a className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#ef7d32] px-4 text-sm font-bold transition hover:brightness-110" href={settings.cartaUrlPath} rel="noreferrer" target="_blank">
                <ExternalLink size={15} />
                {locale === "en" ? "Open menu" : "Abrir carta"}
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-7">
        {loading ? (
          <div className="grid min-h-40 place-items-center text-[var(--text-soft)]">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <>
            <label className="flex items-center justify-between gap-4 rounded-[20px] border border-[#eadfd4] bg-white/72 p-4">
              <span>
                <span className="block text-sm font-extrabold text-[var(--text-strong)]">
                  {locale === "en" ? "Publish restaurant page" : "Publicar página del restaurante"}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-soft)]">
                  {locale === "en" ? "When disabled, the public link will not be available." : "Al desactivarla, el enlace público dejará de estar disponible."}
                </span>
              </span>
              <input
                checked={form.profileEnabled}
                className="h-5 w-5 accent-[#df6e2e]"
                onChange={(event) => patch("profileEnabled", event.target.checked)}
                type="checkbox"
              />
            </label>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField icon={Share2} label={locale === "en" ? "Short introduction" : "Mensaje de bienvenida"} onChange={(value) => patch("headline", value)} placeholder="Comida al barril, hamburguesas y momentos para compartir." value={form.headline} wide />
              <ProfileField icon={Phone} label={locale === "en" ? "Phone" : "Teléfono para llamadas"} onChange={(value) => patch("contactPhone", value)} placeholder="+57 300 000 0000" value={form.contactPhone} />
              <ProfileField icon={MessageCircle} label="WhatsApp" onChange={(value) => patch("whatsappPhone", value)} placeholder="+57 300 000 0000" value={form.whatsappPhone} />
              <ProfileField icon={Camera} label="Instagram" onChange={(value) => patch("instagramUrl", value)} placeholder="@restaurante o enlace" value={form.instagramUrl} />
              <ProfileField icon={Users} label="Facebook" onChange={(value) => patch("facebookUrl", value)} placeholder="facebook.com/restaurante" value={form.facebookUrl} />
              <ProfileField icon={Globe2} label="TikTok" onChange={(value) => patch("tiktokUrl", value)} placeholder="@restaurante o enlace" value={form.tiktokUrl} />
              <ProfileField icon={Globe2} label={locale === "en" ? "Website" : "Sitio web adicional"} onChange={(value) => patch("websiteUrl", value)} placeholder="https://..." value={form.websiteUrl} />
              <ProfileField icon={MapPin} label={locale === "en" ? "Directions link (optional)" : "Enlace de cómo llegar (opcional)"} onChange={(value) => patch("mapsUrl", value)} placeholder="Google Maps o Waze; si queda vacío usamos la ubicación guardada" value={form.mapsUrl} />
              <ProfileField icon={BarChart3} label={locale === "en" ? "Service survey (optional)" : "Encuesta de servicio (opcional)"} onChange={(value) => patch("surveyUrl", value)} placeholder="Enlace de Google Forms cuando esté listo" value={form.surveyUrl} wide />
            </div>

            <div className="mt-5 rounded-[18px] bg-[#f3e9df] px-4 py-3 text-xs leading-5 text-[#806652]">
              {locale === "en"
                ? "The survey button is already part of the public page. Until a Forms link is saved, it appears as coming soon and cannot be clicked."
                : "El botón de encuesta ya forma parte de la página. Mientras no guardes un enlace de Forms, aparecerá como próximamente y no se podrá pulsar."}
            </div>

            {error && <p className="mt-4 text-sm font-semibold text-[#a94f43]">{error}</p>}
            <button
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#241b16] px-5 text-sm font-extrabold text-white transition hover:bg-[#39291f] disabled:opacity-55 sm:w-auto"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {locale === "en" ? "Save public page" : "Guardar página pública"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ProfileField({
  icon: Icon,
  label,
  onChange,
  placeholder,
  value,
  wide = false,
}: {
  icon: typeof Phone;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value?: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "md:col-span-2" : undefined}>
      <span className="mb-2 flex items-center gap-2 text-xs font-extrabold text-[var(--text-strong)]">
        <Icon size={14} />
        {label}
      </span>
      <input
        className="h-12 w-full rounded-2xl border border-[#e6d9cc] bg-white/80 px-4 text-sm text-[var(--text-strong)] outline-none transition placeholder:text-[#a99583] focus:border-[#d77b48] focus:ring-4 focus:ring-[#e7996b]/10"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value ?? ""}
      />
    </label>
  );
}

function toForm(settings: RestaurantPublicProfileSettings): UpdateRestaurantPublicProfileSettingsRequest {
  const {
    locationId: _locationId,
    publicUrlPath: _publicUrlPath,
    cartaUrlPath: _cartaUrlPath,
    ...form
  } = settings;
  return form;
}
