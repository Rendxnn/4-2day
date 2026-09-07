import { Hono, type Context } from "hono";
import type { ApiBindings } from "../../lib/bindings.ts";
import { resolvePublicDynamicLink } from "./service.ts";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const fallbackMessages = {
  available: ["Este enlace todavía no está activo.", 200],
  suspended: ["Este enlace no está disponible en este momento.", 403],
  archived: ["Este enlace ya no está disponible.", 410],
  unknown: ["No encontramos este enlace.", 404],
  invalid: ["Este enlace no está disponible en este momento.", 503],
} as const;

export const dynamicLinkPublicRoutes = new Hono<{ Bindings: ApiBindings }>();

async function handlePublicDynamicLink(c: Context<{ Bindings: ApiBindings }>) {
  try {
    const result = await resolvePublicDynamicLink(c.env, c.req.param("code") ?? "");
    if (result.kind === "redirect") {
      const response = c.redirect(result.destination, 302);
      for (const [header, value] of Object.entries(noStoreHeaders)) response.headers.set(header, value);
      return response;
    }
    const [message, status] = fallbackMessages[result.kind];
    return c.html(publicFallbackHtml(message), status, noStoreHeaders);
  } catch {
    return c.html(publicFallbackHtml("El servicio no está disponible temporalmente."), 503, noStoreHeaders);
  }
}

dynamicLinkPublicRoutes.on(["GET", "HEAD"], "/r/:code", handlePublicDynamicLink);

function publicFallbackHtml(message: string) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ParaHoy</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#fafaf9;color:#1c1917"><main style="max-width:28rem;padding:2rem;text-align:center"><h1 style="margin:0 0 1rem">ParaHoy</h1><p>${message}</p></main></body></html>`;
}
