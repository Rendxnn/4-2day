# Estado actual de ParaHoy

> Corte documental: 2026-08-13. Esta es la única fuente para capacidades implementadas, parciales,
> experimentales, deseadas y deuda de ingeniería pendiente. El estado de servicios externos debe
> verificarse y fecharse antes de afirmarlo.

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
- Chat headless local sin dobles fijos en runtime, conectado a Gemini real, con captura sin Meta, snapshots agregados seguros,
  manifiesto durable y reconciliación compartida. La última corrida opt-in completó ocho planes reales
  con `gemini-flash-lite-latest`, persistió un pedido y no usó fixtures; la configuración dedicada se
  restauró a `gemini-2.5-flash`.
- La transcripción sanitizada de la orden real exitosa está en `specs/001-headless-chat/implementation-evidence.md`:
  `add_product → set_fulfillment → set_billing → set_payment_method → confirm_order`, pedido pendiente
  de revisión por COP 18.000 y todos los outbound capturados localmente.
- Trazas de routing y eventos operativos.

### Parcial

- El dashboard permite ver transcripciones y controlar automatización, pero no ofrece una bandeja humana completa ni compositor para responder dentro de la conversación.
- Los comprobantes soportan revisión y aprobación, pero el flujo operativo de rechazo necesita pulido.
- Hay pruebas automatizadas de API y dashboard, aunque una parte significativa caracteriza estructura de fuente y no sustituye E2E reales.
- El onboarding crea tenants y usuarios, pero sigue requiriendo revisión manual del schema, Data API, RLS, Realtime, Storage y configuración externa.

### Desalineación con el diseño acordado

El objetivo es que **todo texto del cliente pase por IA** y produzca una acción controlada según el estado. El router actual envía el texto al plan semántico compartido antes de ejecutar checkout, billing o configuración. Permanece una reconciliación determinista posterior que vincula menciones textuales explícitas con IDs del menú cuando el modelo omitió un producto; debe conservarse solo como guardia de canonicalización y seguir bajo revisión de paridad.

Las reglas deterministas de infraestructura y negocio validan y ejecutan la acción de IA. La guardia de
canonicalización de menciones debe demostrar que no interpreta una intención independiente ni crea
acciones fuera del plan estructurado.

### Pendiente

- Completar la prueba de que la canonicalización posterior al plan no constituye un bypass textual.
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

## Backlog de salud de ingeniería

Este inventario registra desorden verificado durante la adopción de Spec Kit. Todos sus ítems están
**pendientes** y no representan fallos nuevos ni autorización para una refactorización transversal.
Cada feature, mejora o mantenimiento debe revisar si toca uno de estos ítems:

- si resolverlo es seguro, acotado y coherente con el objetivo del feature, se incluye expresamente en
  su SPEC, plan y tareas;
- si amplía materialmente el alcance, permanece pendiente y se registra la condición para abordarlo;
- no se mezclan cambios masivos de formato, naming o estructura con comportamiento no relacionado.

Las cantidades corresponden al corte de 2026-08-12 y deben volver a medirse antes de planear su
corrección.

| ID | Estado | Pendiente verificado | Resultado esperado / regla de abordaje |
| --- | --- | --- | --- |
| `ENG-001` | **Pendiente** | Los scripts `lint` de API y dashboard solo ejecutan `tsc --noEmit`; no existe lint ni formatter real. | Seleccionar e instalar enforcement después del piloto Spec Kit, sin confundir typecheck con lint. |
| `ENG-002` | **Pendiente** | Hay 15 archivos TypeScript/TSX por encima de 500 líneas. Sobresalen `App.tsx` (5.360), `orders.tsx` (4.071), `LandingPage.tsx` (1.861), `chat-routing/semantic/order.ts` (964) y `dashboard/src/api.ts` (880). | Extraer responsabilidades al tocar cada área; no dividir por tamaño sin una frontera cohesiva y pruebas de comportamiento. |
| `ENG-003` | **Pendiente** | `apps/api/src/modules` y `apps/api/src/features` conservan dueños duplicados o fachadas legacy, por lo que no siempre es evidente dónde añadir comportamiento. | El feature es el dueño; las fachadas solo reexportan temporalmente y cada migración define su condición de retiro. |
| `ENG-004` | **Pendiente** | Conviven `camelCase.ts`, `kebab-case.ts`, `PascalCase.tsx` e imports internos con y sin extensión `.ts`. | Aplicar las convenciones de `CODESTYLE.md` a archivos nuevos y normalizar áreas existentes únicamente dentro de un cambio aprobado. |
| `ENG-005` | **Pendiente** | Varias respuestas JSON, webhooks y otros inputs externos se convierten con `as T` sin validación runtime suficiente. | Recibir `unknown` y validar con schemas, parsers o type guards en cada frontera tocada. |
| `ENG-006` | **Pendiente** | Persisten `any`, non-null assertions y casts de estados o formularios en rutas y UI, incluidos puntos sensibles de settings y checkout. | Sustituirlos por tipos de contexto, narrowing, uniones discriminadas o validación; cualquier excepción debe ser local y justificada. |
| `ENG-007` | **Pendiente** | Existen llamadas `console.*` fuera del logger estructurado en carga de menú, settings y concierge. | Centralizar eventos en el logger seguro, con códigos estables y sin cuerpos externos ni datos sensibles. |
| `ENG-008` | **Pendiente** | Hay 1.856 líneas TypeScript/TSX por encima de 120 caracteres y cinco archivos con CRLF, además de JSX comprimido. | Aplicar formatter en un checkpoint mecánico separado; evitar reformatear archivos no relacionados durante un feature. |
| `ENG-009` | **Pendiente** | El script raíz `typecheck:direct` omite `apps/dashboard`, aunque el typecheck directo del dashboard pasa. | Incluir todos los workspaces aplicables o retirar el script redundante después de asegurar una ruta canónica equivalente. |
| `ENG-010` | **Pendiente** | No existe automatización CI versionada bajo `.github/workflows`. | Añadir gates reproducibles de test, typecheck y build después de estabilizar el flujo local y antes de depender de merges automatizados. |
| `ENG-011` | **Pendiente** | Una parte relevante de las pruebas inspecciona source o conserva estructura; los E2E reales y métricas de cobertura siguen incompletos. | Priorizar pruebas de comportamiento y añadir E2E según el riesgo de cada feature; las pruebas estructurales no son evidencia única. |
| `ENG-012` | **Pendiente** | El repositorio fija `pnpm@9.15.0`, pero el runtime actual de Codex resuelve un fallback `pnpm@11.16.0`. | Hacer que el entorno de ejecución respete la versión fijada antes de usar los comandos raíz como gate automático. |

El estándar aplicable a cualquier corrección de este backlog es `CODESTYLE.md`. El estado permanece
**Pendiente** hasta que una implementación aprobada, sus pruebas y la documentación demuestren que el
ítem completo —o un alcance explícitamente dividido— fue resuelto.

## Desalineaciones prioritarias

1. `automation_enabled` mezcla disponibilidad operativa con modalidad comercial pública.
2. Presencia Digital aún no cumple la landing, branding, dominio y autogestión estándar.
3. El paquete completo no tiene carrito web multi-producto ni entitlements propios.
4. La operación humana de conversaciones y alertas es incompleta.
5. El concierge público no tiene rate limiting/cuotas visibles.
6. El onboarding de schemas necesita exposición Data API y grants explícitos, además de RLS; no puede asumirse que una tabla nueva quede expuesta automáticamente.
7. No hay automatización CI versionada en `.github/workflows`.

## Cambios recientes

- **2026-09-07:** se implementó el MVP interno de enlaces físicos QR/NFC: inventario global en `control`, códigos permanentes de 12 caracteres, auditoría append-only, creación idempotente de lotes, estados terminales, validación segura de destinos y suspensión automática al inactivar un negocio. El Worker sirve `GET|HEAD /r/:code` para `go.thaledon.com` con `302` no cacheable y páginas de respaldo; el dashboard de administrador incluye creación, edición, activación, exportación CSV/SVG/PNG e hitos NFC. Falta el paso externo de migrar la zona DNS a Cloudflare, asociar el Custom Domain del Worker y completar el canario/lectura física antes de imprimir en producción.

- **2026-08-13:** se ejecutaron recorridos E2E headless reales con Gemini `gemini-2.5-flash`, sin
  dobles fijos, con cinco planes JSON válidos, pedido persistido, captura sin Meta, snapshots de draft/order,
  IDs opacos de efectos, retry, conflicto, inspección y cierre. Se corrigió la persistencia anidada del
  manifiesto mediante una migración forward, se añadieron fingerprints hash y se retiró `aiFixtureId`
  del protocolo operativo de la CLI. El journal ahora serializa actualizaciones concurrentes, las
  sesiones expiran por inactividad, los turnos pausados quedan en `pending` y la reactivación reclama
  atómicamente el último inbound headless. El journal mantiene lock durante todo el turno y vincula
  identidad/sesión a tenant, proyecto local y origen `headless`; un turno huérfano queda `indeterminate`
  antes de permitir continuidad. Las suites directas actuales: API 243 pruebas, 226 pasaron y 17
  opt-in omitidas; la integración headless local ejecutó 76 pruebas, 75 pasaron y 1 E2E externo se
  omitió. La corrida opt-in más reciente de ocho turnos completó 8/8 planes con Gemini real y persistió
  un pedido; una corrida anterior recibió 429 por cuota agotada y quedó como fallback seguro. La
  reconciliación ahora usa el resultado autoritativo de Supabase en CLI
  y dashboard, y el journal rechaza cruces de tenant/identidad e IDs duplicados. El flujo completo
  local con doble inline cubre ocho turnos, pedido, retry, conflicto, inspect, close, pausa/reactivación
  y fallos después de draft/orden sin replay; la ruta HTTP autenticada del dashboard usa la misma decisión.

- **2026-08-12:** se incorporó el límite post-normalización compartido y la base de CLI headless local
  con captura sin Meta, journal de sesiones, envelope seguro, reconciliación y migración de
  checkpoint.

- **2026-08-12:** integración de Spec Kit, constitución de ingeniería, arquitectura, testing,
  CODESTYLE y backlog incremental de salud técnica.
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
