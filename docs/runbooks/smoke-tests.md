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

En el flujo actual, todo texto automatizable intenta el plan IA estructurado; las validaciones de estado,
catálogo y permisos siguen siendo backend. Si Gemini o el fallback no están disponibles, verifica la
aclaración/fallback segura y que no se produzca mutación parcial.

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

## Flujo headless local

Con Supabase local saludable y un tenant seed registrado:

```bash
printf '%s\n' '{"version":1,"command":"start","tenant":"headless-demo"}' | pnpm --silent --filter @42day/api headless
printf '%s\n' '{"version":1,"command":"turn","tenant":"headless-demo","sessionId":"<hss-id>","turnId":"turn-001","text":"Quiero ver el menú"}' | pnpm --silent --filter @42day/api headless
printf '%s\n' '{"version":1,"command":"inspect","tenant":"headless-demo","sessionId":"<hss-id>"}' | pnpm --silent --filter @42day/api headless
printf '%s\n' '{"version":1,"command":"close","tenant":"headless-demo","sessionId":"<hss-id>"}' | pnpm --silent --filter @42day/api headless
```

Verifica que las respuestas tengan `delivery=captured`, que no exista `provider_message_id` de Meta y
que el envelope incluya `routing.ai.provider/model`, IDs opacos de efectos y snapshots agregados sin
PII, sin exponer teléfono, dirección, billing, prompts ni raw de IA. Para una ejecución
indeterminada no repitas `turn`: inspecciona y usa `reconcile` con la observación autorizada. La
integración real contra Supabase local y el recorrido de ocho turnos deben registrarse como evidencia
fechada; si el stack no está iniciado, el check queda bloqueado. El E2E sin dobles fijos está
implementado y fue verificado con ocho turnos reales usando `gemini-flash-lite-latest`; la configuración
dedicada puede volver a `gemini-2.5-flash` cuando su cuota esté disponible.

Para ejecutar las pruebas que usan el stack local y Gemini real de forma explícita:

```bash
HEADLESS_SUPABASE_INTEGRATION=1 node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-manifest-integration.test.mjs apps/api/test/headless-chat-fault-injection.test.mjs
HEADLESS_REAL_E2E=1 node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-real-e2e.test.mjs
```

La segunda prueba crea un pedido de validación en el tenant local configurado; no se ejecuta dentro de
la suite por defecto para evitar llamadas accidentales al proveedor y datos de prueba no solicitados.
Los tests deterministas usan únicamente dobles inline y no deben convertirse en una ruta operativa.

### Paridad y fallos headless

La matriz real de 15 escenarios se ejecuta con:

```bash
CI=true HEADLESS_SUPABASE_INTEGRATION=1 pnpm --filter @42day/api test:headless:integration
```

Compara el mismo resultado de negocio para WhatsApp fake y headless desde el límite normalizado; la
única diferencia esperada es `sent` frente a `captured`. La matriz de fallos cubre checkpoint,
outbound, draft, conversación y orden. Un fallo antes o después de cualquiera de esas fronteras deja
el turno `indeterminate`; no se reintenta automáticamente. `inspect` observa y `reconcile` consulta la
evidencia autoritativa sin ejecutar IA, catálogo, geocodificación, Meta ni otro efecto.

Para resetear el entorno solo local, primero ejecuta el check seguro y después la confirmación explícita:

```bash
scripts/bash/reset-local-headless-chat.sh --check
scripts/bash/reset-local-headless-chat.sh --reset --confirm local-headless-reset
```

El helper rechaza endpoints remotos y archiva el journal; nunca borra un directorio amplio ni elimina
datos silenciosamente.
