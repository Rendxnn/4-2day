# Smoke tests de ParaHoy

## Preparación

Registra fecha, ambiente, commit, tenant y módulos que se validarán. Usa placeholders en documentación y conserva IDs reales solo en el sistema operativo correspondiente.

Verifica salud:

```bash
curl -fsS <api-base-url>/health
```

La respuesta debe incluir `ok: true`, el servicio técnico y el ambiente esperado.

## ParaHoy Pedidos

1. Envía un saludo o solicitud de menú por WhatsApp.
2. Realiza un pedido natural con más de un producto y al menos un configurable.
3. Selecciona domicilio o recogida; para domicilio prueba ubicación o dirección escrita y cobertura.
4. Completa billing y elige efectivo o transferencia.
5. Confirma el resumen y comprueba creación de la orden una sola vez.
6. Desde dashboard revisa transcripción, totales, dirección, billing y medio de pago.
7. Acepta la orden o marca un agotado; valida reemplazo y notificación.
8. Actualiza progreso de cocina y confirma notificación correspondiente.
9. Pausa y reanuda la conversación; durante la pausa no debe responder automáticamente.

Para transferencia, adjunta imagen o PDF, confirma almacenamiento privado y revisión manual. No esperes conciliación automática.

Mientras exista la brecha documentada, registra si una entrada fue resuelta por router determinista. El criterio futuro es que todo texto intente IA y que las acciones incompatibles no muten el pedido.

## ParaHoy Presencia Digital

Comprueba endpoints públicos sin sesión:

```bash
curl -fsS <api-base-url>/dashboard/public/<tenant-slug>/profile
curl -fsS <api-base-url>/dashboard/public/<tenant-slug>/carta
curl -fsS -X POST <api-base-url>/dashboard/public/<tenant-slug>/carta/concierge \
  -H 'content-type: application/json' \
  -d '{"question":"¿Qué me recomiendas?","history":[]}'
```

Después verifica en navegador:

- perfil, enlaces y CTA;
- carta y disponibilidad;
- recomendaciones del concierge basadas en productos reales;
- respuesta segura cuando el conocimiento no alcanza;
- encuesta habilitada solo cuando existe URL;
- responsive y estados 404 de tenant/perfil inactivo.

No certifiques todavía landing completa, dominio propio, carrito multi-producto, autogestión integral ni rate limiting: son capacidades pendientes.

## Paquete completo

- Confirma que carta y WhatsApp leen el mismo catálogo y disponibilidad.
- Cambia disponibilidad desde dashboard y verifica ambos canales.
- No uses `automation_enabled` como evidencia del módulo contratado.
- Hasta implementar carrito, valida solo enlaces de continuidad a WhatsApp, no transferencia de múltiples líneas.

## Seguridad y aislamiento

- Un miembro solo accede a tenants autorizados.
- Un slug o ID de otro tenant no expone datos privados.
- Las llamadas públicas no incluyen conocimiento interno, billing, conversaciones ni comprobantes.
- La clave pública no obtiene filas fuera de RLS; la service role no aparece en frontend.
- Schemas nuevos tienen exposición, grants, RLS y Realtime verificados explícitamente.

## Automatización local

```bash
pnpm --filter @42day/api test
pnpm --filter @42day/dashboard test
pnpm typecheck
pnpm --filter @42day/dashboard build
```

Estos comandos no sustituyen las pruebas externas de Meta, Supabase, hosting y proveedores IA.
