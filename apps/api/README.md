# API de ParaHoy

Worker de Cloudflare que recibe WhatsApp, orquesta pedidos y expone la API autenticada del dashboard y los endpoints públicos de Presencia Digital. El nombre técnico del paquete continúa siendo `@42day/api`.

## Responsabilidades

- Verificar y procesar webhooks de Meta.
- Resolver tenant, conversación y estado vigente.
- Transcribir audio y enviar todo texto conversacional al intérprete de IA —dirección objetivo; consulta la deuda actual en [Estado](../../docs/current-status.md).
- Validar y ejecutar acciones controladas sobre drafts y órdenes.
- Operar catálogo, menú, pagos, cobertura, alertas, notificaciones y configuración.
- Servir perfil, carta y concierge públicos.
- Integrar Supabase Postgres/Auth/Storage/Realtime y proveedores de IA.

## Entradas principales

- `src/index.ts`: composición de Hono.
- `src/modules/whatsapp-webhook/`: webhook y normalización.
- `src/features/chat-routing/`: orquestación conversacional.
- `src/features/dashboard/`: rutas del dashboard y endpoints públicos.
- `src/features/carta-concierge/` y `src/features/public-profile/`: Presencia Digital.

Las fachadas históricas bajo `src/modules/` pueden reexportar implementaciones nuevas; no deben recibir lógica adicional si existe un feature dueño de esa capacidad.

## Desarrollo

```bash
pnpm --filter @42day/api dev
pnpm --filter @42day/api typecheck
pnpm --filter @42day/api test
```

Variables requeridas o usadas según la capacidad:

```text
APP_BASE_URL
META_VERIFY_TOKEN
META_ACCESS_TOKEN
META_PHONE_NUMBER_ID
META_WABA_ID
META_GRAPH_API_VERSION
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
GEMINI_MODEL
OPENAI_API_KEY
OPENAI_TRANSCRIPTION_MODEL
AUDIO_TRANSCRIPTION_PROVIDER
```

`SUPABASE_SERVICE_ROLE_KEY` y las claves de proveedores son secretos exclusivos del backend.

## Documentación relacionada

- [Arquitectura backend](../../docs/architecture/backend.md)
- [Flujo conversacional](../../docs/flows/conversation-flow.md)
- [Integración con WhatsApp](../../docs/integrations/whatsapp-cloud-api.md)
- [Despliegue](../../docs/runbooks/deployment.md)
