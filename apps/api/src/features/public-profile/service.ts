import type {
  RestaurantPublicProfilePayload,
  RestaurantPublicProfileSettings,
  UpdateRestaurantPublicProfileSettingsRequest,
} from "@42day/types";
import type { LocationRow, TenantRow } from "../dashboard/types";

const MAX_URL_LENGTH = 600;
const MAX_HEADLINE_LENGTH = 180;

export function mapRestaurantPublicProfileSettings(
  location: LocationRow,
  tenantSlug: string,
): RestaurantPublicProfileSettings {
  return {
    locationId: location.id,
    profileEnabled: location.public_profile_enabled !== false,
    headline: optional(location.public_profile_headline),
    contactPhone: optional(location.phone),
    whatsappPhone: optional(location.whatsapp_contact),
    instagramUrl: optional(location.instagram_url),
    facebookUrl: optional(location.facebook_url),
    tiktokUrl: optional(location.tiktok_url),
    websiteUrl: optional(location.website_url),
    mapsUrl: optional(location.maps_url),
    surveyUrl: optional(location.survey_url),
    publicUrlPath: `/r/${tenantSlug}`,
    cartaUrlPath: `/carta?tenant=${encodeURIComponent(tenantSlug)}`,
  };
}

export function parseRestaurantPublicProfileSettingsUpdate(
  value: unknown,
): UpdateRestaurantPublicProfileSettingsRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.profileEnabled !== "boolean") return undefined;

  try {
    return {
      profileEnabled: input.profileEnabled,
      headline: parseOptionalText(input.headline, MAX_HEADLINE_LENGTH),
      contactPhone: parseOptionalPhone(input.contactPhone),
      whatsappPhone: parseOptionalPhone(input.whatsappPhone),
      instagramUrl: parseSocialUrl(input.instagramUrl, "instagram.com"),
      facebookUrl: parseSocialUrl(input.facebookUrl, "facebook.com"),
      tiktokUrl: parseSocialUrl(input.tiktokUrl, "tiktok.com"),
      websiteUrl: parseOptionalUrl(input.websiteUrl),
      mapsUrl: parseOptionalUrl(input.mapsUrl),
      surveyUrl: parseOptionalUrl(input.surveyUrl),
    };
  } catch {
    return undefined;
  }
}

export function buildRestaurantPublicProfilePayload(
  tenant: TenantRow,
  location: LocationRow,
): RestaurantPublicProfilePayload {
  const settings = mapRestaurantPublicProfileSettings(location, tenant.slug);
  return {
    tenant: {
      name: tenant.name ?? tenant.slug,
      slug: tenant.slug,
    },
    experience: {
      mode: tenant.automation_enabled === false ? "standalone" : "connected",
      whatsappAutomationEnabled: tenant.automation_enabled !== false,
    },
    headline: settings.headline,
    location: {
      name: location.name,
      address: optional(location.address),
    },
    links: {
      cartaUrlPath: settings.cartaUrlPath,
      phoneUrl: buildPhoneUrl(settings.contactPhone),
      whatsappUrl: buildWhatsappUrl(settings.whatsappPhone),
      instagramUrl: settings.instagramUrl,
      facebookUrl: settings.facebookUrl,
      tiktokUrl: settings.tiktokUrl,
      websiteUrl: settings.websiteUrl,
      mapsUrl: settings.mapsUrl ?? buildMapsUrl(location),
      surveyUrl: settings.surveyUrl,
    },
  };
}

export function toRestaurantPublicProfileDatabaseValues(
  input: UpdateRestaurantPublicProfileSettingsRequest,
) {
  return {
    public_profile_enabled: input.profileEnabled,
    public_profile_headline: input.headline ?? null,
    phone: input.contactPhone ?? null,
    whatsapp_contact: input.whatsappPhone ?? null,
    instagram_url: input.instagramUrl ?? null,
    facebook_url: input.facebookUrl ?? null,
    tiktok_url: input.tiktokUrl ?? null,
    website_url: input.websiteUrl ?? null,
    maps_url: input.mapsUrl ?? null,
    survey_url: input.surveyUrl ?? null,
    updated_at: new Date().toISOString(),
  };
}

function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("invalid_text");
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return undefined;
  if (text.length > maxLength) throw new Error("text_too_long");
  return text;
}

function parseOptionalPhone(value: unknown): string | undefined {
  const phone = parseOptionalText(value, 40);
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("invalid_phone");
  return phone;
}

function parseSocialUrl(value: unknown, host: string): string | undefined {
  const text = parseOptionalText(value, MAX_URL_LENGTH);
  if (!text) return undefined;
  if (text.startsWith("@")) return `https://${host}/${text.slice(1)}`;
  if (!text.includes(".") && !text.includes("/")) return `https://${host}/${text}`;
  return normalizeHttpUrl(text);
}

function parseOptionalUrl(value: unknown): string | undefined {
  const text = parseOptionalText(value, MAX_URL_LENGTH);
  return text ? normalizeHttpUrl(text) : undefined;
}

function normalizeHttpUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_url");
  return url.toString();
}

function buildPhoneUrl(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : undefined;
}

function buildWhatsappUrl(phone: string | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : undefined;
}

function buildMapsUrl(location: LocationRow): string | undefined {
  if (location.latitude !== null && location.latitude !== undefined
    && location.longitude !== null && location.longitude !== undefined) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
  }
  const address = optional(location.address);
  return address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : undefined;
}

function optional(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
