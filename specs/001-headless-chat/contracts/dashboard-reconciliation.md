# Contrato backend de reconciliación desde dashboard

Este contrato habilita recuperación operativa del flujo compartido en entornos desplegados sin
exponer la interfaz headless ni exigir SQL manual. No incluye una pantalla nueva en este feature.

## Operación propuesta

`POST /:tenantSlug/conversations/:conversationId/messages/:messageId/reconciliation`

La ruta usa la autenticación y autorización tenant-scoped vigentes del dashboard. El middleware
resuelve el tenant; el caller no puede enviar `schema`, tenant ID interno, manifiesto, plan, snapshots
ni estado terminal deseado.

Body estricto:

```json
{
  "observedOutcome": "effects_applied",
  "expectedUpdatedAt": "2026-08-12T15:00:00.000Z"
}
```

- `observedOutcome`: `effects_applied | no_effects`; es una observación consultiva.
- `expectedUpdatedAt`: precondición optimista obligatoria obtenida de la lectura autorizada del
  mensaje; evita reconciliar sobre una observación obsoleta.

## Delegación y decisión

La ruta resuelve conversación/mensaje dentro del tenant autenticado y delega en
`reconcileNormalizedChatTurn`. No importa CLI, journal, fixtures, `.env.headless.local` ni gates debug.

El caso de uso bloquea mensaje, conversación y objetivos en orden estable y decide:

- `reconciled/applied` solo si confirma todas las postcondiciones y claves idempotentes del manifiesto;
- `reconciled/failed` solo si confirma precondiciones vigentes y ausencia total de efectos;
- `indeterminate` ante estado parcial, contradicción, manifiesto ausente/corrupto o evidencia insuficiente.

Nunca invoca IA, geocodificación, entrega ni ejecutores, y nunca toma la observación como autoridad.

## Respuestas seguras

- `200`: `{ status: "reconciled" | "indeterminate", outcome, reasonCode, messageId, updatedAt }`.
- `400`: body inválido o versión de observación no soportada.
- `404`: conversación o mensaje no encontrado; la misma forma evita enumeración cross-tenant.
- `409`: precondición obsoleta, mensaje terminal/no reconciliable o claim concurrente.

La respuesta usa IDs opacos y códigos allowlisted. No incluye manifiesto, plan, texto de cliente,
respuesta completa, dirección, billing, PII, secretos ni detalles SQL.

## Seguridad y auditoría

- Requiere el mismo permiso de dashboard que controla la automatización de la conversación.
- Toda lectura y lock usa el `TenantContext` resuelto; una URL nunca selecciona schema directamente.
- Se registra actor autenticado, timestamp, observación, decisión y reason code, sin valores sensibles.
- Repetir con la misma precondición tras una decisión terminal devuelve conflicto seguro y no muta.
- La RPC subyacente es `SECURITY INVOKER`, usa relaciones calificadas, revoca `PUBLIC`, `anon` y
  `authenticated`, y permite ejecución solo al backend `service_role`.

## Exclusiones

- No se crea endpoint headless ni se habilita esta operación sin autenticación.
- No se diseña UI de dashboard en esta entrega.
- No hay override manual de estado, replay de turnos ni edición de manifiestos.
