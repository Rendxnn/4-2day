# Arquitectura backend

## Stack y fronteras

- Cloudflare Workers + Hono reciben tráfico HTTP y ejecutan la aplicación.
- Supabase aporta Postgres, Auth, Storage, Realtime y Data API.
- Meta WhatsApp Cloud API entrega mensajes y recibe respuestas.
- `packages/t-router` abstrae los proveedores de IA.
- `packages/types` contiene contratos compartidos.

El Worker conserva credenciales privilegiadas y centraliza las reglas de negocio. El frontend solo usa Supabase directamente para Auth y Realtime controlado.

## Flujo de un mensaje

```text
Meta webhook
  -> verificación, normalización e idempotencia
  -> resolución de tenant y conversación
  -> persistencia inbound
  -> transcripción cuando el mensaje es audio
  -> interpretación IA del texto con estado y contexto canónico
  -> acción controlada
  -> validación y ejecución determinista
  -> persistencia de estado, draft, order, eventos y alertas
  -> composición y envío de respuesta
```

Todo texto debe recorrer la IA. Media, ubicación, autenticación, idempotencia, reglas de negocio y persistencia siguen siendo deterministas.

## Contrato de acciones controladas

El modelo recibe únicamente contexto autorizado: estado, draft, menú, opciones e IDs canónicos. Devuelve operaciones tipadas pertenecientes al conjunto permitido para ese estado, por ejemplo agregar o retirar líneas, configurar un producto, elegir fulfillment/pago, registrar datos de checkout, confirmar, editar, cancelar, mostrar menú o pedir humano.

Antes de mutar datos, el backend valida:

- que la operación pertenezca al conjunto permitido;
- que IDs y evidencia correspondan al contexto enviado;
- que catálogo, disponibilidad, cobertura y datos requeridos sean válidos;
- que la transición sea compatible con el estado vigente;
- que no haya una actualización concurrente que vuelva obsoleta la acción.

Una salida inválida no cambia el pedido. El sistema solicita aclaración o genera el evento/alerta correspondiente. La IA nunca escribe en Supabase ni calcula el total.

## Estado implementado y desalineación

El plan semántico estructurado y sus validaciones ya existen. Sin embargo, `features/chat-routing/router.ts` aún decide localmente algunos saludos, solicitudes de menú/estado y respuestas exactas de checkout, billing o configurables. Estos bypass deben retirarse: son deuda actual, no una excepción aceptada al principio de todo texto por IA.

## Módulos dueños

- `modules/whatsapp-webhook`: transporte, normalización y media.
- `features/chat-routing`: interpretación y orquestación del pedido.
- `features/conversations`: persistencia, estado y automatización por conversación.
- `features/draft-orders` y `features/orders`: ciclo transaccional.
- `features/payment-proofs`: archivos y revisión de transferencias.
- `features/dashboard`: API operativa, administrativa y pública.
- `features/carta-concierge` y `features/public-profile`: Presencia Digital.
- `lib/supabase-rest`: acceso server-side a Data API.

Las fachadas bajo nombres históricos solo preservan compatibilidad. La lógica nueva debe vivir en el feature dueño.

## Handoff y fallas

Una conversación puede pausarse de forma transaccional, conservar su estado de reanudación y emitir alertas. Al reanudar se restauran las condiciones seguras definidas; las revisiones operativas de pago u orden no se cierran implícitamente.

Las llamadas externas deben tener errores observables y evitar mutaciones parciales. La idempotencia del webhook y las validaciones de concurrencia protegen contra reintentos y respuestas obsoletas.

## API pública

Los endpoints públicos de perfil, carta y concierge no requieren sesión. Deben limitarse a datos explícitamente públicos. Rate limiting, cuotas y presupuesto del concierge permanecen como brecha antes de escalar.

Consulta [Flujo conversacional](../flows/conversation-flow.md), [Presencia Digital](../flows/presence-digital.md) y [Supabase](../integrations/supabase.md).
