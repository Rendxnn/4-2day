import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Camera,
  ChevronRight,
  Globe2,
  Loader2,
  MapPin,
  MessageCircle,
  Music2,
  Phone,
  Share2,
  Utensils,
  Users,
} from "lucide-react";
import type { RestaurantPublicProfilePayload } from "@42day/types";
import { getPublicRestaurantProfile } from "../../api";

export function PublicRestaurantProfilePage({ tenantSlug }: { tenantSlug: string }) {
  const [profile, setProfile] = useState<RestaurantPublicProfilePayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const previousTitle = document.title;
    setLoading(true);
    getPublicRestaurantProfile(tenantSlug)
      .then((payload) => {
        if (!active) return;
        setProfile(payload);
        setError("");
        document.title = `${payload.tenant.name} | Carta y contacto`;
      })
      .catch(() => {
        if (active) setError("Esta página todavía no está disponible.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      document.title = previousTitle;
    };
  }, [tenantSlug]);

  async function share() {
    const shareData = {
      title: profile?.tenant.name ?? "Restaurante",
      text: "Consulta nuestra carta, redes y cómo llegar.",
      url: window.location.href,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  if (loading) {
    return <ProfileState icon={Loader2} message="Preparando la página del restaurante…" spinning />;
  }
  if (error || !profile) {
    return <ProfileState icon={MapPin} message={error || "Página no disponible."} />;
  }

  const links = [
    { key: "menu", label: "Ver menú digital", description: "Explora los platos disponibles hoy", href: profile.links.cartaUrlPath, icon: Utensils, accent: true },
    profile.links.phoneUrl ? { key: "phone", label: "Llamar por teléfono", description: "Habla directamente con el restaurante", href: profile.links.phoneUrl, icon: Phone } : undefined,
    profile.links.whatsappUrl ? { key: "whatsapp", label: "Escríbenos por WhatsApp", description: profile.experience.mode === "connected" ? "Pregunta o empieza tu pedido" : "Contacta directamente al restaurante", href: profile.links.whatsappUrl, icon: MessageCircle } : undefined,
    profile.links.instagramUrl ? { key: "instagram", label: "Síguenos en Instagram", description: "Novedades, platos y momentos", href: profile.links.instagramUrl, icon: Camera } : undefined,
    profile.links.facebookUrl ? { key: "facebook", label: "Encuéntranos en Facebook", description: "Conoce más del restaurante", href: profile.links.facebookUrl, icon: Users } : undefined,
    profile.links.tiktokUrl ? { key: "tiktok", label: "Síguenos en TikTok", description: "Mira lo que estamos preparando", href: profile.links.tiktokUrl, icon: Music2 } : undefined,
    profile.links.websiteUrl ? { key: "website", label: "Visita nuestro sitio web", description: "Más información del restaurante", href: profile.links.websiteUrl, icon: Globe2 } : undefined,
    profile.links.mapsUrl ? { key: "maps", label: "Cómo llegar", description: profile.location.address || profile.location.name, href: profile.links.mapsUrl, icon: MapPin } : undefined,
  ].filter((link): link is NonNullable<typeof link> => Boolean(link));

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#17110d] px-4 py-7 text-[#261d18] sm:px-6 sm:py-10">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(238,127,57,0.25),transparent_34%),radial-gradient(circle_at_90%_70%,rgba(103,64,42,0.24),transparent_36%),linear-gradient(160deg,#211711,#0d0a08)]" />
      <main className="relative mx-auto w-full max-w-[620px]">
        <section className="overflow-hidden rounded-[38px] border border-white/15 bg-[rgba(255,249,242,0.96)] shadow-[0_35px_120px_rgba(0,0,0,0.48)]">
          <header className="relative overflow-hidden bg-[linear-gradient(145deg,#f9eadb,#fffaf4)] px-6 pb-7 pt-8 text-center sm:px-9">
            <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#ee7a35]/16 blur-3xl" />
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-[30px] border border-[#edd8c5] bg-white shadow-[0_18px_45px_rgba(79,43,23,0.14)]">
              <img alt="ParaHoy" className="h-[78px] w-[78px] object-contain" src="/logo-sin-fondo.png" />
            </div>
            <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#ad7652]">{profile.location.name}</p>
            <h1 className="app-display mt-2 text-[3.25rem] leading-[0.88] tracking-[-0.05em] text-[#241a15] sm:text-[4.1rem]">{profile.tenant.name}</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#7e6758]">
              {profile.headline || "Nuestra carta, redes y toda la información para visitarnos en un solo lugar."}
            </p>
          </header>

          <div className="space-y-3 px-4 py-5 sm:px-7 sm:py-7">
            {links.map((link) => (
              <ProfileLink {...link} key={link.key} />
            ))}

            <div className="px-2 pb-1 pt-5 text-center">
              <p className="app-display text-[2rem] leading-none text-[#34251d]">Ayúdanos a mejorar</p>
              <p className="mt-2 text-xs leading-5 text-[#8b7262]">Tu opinión nos ayuda a servirte cada vez mejor.</p>
            </div>

            {profile.links.surveyUrl ? (
              <ProfileLink
                description="Cuéntanos cómo fue tu experiencia"
                href={profile.links.surveyUrl}
                icon={BarChart3}
                key="survey"
                label="Encuesta de servicio"
              />
            ) : (
              <div className="flex items-center gap-4 rounded-[22px] border border-dashed border-[#ddcfc2] bg-[#f3ece5] px-4 py-4 text-[#9a8677]">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/70"><BarChart3 size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">Encuesta de servicio</span>
                  <span className="mt-0.5 block text-xs">Próximamente</span>
                </span>
              </div>
            )}

            <button className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-[#9b5b36] transition hover:bg-[#f3e7dc]" onClick={() => void share()} type="button">
              <Share2 size={16} />
              {copied ? "Enlace copiado" : "Compartir esta página"}
            </button>
          </div>
        </section>
        <p className="py-5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">Impulsado por ParaHoy</p>
      </main>
    </div>
  );
}

function ProfileLink({
  accent,
  description,
  href,
  icon: Icon,
  label,
}: {
  accent?: boolean;
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  const external = /^https?:\/\//i.test(href);
  return (
    <a
      className={`group flex items-center gap-4 rounded-[22px] border px-4 py-4 shadow-[0_12px_30px_rgba(62,38,24,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(62,38,24,0.11)] ${accent ? "border-[#e97a3b] bg-[linear-gradient(135deg,#ef7c37,#d95721)] text-white" : "border-[#eadfd5] bg-white/86 text-[#33251e]"}`}
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${accent ? "bg-white/16" : "bg-[#f5e9de] text-[#d86227]"}`}><Icon size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold">{label}</span>
        <span className={`mt-0.5 block truncate text-xs ${accent ? "text-white/72" : "text-[#8a7262]"}`}>{description}</span>
      </span>
      <ChevronRight className="shrink-0 transition group-hover:translate-x-0.5" size={18} />
    </a>
  );
}

function ProfileState({ icon: Icon, message, spinning = false }: { icon: LucideIcon; message: string; spinning?: boolean }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#17110d] px-6 text-center text-white">
      <div>
        <Icon className={`mx-auto text-[#ef7d32] ${spinning ? "animate-spin" : ""}`} size={28} />
        <p className="mt-4 text-sm font-semibold text-white/68">{message}</p>
      </div>
    </div>
  );
}
