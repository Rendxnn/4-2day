# Contrato CLI headless v1

Este documento define el contrato observable. No prescribe la estructura interna definitiva del código.

## Transporte de proceso

- Una invocación procesa exactamente un comando.
- stdin: exactamente un objeto JSON UTF-8; whitespace periférico permitido.
- stdout: exactamente un objeto JSON UTF-8 seguido de newline; ningún banner o log.
- stderr: diagnóstico seguro opcional, sin texto del cliente ni secretos.
- Exit `0`: operación exitosa o retry idempotente.
- Exit `2`: contrato, gate, tenant, identidad o sesión rechazados.
- Exit `1`: fallo de procesamiento, dependencia o resultado indeterminado.
- Entrada vacía, múltiples objetos, JSON inválido o versión desconocida se rechazan antes de journal, tenant, IA o negocio.

Los comandos se validan con [headless-command.schema.json](./headless-command.schema.json) y los resultados con [headless-result.schema.json](./headless-result.schema.json).

## Gates obligatorios

Antes de procesar cualquier comando:

1. El proceso debe cargar exactamente `apps/api/.env.headless.local`; el comando JSON no puede elegir
   otro archivo ni suministrar credenciales.
2. `APP_ENV` debe ser exactamente `local`.
3. `PARAHOY_HEADLESS_DEBUG` debe ser exactamente `true`.
4. `PARAHOY_HEADLESS_LOCAL_PROJECT_ID`, host y puertos Supabase deben coincidir con
   `supabase/config.toml`; todos los endpoints deben ser loopback.
5. La entrada debe ser la CLI local, ausente de todo bundle/ruta desplegable.
6. El tenant es obligatorio y se resuelve por slug en `control.tenants`; nunca se acepta schema. Todo
   tenant registrado en la base local es seleccionable.

El rechazo devuelve `HEADLESS_DISABLED` o `UNAUTHORIZED_LOCAL_ENV` sin revelar configuración. Estos
gates también se aplican a `inspect`, `reconcile` y `close`.

## Comando `start`

```json
{
  "version": 1,
  "command": "start",
  "tenant": "demo"
}
```

`identityId` es opcional. Ausente, crea una nueva identidad sintética; presente, reutiliza únicamente una identidad headless del mismo tenant.

Resultado exitoso: `status=started`, sesión activa e identidad opaca. No devuelve customer ID ni clave sintética.

## Comando `turn`

```json
{
  "version": 1,
  "command": "turn",
  "tenant": "demo",
  "sessionId": "hss_opaque",
  "turnId": "turn-001",
  "text": "Quiero una hamburguesa"
}
```

Reglas:

- `turnId` es idempotente dentro de la sesión.
- El mismo ID y mismo digest devuelve `status=repeated` con la representación durable.
- El mismo ID con texto diferente devuelve `IDEMPOTENCY_CONFLICT` sin efectos.
- Si la automatización del tenant o de la conversación está pausada, el inbound se conserva sin
  invocar IA y devuelve `status=pending` con warning `AUTOMATION_PAUSED`; la reactivación posterior
  reclama únicamente el último inbound elegible y captura su respuesta como `manual_resume`.
- Texto: 1–4096 caracteres Unicode después de validación; no se recorta silenciosamente.
- La CLI siempre usa la IA real configurada para el tenant; los dobles inline solo pueden inyectarse
  desde los harnesses de pruebas internos y nunca forman parte del protocolo operativo.

## Comando `inspect`

```json
{
  "version": 1,
  "command": "inspect",
  "tenant": "demo",
  "sessionId": "hss_opaque"
}
```

Devuelve estado de sesión, último estado de turno y snapshot permitido consultado desde negocio. En
`responses` incluye, en orden, respuestas `captured` que se hayan producido posteriormente al reactivar
un inbound de esa sesión, identificadas con `captureContext=manual_resume` y el `originatingTurnId`
opaco. No las incorpora al resultado durable de aquel turno. No ejecuta router, IA ni acciones.

## Comando `reconcile`

```json
{
  "version": 1,
  "command": "reconcile",
  "tenant": "demo",
  "sessionId": "hss_opaque",
  "turnId": "turn-001",
  "observedOutcome": "effects_applied"
}
```

Solo admite un turno `indeterminate`. `observedOutcome` puede ser `effects_applied` o `no_effects` y
representa una observación del operador, no una orden para forzar estado. El backend consulta el estado
autoritativo mediante `reconcileNormalizedChatTurn`, el mismo caso de uso disponible para la operación
autenticada de dashboard. Solo resuelve `applied` cuando demuestra todas las postcondiciones del
manifiesto y `failed` cuando demuestra ausencia total de efectos. Evidencia parcial, manifiesto
ausente/corrupto o contradicción devuelve `indeterminate` y mantiene la sesión bloqueada. No vuelve a
ejecutar router, IA, geocodificación, entrega ni acciones de negocio.

## Comando `close`

```json
{
  "version": 1,
  "command": "close",
  "tenant": "demo",
  "sessionId": "hss_opaque"
}
```

Marca la sesión cerrada. Repetirlo es exitoso e idempotente. Una sesión cerrada puede inspeccionarse, pero no recibir turnos.

## Envelope de resultado

Campos estables:

- `version`, `command`, `status`.
- `tenant`: ID y slug solo cuando el tenant ya fue validado.
- `session`: ID, identity ID y estado solo cuando se resolvieron sin mismatch.
- `turn`: ID, estado durable y clasificación de retry.
- `responses`: proyecciones seguras de los mensajes completos persistidos en el tenant, con contexto
  `turn` o `manual_resume`, turno originador cuando corresponda, `redacted` y `redactionCodes`; nunca
  expone valores sensibles autoritativos, IDs o raw de Meta.
- `before` / `after`: proyecciones seguras.
- `routing`: códigos de rama/IA, no traza interna completa.
- `effects`: tipos y resultados de efectos autorizados. Puede incluir `outbound_message`,
  `draft_order_mutation`, `order_mutation` y `conversation_mutation`; sus IDs son opacos y no son
  identificadores de Meta. La reconciliación prueba las mutaciones de negocio mediante fingerprints
  de postcondición; el manifiesto de mensajes conserva únicamente IDs UUID de mensajes persistidos.
- `error`: código, categoría, retry y mensaje seguro.
- `warnings`: códigos estables.

`status` puede ser:

| Estado | Significado |
| --- | --- |
| `started` | Sesión creada. |
| `applied` | Turno procesado y resultado durable. |
| `repeated` | Se devolvió el resultado durable de un turno ya reclamado. |
| `inspected` | Lectura sin efectos. |
| `reconciled` | La indeterminación fue resuelta y validada contra estado autoritativo. |
| `closed` | Sesión cerrada o ya cerrada. |
| `rejected` | El comando no pudo autorizarse/validarse o el flujo rechazó sin efectos. |
| `failed` | Fallo conocido y clasificado. |
| `indeterminate` | Pueden existir efectos; no reintentar automáticamente. |

## Códigos de error mínimos

`INVALID_JSON`, `INVALID_COMMAND`, `UNSUPPORTED_VERSION`, `HEADLESS_DISABLED`, `UNAUTHORIZED_TARGET_ENV`, `TENANT_NOT_FOUND`, `IDENTITY_NOT_FOUND`, `IDENTITY_TENANT_MISMATCH`, `IDENTITY_NOT_HEADLESS`, `SESSION_NOT_FOUND`, `SESSION_TENANT_MISMATCH`, `SESSION_CLOSED`, `IDEMPOTENCY_CONFLICT`, `TEXT_TOO_LONG`, `AI_INVALID`, `AI_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `GEOCODING_UNAVAILABLE`, `LOCK_UNAVAILABLE`, `TURN_INDETERMINATE`, `RECONCILIATION_MISMATCH`, `INTERNAL_SAFE_ERROR`.

Los errores de mismatch no deben confirmar que el recurso pertenece a otro tenant; el código puede normalizarse a `*_NOT_FOUND` en la salida pública mientras el diagnóstico interno conserva la causa segura.

## Compatibilidad

- Campos nuevos dentro de objetos existentes requieren que consumidores ignoren campos desconocidos.
- Eliminar/renombrar campos o cambiar semántica requiere una nueva versión.
- Una implementación v1 rechaza cualquier `version` distinta de `1`.
- Los IDs son opacos; los consumidores no deben extraer información del prefijo.

La respuesta completa tenant-local es la evidencia usada para paridad y operación de negocio. No forma
parte del contrato CLI: stdout, stderr, journal e `inspect` contienen exclusivamente la proyección
segura definida por el schema v1.
