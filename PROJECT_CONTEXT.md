# Contexto del proyecto ParaHoy

> Fuente canónica de propósito, alcance y decisiones de producto. El estado verificable y las brechas viven en [Estado actual](./docs/current-status.md).

## Propósito

ParaHoy ayuda a restaurantes pequeños y medianos a vender y atender clientes mediante dos módulos que pueden contratarse juntos o por separado. La venta y el onboarding son acompañados: todavía no es un producto autoservicio ni diseñado para operar a gran escala sin intervención del equipo.

## Oferta modular

### ParaHoy Pedidos

Automatización y gestión de pedidos por WhatsApp. Recibe mensajes, mantiene el estado de la conversación, construye un borrador, valida catálogo y disponibilidad, calcula valores en backend y crea una orden después de la confirmación del cliente. El restaurante revisa y opera la orden desde el dashboard.

### ParaHoy Presencia Digital

Presencia pública del restaurante compuesta por:

- landing responsive basada en una plantilla fija;
- identidad básica: logo, portada, colores y contenido del restaurante;
- presentación, horarios, ubicación, contacto, redes sociales y llamados a la acción;
- carta pública con disponibilidad;
- concierge IA para responder preguntas sobre la carta;
- enlace a encuesta de servicio;
- URL de ParaHoy o dominio propio dentro de la oferta estándar.

La página avanzada o diseñada a medida es una extensión personalizada, no parte de la plantilla estándar.

### Paquete completo

Los dos módulos comparten restaurante, catálogo, carta, disponibilidad y configuración. El estado deseado permite armar un carrito web con varios productos y transferirlo a WhatsApp para continuar el pedido.

Cada módulo deberá tener un entitlement técnico independiente por tenant. El paquete contratado no debe inferirse de `automation_enabled`, del estado operativo del restaurante ni de una pausa de conversación. Esa separación aún no existe en el modelo implementado.

## Estados de madurez

La documentación usa estas etiquetas:

- **Actual:** existe en código y tiene un camino funcional identificable.
- **Parcial:** existe, pero no cubre todavía la experiencia o gestión completa.
- **Experimental:** está implementado para validación interna y no pertenece a la oferta comercial.
- **Deseado:** forma parte del producto acordado, pero requiere implementación.

## Principios de ParaHoy Pedidos

### Todo texto pasa por IA

Todo mensaje de texto que entra al flujo conversacional de pedidos debe ser interpretado por IA. Por ahora no habrá un router determinista que resuelva saludos, intenciones, confirmaciones, números o comandos exactos antes de consultar al modelo.

El contrato conceptual es:

```text
texto del cliente + estado vigente + contexto permitido
  -> IA
  -> acción controlada
  -> validación y ejecución determinista en backend
```

La IA:

- recibe el estado vigente, el borrador y los identificadores canónicos necesarios;
- solo puede proponer acciones incluidas en el conjunto permitido para ese estado;
- no calcula precios, no decide disponibilidad final, no inventa identificadores y no escribe directamente en la base de datos.

El backend:

- valida esquema, evidencia, permisos y transición de estado;
- resuelve catálogo, configurables, cobertura, precios, billing y disponibilidad;
- aplica la acción de forma consistente e idempotente;
- conserva el estado anterior y solicita aclaración o activa el manejo de error si la acción es inválida, ambigua o incompatible.

El procesamiento determinista sigue siendo obligatorio para infraestructura y seguridad: webhooks, autenticación, normalización de media y ubicación, idempotencia, persistencia, reglas de negocio y ejecución. No debe sustituir a la IA en la interpretación de texto.

El código actual aún contiene rutas textuales deterministas previas al plan semántico. Esto es una [desalineación pendiente](./docs/current-status.md#desalineaciones-prioritarias), no el diseño deseado.

### Invariantes del pedido

- Todo pedido comienza como `draft_order`.
- El cliente confirma antes de crear una `order`.
- La orden requiere revisión operativa del restaurante.
- Precios, totales y disponibilidad se determinan en backend.
- Debe existir handoff humano y control de pausa por conversación.
- Una conversación inactiva expira según la política implementada de 30 minutos.

## Principios de ParaHoy Presencia Digital

- El concierge informa y recomienda usando carta y conocimiento autorizado del restaurante; no confirma pedidos.
- La disponibilidad pública proviene del mismo catálogo operativo.
- El restaurante debe poder autogestionar identidad, información, enlaces, dominio, catálogo, carta, disponibilidad y conocimiento del concierge.
- El carrito web multi-producto continúa en WhatsApp; no constituye checkout ni pago web.

## Decisiones técnicas vigentes

| Tema | Decisión |
| --- | --- |
| Monorepo | pnpm + Turborepo |
| Lenguaje | TypeScript |
| API | Cloudflare Workers + Hono |
| Dashboard y páginas públicas | React + Vite |
| Datos, Auth, Storage y Realtime | Supabase |
| Aislamiento tenant | schema global `control`, plantilla `tenant_template` y un schema `tenant_<slug>` por restaurante |
| WhatsApp | Meta WhatsApp Cloud API |
| IA conversacional | proveedores configurables mediante `packages/t-router`; Gemini es el proveedor principal actual |
| Fulfillment | domicilio y recoger en local |
| Pagos | efectivo y transferencia; revisión humana del comprobante |
| Acceso del frontend | API para negocio; Supabase directo solo para Auth y suscripciones Realtime controladas |
| Roles operativos | `encargado` y `trabajador` |
| Migraciones canónicas | `supabase/migrations` |

Los nombres técnicos históricos (`42day`, `@42day`, rutas, variables y workers) se conservan hasta que exista un cambio de código coordinado. No representan una segunda marca de producto.

## Fuera del alcance actual

- POS e inventario.
- Conciliación automática de pagos.
- Checkout o pago web.
- Página avanzada incluida en el paquete estándar.
- Operación autoservicio y onboarding sin acompañamiento.
- Garantías de operación a gran escala.
- OCR de menús listo para producción.
- Cobertura geoespacial avanzada y multiidioma completo.

## Fuentes de verdad

- [Estado actual y brechas](./docs/current-status.md)
- [Arquitectura del monorepo](./docs/architecture/monorepo.md)
- [Arquitectura backend](./docs/architecture/backend.md)
- [Arquitectura del frontend](./docs/architecture/dashboard-frontend.md)
- [Migraciones multi-tenant](./docs/architecture/database-migrations.md)
- [Flujo conversacional](./docs/flows/conversation-flow.md)
- [Presencia Digital](./docs/flows/presence-digital.md)
- [Setup local](./docs/runbooks/local-setup.md)
- [Despliegue y configuración externa](./docs/runbooks/deployment.md)
- [Smoke tests](./docs/runbooks/smoke-tests.md)
