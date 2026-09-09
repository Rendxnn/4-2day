type DynamicLinkLookupFailure = {
  status: number;
  backendError?: string;
};

export function formatDynamicLinkLookupFailure(error: DynamicLinkLookupFailure) {
  if (error.backendError === "dynamic_link_not_found") return "No existe una unidad de ParaHoy para este código.";
  if (error.backendError === "dynamic_link_code_invalid") return "El código leído no tiene el formato esperado.";
  if (error.status === 401 || error.backendError === "unauthorized") return "Tu sesión venció o no es válida. Cierra sesión e ingresa de nuevo antes de buscar la unidad.";
  if (error.status === 403 || error.backendError === "admin_forbidden") return "Tu cuenta no tiene permiso de administrador para configurar unidades. Solicita acceso a un administrador global.";
  if (error.status === 429) return "Hay demasiadas consultas en este momento. Espera unos segundos e inténtalo otra vez.";
  if (error.status === 502 || error.status >= 500) return "El inventario está temporalmente no disponible. No se guardó ningún cambio; inténtalo otra vez.";
  return "No fue posible consultar la unidad. Inténtalo otra vez.";
}
