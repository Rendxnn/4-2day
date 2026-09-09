import assert from "node:assert/strict";
import test from "node:test";
import { formatDynamicLinkLookupFailure } from "../src/features/admin/dynamicLinkQuickSetupErrors.ts";

test("quick setup presents controlled lookup messages for safe, actionable recovery", () => {
  assert.match(formatDynamicLinkLookupFailure({ status: 401 }), /sesión venció/);
  assert.match(formatDynamicLinkLookupFailure({ status: 403 }), /permiso de administrador/);
  assert.match(formatDynamicLinkLookupFailure({ status: 404, backendError: "dynamic_link_not_found" }), /No existe una unidad/);
  assert.match(formatDynamicLinkLookupFailure({ status: 400, backendError: "dynamic_link_code_invalid" }), /formato esperado/);
  assert.match(formatDynamicLinkLookupFailure({ status: 429 }), /demasiadas consultas/);
  assert.match(formatDynamicLinkLookupFailure({ status: 502 }), /temporalmente no disponible/);
  assert.match(formatDynamicLinkLookupFailure({ status: 503 }), /temporalmente no disponible/);
  assert.equal(formatDynamicLinkLookupFailure({ status: 418 }), "No fue posible consultar la unidad. Inténtalo otra vez.");
});
