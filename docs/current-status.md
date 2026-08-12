# Estado actual de ParaHoy

> Corte documental: 2026-08-11. Esta es la única fuente para capacidades implementadas, parciales, experimentales y deseadas. El estado de servicios externos debe verificarse y fecharse antes de afirmarlo.

## Resumen

| Área | Madurez | Lectura actual |
| --- | --- | --- |
| ParaHoy Pedidos | **Actual / parcial** | Flujo transaccional amplio y operable; falta alinear todo texto con IA y completar la operación humana. |
| ParaHoy Presencia Digital | **Actual / parcial** | Perfil, carta y concierge funcionan; falta completar landing, branding, dominios, carrito y autogestión. |
| Paquete completo | **Parcial / deseado** | Comparte catálogo y configuración; no existen entitlements separados ni carrito web multi-producto. |
| Onboarding | **Parcial** | Provisionamiento y administración existen, pero requieren acompañamiento y verificaciones manuales. |
| Recordatorios de almuerzo | **Experimental** | Implementación interna fuera de la oferta comercial. |

## ParaHoy Pedidos

### Actual

- Webhook de WhatsApp con verificación, normalización, idempotencia y persistencia de mensajes.
- Transcripción de audio antes de ingresar al flujo textual.
- Resolución multi-tenant por canal y schemas separados.
- Catálogo, menú diario, categorías, emojis, configurables y disponibilidad.
- Construcción de `draft_order`, totales calculados en backend y confirmación previa a la orden.
- Domicilio o recogida, direcciones escritas o ubicación, validación de cobertura y tarifa fija.
- Facturación normal/electrónica y reutilización de perfiles de cliente.
- Efectivo y transferencia; recepción y almacenamiento de comprobantes.
- Revisión del restaurante, agotados, reemplazos, estados de cocina y notificaciones al cliente.
- Pausa/reanudación de automatización por conversación, alertas de intervención y transcripción visible desde el pedido.
- Dashboard de pedidos, menú, catálogo, pagos, cobertura, configuración y administración de restaurantes/miembros.
- Plan semántico estructurado con operaciones tipadas, lista permitida por estado y validación determinista antes de aplicar cambios.
- Trazas de routing y eventos operativos.

### Parcial

- El dashboard permite ver transcripciones y controlar automatización, pero no ofrece una bandeja humana completa ni compositor para responder dentro de la conversación.
- Los comprobantes soportan revisión y aprobación, pero el flujo operativo de rechazo necesita pulido.
- Hay pruebas automatizadas de API y dashboard, aunque una parte significativa caracteriza estructura de fuente y no sustituye E2E reales.
- El onboarding crea tenants y usuarios, pero sigue requiriendo revisión manual del schema, Data API, RLS, Realtime, Storage y configuración externa.

### Desalineación con el diseño acordado

El objetivo es que **todo texto del cliente pase por IA** y produzca una acción controlada según el estado. Hoy `chat-routing/router.ts` ejecuta antes del plan semántico varias decisiones por señales locales, incluidas entradas de menú/saludo, consulta de estado y respuestas exactas de checkout, billing o configuración.

La eliminación de esos atajos es trabajo de código pendiente. Las reglas deterministas de infraestructura y negocio sí permanecen: validan y ejecutan la acción de IA, pero no deben interpretar la intención textual.

### Pendiente

- Enviar todo texto al plan de IA, incluida la conversación guiada, y probar que no quedan bypass textuales.
- Garantizar que una acción inválida, ambigua o no permitida conserve el estado y genere aclaración segura.
- Completar bandeja, timeline independiente, compositor humano y acciones desde alertas.
- Pulir rechazo de comprobantes y mensajes asociados.
- Añadir E2E conversacionales y de operación del dashboard.
- Automatizar verificaciones de onboarding y drift multi-tenant.

## ParaHoy Presencia Digital

### Actual

- Perfil público por slug con nombre, titular, teléfono, WhatsApp, redes, web, Maps y encuesta.
- Carta pública responsive basada en el menú y disponibilidad vigentes.
- Concierge IA con historial acotado, conocimiento cargado por el restaurante y referencias al catálogo.
- Configuración parcial del perfil y del conocimiento desde el dashboard.
- Pruebas automatizadas para perfil, carta, recomendaciones, concierge y páginas informativas.

### Parcial

- La página pública funciona como perfil de enlaces; todavía no cubre toda la landing estándar deseada.
- La identidad visual, contenido y conocimiento son editables solo en parte.
- El modo público `standalone` o `connected` se deriva actualmente de `tenant.automation_enabled`, mezclando contratación con estado operativo.

### Deseado

- Plantilla de landing completa con logo, portada, colores, presentación, horarios, ubicación, contacto, redes y CTA.
- Autogestión integral de identidad, contenido, enlaces, dominio, catálogo, carta, disponibilidad y conocimiento.
- URL ParaHoy y dominio propio configurables dentro del estándar.
- Carrito web multi-producto transferible a WhatsApp.
- Rate limiting, cuotas y control de costos del endpoint público del concierge.

El concierge seguirá siendo asistente de la carta: puede explicar y recomendar, pero no confirmar pedidos ni ejecutar acciones de compra.

## Paquete completo y entitlements

El catálogo compartido ya permite que conversación y carta lean la misma base operativa. Falta modelar entitlements independientes para `ParaHoy Pedidos` y `ParaHoy Presencia Digital`.

`automation_enabled` debe representar estado operativo, no plan contratado. Una pausa por conversación tampoco cambia el paquete del tenant. La solución de datos y API se definirá en el trabajo de implementación correspondiente.

## Capacidades internas

- **Analytics — Actual, interno:** snapshots y vistas administrativas para seguimiento operativo. No se ofrece como analítica avanzada del producto.
- **Recordatorios de almuerzo — Experimental:** existe preview y envío a clientes recientes. Permanece fuera del producto hasta contar con consentimiento, opt-out, plantillas aprobadas, segmentación y controles de frecuencia.

## Desalineaciones prioritarias

1. El router determinista contradice el principio de IA para todo texto.
2. `automation_enabled` mezcla disponibilidad operativa con modalidad comercial pública.
3. Presencia Digital aún no cumple la landing, branding, dominio y autogestión estándar.
4. El paquete completo no tiene carrito web multi-producto ni entitlements propios.
5. La operación humana de conversaciones y alertas es incompleta.
6. El concierge público no tiene rate limiting/cuotas visibles.
7. El onboarding de schemas necesita exposición Data API y grants explícitos, además de RLS; no puede asumirse que una tabla nueva quede expuesta automáticamente.
8. No hay automatización CI versionada en `.github/workflows`.

## Cambios recientes

- **2026-08-11:** integración de carta con mesero/concierge IA y perfil público.
- **2026-08-01:** endurecimiento para demo, observabilidad y manejo de errores.
- **2026-07-29:** paquete de carta IA y perfil público, incluido soporte standalone.
- **2026-07-24:** transcripciones visibles, emojis persistentes y conocimiento del concierge.
- **2026-07-23:** analytics internos, progreso de cocina e integridad entre catálogo y menú.

## Criterios para el siguiente hito

- Todo texto de pedidos invoca IA y solo puede terminar en una acción permitida para el estado actual.
- Los dos módulos pueden activarse de forma independiente sin reutilizar flags operativos.
- La landing estándar y el carrito multi-producto están completos y autogestionables.
- La operación humana puede localizar, revisar y continuar conversaciones.
- Onboarding, migraciones y smoke tests son repetibles sin pasos implícitos.
- Concierge y campañas cuentan con límites y controles de cumplimiento antes de escalar.
