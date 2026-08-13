# Plan de implementación: Chat headless local

**Rama**: `feature/headless-mode` | **Fecha**: 2026-08-12 | **Especificación**: [spec.md](./spec.md)

**Estado**: Approved — aprobación explícita del usuario el 2026-08-12.

**Entrada**: especificación aprobada en `specs/001-headless-chat/spec.md`.

**Gate de implementación**: las decisiones pendientes del análisis del 2026-08-12 están integradas;
resta repetir `$speckit-analyze` y resolver cualquier hallazgo bloqueante nuevo.

## Resumen

Se añadirá una interfaz de consola exclusivamente local y habilitada de forma explícita en debug para iniciar sesiones, enviar turnos, inspeccionar estado y cerrar sesiones. El adaptador headless normalizará su entrada y entregará el turno al mismo caso de uso conversacional que WhatsApp usa después de normalizar el transporte. El router, la interpretación por IA, las acciones controladas, validaciones, persistencia de negocio y transiciones serán únicos y compartidos.

La identidad sintética será nueva por defecto para cada inicio de sesión, o podrá seleccionarse mediante un identificador headless preexistente dentro del tenant indicado. Persistencia y servicios Supabase serán exclusivamente los del stack local definido por `supabase/config.toml`; un archivo de ambiente dedicado y no versionado será obligatorio. La CLI podrá seleccionar cualquier tenant registrado en esa base local y usar sus credenciales de acceso total, sin aceptar schemas arbitrarios. Un journal atómico bajo `.local/headless-chat/` conservará identidades, sesiones, claims y resultados seguros. Todo texto procesable por automatización llegará al modelo, que seleccionará operaciones de un catálogo provider-neutral equivalente al plan estructurado actual; durante pausa manual no se invoca IA y, al reactivarla, el último inbound pendiente se reclama y procesa una vez. La salida se abstraerá detrás de un puerto: WhatsApp conservará Meta como adaptador y todo procesamiento cuyo inbound tenga origen headless capturará sin Meta, tanto dentro del turno CLI como durante su reactivación posterior; esta última captura será observable por `inspect` sin reescribir el resultado durable anterior.

## Evidencia del estado actual

| Evidencia | Responsabilidad o comportamiento verificado | Relevancia |
| --- | --- | --- |
| `apps/api/src/modules/whatsapp-webhook/handler.ts:100` (`handleInboundMessage`) | Resuelve tenant y cliente, abre o reutiliza conversación, registra el mensaje y llama al router. | El límite reutilizable todavía está dentro del adaptador WhatsApp y debe extraerse sin duplicarlo. |
| `apps/api/src/features/chat-routing/router.ts:34` (`routeInboundMessage`) | Ejecuta ramas textuales determinísticas y luego interpretación semántica sobre el mismo estado. | El flujo compartido debe eliminar esos bypass y ofrecer sus decisiones como herramientas controladas a la IA antes de conectar headless. |
| `apps/api/src/features/chat-routing/outbound/send.ts` | Envía texto directamente mediante el cliente de WhatsApp y luego registra el resultado. | Impide capturar salidas headless sin llamar a Meta; requiere un puerto de entrega. |
| `apps/api/src/features/dashboard/support/notifications.ts` y `apps/api/src/features/dashboard/routes/lunch-reminders.ts` | Otras transiciones pueden emitir mensajes posteriormente por Meta. | Quedan fuera de la captura headless porque no se producen dentro del turno; el resultado no debe atribuírselas. |
| `apps/api/src/modules/whatsapp-webhook/whatsapp-client.ts:61` | Construye llamadas a `graph.facebook.com`. | Debe quedar fuera de todo camino headless y ser detectable en pruebas. |
| `apps/api/src/features/chat-routing/semantic/operation-plan.ts:157` | Construye el router real Gemini/OpenRouter y valida el resultado estructurado. | El `test_double` inline debe sustituir solo la respuesta cruda del proveedor, no parser, esquema ni acciones. |
| `apps/api/src/features/conversations/service.ts:24` | Las conversaciones se persisten con canal `whatsapp` y vencen según la política actual. | Se preservará el modelo de conversación para no crear un flujo alternativo; el origen se deriva del mensaje entrante. |
| `apps/api/src/modules/message-log/message-log.ts:142` | El registro saliente fija hoy `whatsapp_cloud`. | Debe registrar `headless` cuando la salida fue capturada y conservar WhatsApp sin cambios. |
| `supabase/migrations/20260709193000_control_tenant_demo_baseline.sql:1013` | Existe unicidad por `(provider, provider_message_id, direction)` en mensajes. | Sirve como segunda barrera de idempotencia usando un ID compuesto de sesión y turno. |
| `apps/api/src/index.ts` y `apps/api/wrangler.toml:2` | El Worker solo monta rutas HTTP desde `src/index.ts`; staging y producción tienen `APP_ENV` propios. | La CLI debe ser una entrada separada, sin ruta Hono ni importación desde el Worker. |
| `.specify/memory/constitution.md`, `ARCHITECTURE.md`, `CODESTYLE.md`, `TESTING.md` | Exigen tenant explícito, backend autoritativo, IA validada y evidencia conductual. | Definen los gates del diseño y la verificación final. |

## Contexto técnico

**Lenguaje/versión**: TypeScript 5.x en Cloudflare Workers y Node.js 22 para la entrada CLI.

**Dependencias primarias**: dependencias existentes de `apps/api`; APIs estándar de Node para stdin, filesystem, locks y serialización. No se añade dependencia de producción.

**Almacenamiento**: tablas de negocio existentes en el Supabase/Postgres local por tenant; journal de control en `.local/headless-chat/v1/`. Habrá una migración compartida para reclamar de forma durable el inbound pendiente al salir de manual; no habrá tablas ni schemas headless.

**Pruebas**: `node:test`, pruebas unitarias con fakes, integración contra tenants del Supabase local reiniciable, contrato JSON, paridad parametrizada, concurrencia e inspección del bundle generado por `wrangler deploy --dry-run`.

**Plataforma objetivo**: CLI local en macOS/Linux conectada exclusivamente al stack Supabase local del repositorio. El Worker de Cloudflare conserva los adaptadores existentes y añade únicamente captura y reconciliación compartidas sin superficie headless: no importa CLI, journal, dobles de prueba, archivo de ambiente ni gates debug.

**Objetivos de rendimiento**: no se fija una latencia propia en esta versión porque pueden intervenir proveedores IA/geocodificación externos; se limita cada turno a 4096 caracteres Unicode y una operación activa por sesión. La prioridad medible es corrección, aislamiento y ausencia de duplicados.

**Restricciones**: entrada CLI local ausente del bundle; archivo `.env.headless.local` obligatorio e ignorado por Git; `APP_ENV=local`, debug explícito y endpoints loopback coincidentes con los puertos de `supabase/config.toml` antes de resolver tenant; `[api].schemas` sincronizado con `control`, `tenant_template` y todos los tenants registrados; tenant explícito en cada comando; identidad solo headless y vinculada al tenant; cero llamadas a Meta durante el turno; resultados versionados y sin secretos; texto procesable por IA y catálogo de operaciones controladas; misma autoridad backend, validación e idempotencia que WhatsApp.

**Escala/alcance**: una nueva entrada CLI, extracción de un caso de uso normalizado, migración de bypass textuales a IA con herramientas, puertos estrechos de entrega/IA/tiempo, journal local y suites de contrato, integración y paridad. Se añade una operación backend autenticada de reconciliación al dashboard, sin UI nueva ni semántica headless, para recuperar el claim compartido en cualquier ambiente. No se añade transporte multimedia completo ni soporte de CLI headless en desplegados.

## Verificación de constitución

### Gate previo a investigación

- **I. Especificación y evidencia**: aprobado. La SPEC existe, fue aclarada y su checklist de requisitos está completo; la evidencia del código está citada arriba.
- **II. Límites y dependencias**: aprobado. La CLI será un adaptador externo; el caso de uso compartido y los puertos viven en el feature dueño. No habrá importación desde negocio hacia CLI ni desde Worker hacia headless.
- **III. Pruebas conductuales**: aprobado. Cada requisito tendrá evidencia observable; las inspecciones de bundle complementan y no sustituyen pruebas de comportamiento.
- **IV. Entrega incremental**: aprobado. La implementación se podrá dividir en extracción segura, plano local, captura de salida y paridad, cada fase verificable.
- **V. IA y acciones controladas**: aprobado contra la constitución 2.0.0. Mientras la automatización efectiva está deshabilitada, el inbound se conserva pero no se interpreta por IA; al reanudar, solo el último inbound que continúe pendiente atraviesa IA una vez. Fuera de esa pausa, todo texto procesable atraviesa IA, las operaciones válidas se exponen mediante un catálogo provider-neutral por estado y solo el backend validado ejecuta acciones.
- **Tenant y seguridad**: aprobado. El slug se resuelve en `control.tenants`; el esquema se deriva de ese registro. Ningún nombre de esquema proviene directamente del comando.
- **Idempotencia y concurrencia**: aprobado. Lock y claim local preceden efectos; la restricción de mensajes existente actúa como defensa adicional.
- **Datos y despliegue**: aprobado. No se crean tablas, grants ni políticas headless; la migración compartida define el claim de inbound manual reutilizando `messages.status` y funciones tenant-aware. El journal no forma parte de artefactos desplegables.

### Revisión posterior al diseño de Fase 1

El gate sigue aprobado contra la constitución 2.0.0. Los contratos propuestos mantienen el flujo único, hacen explícitos los estados indeterminados y verifican ausencia del runner en el bundle. Las complejidades deliberadas se justifican en la sección final.

## Arquitectura y responsabilidades objetivo

### Flujo resultante

```text
WhatsApp webhook                              CLI local debug
  validar firma/evento                         cargar .env.headless.local
  normalizar transporte                        validar debug + Supabase loopback/config.toml
  resolver tenant                              validar comando + tenant + sesión
            \                                  /
             └── processNormalizedChatTurn ───┘
                   persistir/reusar inbound y reclamar procesamiento
                   si manual: conservar último pendiente, marcar anteriores superseded,
                              sin IA ni respuesta
                   si automatización activa:
                     resolver identidad/cliente y conversación
                     ejecutar router canónico
                       ├── IA real o `test_double` crudo (solo tests)
                       ├── catálogo provider-neutral permitido por estado
                       ├── parser y validaciones comunes
                       ├── manifiesto durable sanitizado antes de mutar
                       └── ejecución/transiciones autoritativas con stale guards
                   entregar mediante OutboundDeliveryPort
                     ├── WhatsAppDelivery -> Meta + log
                     └── HeadlessCapture compartido -> log captured, sin Meta
                           └── observer/journal solo cuando existe turno CLI activo
                   proyectar snapshot seguro

Reactivación manual
  dashboard/caso de uso compartido
    └── reactivar + reclamar atómicamente último inbound pendiente
          └── processNormalizedChatTurn sin volver a insertar inbound
                └── origen headless -> persistir outbound captured, cero Meta,
                                      visible luego por inspect

Reconciliación compartida
  CLI local o dashboard autenticado
    └── reconcileNormalizedChatTurn
          ├── nunca invoca IA ni ejecutores
          ├── bloquea mensaje/conversación/targets en orden estable
          ├── compara manifiesto + pre/postcondiciones + claves idempotentes
          └── applied si todos; failed si ninguno; indeterminate si parcial/dudoso
```

### Cambios de responsabilidad

| Límite o componente | Dueño actual | Dueño resultante | Razón |
| --- | --- | --- | --- |
| Orquestación posterior a normalización | `whatsapp-webhook/handler.ts` | `features/chat-routing/process-normalized-chat-turn.ts` | Un solo caso de uso para ambos transportes. |
| Normalización y seguridad de Meta | Webhook WhatsApp | Webhook WhatsApp, sin cambios conceptuales | Sigue siendo responsabilidad del adaptador. |
| Sesión, identidad sintética y claim de turno | No existe | `features/headless-chat/session-journal.ts` | Plano de control exclusivamente local y atómico. |
| Selección de tenant | Implícita por número de WhatsApp | WhatsApp por número; CLI por slug explícito resuelto en control | Evita selección arbitraria de esquemas. |
| Entrega de respuestas conversacionales | Llamadas directas a Meta | Puerto común seleccionado por origen persistido del inbound: WhatsApp o captura headless | Garantiza cero Meta para todo inbound headless, incluso si se procesa posteriormente al reactivar; excluye notificaciones no relacionadas. |
| Interpretación de texto automatizable | Bypass textuales más plan semántico | IA común con catálogo provider-neutral permitido por estado, adaptador real y doble inline de test | Elimina decisiones textuales fuera del modelo sin ceder autoridad; manual/automatización off no invocan IA. |
| Reanudación desde manual | Dashboard cambia estado pero no procesa mensajes acumulados | Caso de uso compartido reactiva, reclama el último inbound pendiente y lo procesa una vez | Evita dejar sin respuesta el último mensaje del cliente y contiene reintentos/concurrencia. |
| Reconciliación de claim incierto | No existe | Caso de uso backend común invocado por CLI y dashboard autenticado | Evita acceso SQL manual y aplica la misma evidencia/locks en local y desplegados. |
| Diagnóstico del turno | Logs internos dispersos | Captura autoritativa completa dentro del tenant y proyección pública redactada/versionada | Preserva paridad sin filtrar dirección, billing ni otros datos sensibles al agente. |
| Persistencia de negocio | Servicios/repositorios actuales | Los mismos servicios/repositorios actuales | Preserva paridad y autoridad. |

### Contratos y datos

- **Contratos/interfaces/eventos**: se añade un protocolo JSON por stdin/stdout con comandos `start`, `turn`, `inspect`, `reconcile` y `close`, además de puertos internos para entrega y generación semántica. `reconcile` solo opera sobre un turno `indeterminate`, recibe la observación declarada por el operador y delega en `reconcileNormalizedChatTurn`. El dashboard añade una operación autenticada equivalente, tenant-scoped y protegida por la autorización existente; no acepta schema, manifest ni estado final suministrados por el caller.
- **Prompts/acciones controladas**: el contrato semántico mantendrá un catálogo provider-neutral serializado dentro del input estructurado del modelo; no serán callbacks ejecutables ni tool-calling nativo dependiente del proveedor. Cada operación tendrá nombre, schema de argumentos, estados permitidos y ejecutor backend. El catálogo incorporará saludo/menú, consulta de estado, humano, pago, billing y configuración, además de las operaciones actuales de draft/checkout. La CLI siempre usa el proveedor real; las respuestas controladas solo se inyectan internamente en harnesses de prueba.
- **Manual, claim y manifiesto**: `messages.status` tendrá semántica compartida para inbound `logged` (pendiente), `processing`, `processed`, `superseded` e `indeterminate`. Cada nuevo inbound recibido durante la pausa marca atómicamente `superseded` al pendiente anterior. Una RPC tenant-aware reclama el último inbound con `SELECT ... FOR UPDATE`, sin `SKIP LOCKED`, y actualiza estado bajo precondiciones explícitas. Después de IA/parser/validación y antes de la primera mutación, otra operación tenant-aware vuelve a comprobar versiones y guarda en `messages.payload.internal.execution_manifest` una versión canónica sanitizada: digest del plan validado, tipos de operación, IDs canónicos internos, claves idempotentes, versiones/digests previos y huellas de postcondiciones; nunca texto libre, dirección, billing, prompt, raw de IA ni secretos. Los ejecutores conservan sus transacciones/stale guards y el mensaje solo pasa a `processed` tras confirmar todos los efectos esperados. Si es `headless`, la respuesta se registra outbound con `provider=headless`, `status=captured` y correlación segura con sesión/turno; el journal original permanece inmutable.
- **Reconciliación**: `reconcileNormalizedChatTurn` carga el manifiesto y adquiere locks de fila sobre mensaje, conversación y targets en orden estable. No invoca IA, geocodificación, delivery ni ejecutores. La observación del operador es solo evidencia adicional: resuelve `applied` cuando todos los postcondition digests/idempotency keys existen y las precondiciones ya no aplican; resuelve `failed` cuando las precondiciones continúan y no existe ningún efecto esperado; conserva `indeterminate` ante subset parcial, versiones incompatibles, manifest ausente/corrupto o evidencia contradictoria. El cierre usa una RPC `security invoker`, revalida manifest digest/versiones dentro de la misma transacción y actualiza el mensaje solo desde `processing|indeterminate`; nunca reabre `processed|superseded`.
- **Captura y proyección segura**: el outbound tenant-local conserva el texto completo que el cliente habría recibido y es la fuente de paridad. `SafeCapturedResponseProjection` produce stdout/journal/`inspect`: sustituye valores sensibles conocidos desde el contexto autoritativo, aplica detectores allowlisted de secretos/PII y devuelve `redacted` más `redactionCodes`; nunca modifica el registro de negocio. Las pruebas de paridad comparan la captura completa dentro del harness seguro y las pruebas de contrato comparan únicamente la proyección redactada.
- **Datos/migraciones**: se añadirá una migración compartida en `supabase/migrations/` para backfill, estados, claim, checkpoint y cierre de reconciliación, propagada al template y tenants existentes. Antes de activar la nueva semántica, marca `processed` todos los inbound preexistentes `logged`; no infiere pendientes históricos. Las funciones usan `security invoker`, califican relaciones, revocan `EXECUTE` de `PUBLIC`, `anon` y `authenticated`, y conceden solo `service_role`; no cambian RLS ni crean tabla/columna/schema headless. Los datos headless se escriben en cualquier tenant local registrado; identidades, sesiones y claims exclusivos de CLI permanecen en el journal ignorado por Git.
- **Schemas locales expuestos**: como los repositorios compartidos usan PostgREST por schema, `supabase/config.toml` debe exponer `control`, `tenant_template` y cada `schema_name` registrado. Un helper local idempotente sincroniza la lista ordenada y exige reiniciar Supabase cuando cambia; la CLI rechaza un tenant aún no expuesto en lugar de usar acceso Postgres alterno.
- **Compatibilidad**: WhatsApp conserva contrato, normalización e idempotencia. La extracción se protege con pruebas de caracterización antes del cambio. El journal lleva versión de formato y rechaza versiones desconocidas.

## Estructura del proyecto

### Documentación del feature

```text
specs/001-headless-chat/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli-protocol.md
│   ├── headless-command.schema.json
│   ├── headless-result.schema.json
│   ├── parity-projection.md
│   └── runtime-ports.md
└── tasks.md                 # creado posteriormente por $speckit-tasks
```

### Árbol fuente objetivo

```text
[ADD]    apps/api/headless/cli.mjs
[ADD]    apps/api/src/features/headless-chat/application.ts
[ADD]    apps/api/src/features/headless-chat/contracts.ts
[ADD]    apps/api/src/features/headless-chat/result.ts
[ADD]    apps/api/src/features/headless-chat/session-journal.ts
[ADD]    apps/api/src/features/headless-chat/snapshot.ts
[ADD]    apps/api/src/features/headless-chat/tenant.ts
[ADD]    apps/api/src/features/chat-routing/ports.ts
[ADD]    apps/api/src/features/chat-routing/process-normalized-chat-turn.ts
[ADD]    apps/api/src/features/chat-routing/reconcile-normalized-chat-turn.ts
[MODIFY] apps/api/src/modules/whatsapp-webhook/handler.ts
[MODIFY] apps/api/src/features/dashboard/routes/conversations.ts
[MODIFY] apps/api/src/features/conversations/service.ts
[MODIFY] apps/api/src/features/chat-routing/router.ts
[MODIFY] apps/api/src/features/chat-routing/outbound/send.ts
[ADD]    apps/api/src/features/chat-routing/outbound/capture.ts
[MODIFY] apps/api/src/features/chat-routing/semantic/operation-plan.ts
[MODIFY] apps/api/src/features/chat-routing/semantic/order.ts
[MODIFY] apps/api/src/modules/message-log/message-log.ts
[MODIFY] apps/api/package.json
[MODIFY] apps/api/.dev.vars.example
[ADD]    apps/api/.env.headless.local.example
[MODIFY] .gitignore
[MODIFY] supabase/config.toml
[ADD]    supabase/migrations/<timestamp>_claim_pending_inbound_on_automation_resume.sql
[ADD]    scripts/bash/sync-local-supabase-schemas.sh
[ADD]    apps/api/test/support/headless-chat-harness.mjs
[NO ADD] apps/api/test/fixtures/headless-chat/* (prohibido: no se añade catálogo ni JSON de fixtures)
[ADD]    apps/api/test/normalized-chat-use-case.test.mjs
[ADD]    apps/api/test/headless-chat-contract.test.mjs
[ADD]    apps/api/test/headless-chat-session.test.mjs
[ADD]    apps/api/test/headless-chat-isolation.test.mjs
[ADD]    apps/api/test/headless-chat-idempotency.test.mjs
[ADD]    apps/api/test/headless-chat-failures.test.mjs
[ADD]    apps/api/test/headless-chat-parity.test.mjs
[ADD]    apps/api/test/headless-chat-deployment.test.mjs
[ADD]    scripts/bash/verify-no-headless-deploy.sh
[MODIFY] docs/architecture/backend.md
[MODIFY] docs/flows/conversation-flow.md
[MODIFY] docs/runbooks/local-setup.md
[MODIFY] docs/runbooks/smoke-tests.md
[MODIFY] docs/current-status.md
```

| Ruta | Cambio | Responsabilidad resultante |
| --- | --- | --- |
| `apps/api/headless/cli.mjs` | ADD | Entrada Node sin importación desde el Worker; lee una línea JSON y emite una línea JSON. |
| `apps/api/src/features/headless-chat/*` | ADD | Gates locales, comandos, journal, snapshots y serialización segura; no contiene fixtures ni catálogo de respuestas. |
| `apps/api/src/features/chat-routing/process-normalized-chat-turn.ts` | ADD | Caso de uso canónico posterior a normalización. |
| `apps/api/src/features/chat-routing/reconcile-normalized-chat-turn.ts` | ADD | Valida manifest/pre/postcondiciones sin IA ni replay y resuelve claims inciertos para CLI/dashboard. |
| `apps/api/src/features/chat-routing/ports.ts` | ADD | Puertos estrechos de entrega, IA, reloj e IDs. |
| `apps/api/src/modules/whatsapp-webhook/handler.ts` | MODIFY | Delega el tramo común después de validar y normalizar Meta. |
| `apps/api/src/features/dashboard/routes/conversations.ts` y `features/conversations/service.ts` | MODIFY | Reactivan automatización, reclaman/procesan el último inbound y exponen reconciliación autenticada mediante el caso de uso compartido. |
| `apps/api/src/features/chat-routing/{router,outbound/send,outbound/capture,semantic/operation-plan,semantic/order}.ts` | MODIFY/ADD | Envía todo texto automatizable a IA, expone el catálogo por estado, valida y recibe puertos sin duplicar ejecutores; la captura compartida persiste entrega `captured` por origen sin importar CLI, journal ni flags locales. |
| `apps/api/src/modules/message-log/message-log.ts` | MODIFY | Registra proveedor/estado reales, checkpoint sanitizado, captura completa tenant-local y consultas para proyección segura. |
| `apps/api/.env.headless.local.example` | ADD | Plantilla no secreta del único archivo de ambiente admitido; el archivo real queda ignorado por Git. |
| `supabase/config.toml` y `scripts/bash/sync-local-supabase-schemas.sh` | MODIFY/ADD | Exponen/sincronizan en PostgREST local `control`, template y todos los schemas tenant registrados, sin tocar proyectos remotos. |
| `supabase/migrations/*_claim_pending_inbound_on_automation_resume.sql` | ADD | Backfill, supersede/claim, checkpoint y cierre de reconciliación tenant-aware con locks, precondiciones y grants mínimos. |
| `specs/001-headless-chat/contracts/dashboard-reconciliation.md` | ADD | Contrato autenticado no-headless que delega en reconciliación compartida sin aceptar schema ni decisión autoritativa. |
| `apps/api/test/headless-chat-*.test.mjs` | ADD | Evidencia de contrato, sesiones, aislamiento, fallos, idempotencia, paridad y ausencia en despliegue. |
| `scripts/bash/verify-no-headless-deploy.sh` | ADD | Construye el Worker en dry-run e inspecciona los artefactos sin desplegar. |
| Documentación durable | MODIFY | Describe límite compartido, operación local y estado real implementado. |

## Estrategia de pruebas y trazabilidad

| Requisito | Escenario o riesgo | Nivel | Archivo/evidencia objetivo | Aserción esperada |
| --- | --- | --- | --- | --- |
| FR-001, NFR-001 | `start` local/debug con archivo dedicado y tenant explícito | Integración Supabase local | `headless-chat-session.test.mjs`, `headless-chat-deployment.test.mjs` | Solo archivo dedicado, `APP_ENV=local`, debug y endpoints coincidentes con `config.toml` permiten resolver tenant y crear sesión. |
| FR-002, FR-012, FR-013 | Multiturno, expiración, terminales y pausa/reanudación | Integración Supabase local | `headless-chat-session.test.mjs`, `conversation-automation.test.mjs` | Manual no invoca IA; reactivar reclama/procesa una vez el último inbound pendiente; conserva terminales y ventana de 30 minutos. |
| FR-003, FR-004, FR-005, FR-020, NFR-007 | Límite único, texto automatizable por IA y equivalencia funcional | Caracterización + integración | `normalized-chat-use-case.test.mjs`, `headless-chat-parity.test.mjs` | Intenciones antes determinísticas pasan por catálogo estructurado/IA y ambos adaptadores producen la misma proyección en los 15 escenarios definidos. |
| FR-006, FR-007, FR-008, NFR-003 | Captura ordenada sin Meta ni estados fabricados | Integración con red espía | `headless-chat-parity.test.mjs`, `headless-chat-failures.test.mjs` | Cero `graph.facebook.com`; captura interna completa conserva paridad y la proyección pública redactada no fabrica IDs Meta. |
| FR-009, FR-014, NFR-008 | Retry, checkpoint, reconciliación y confirmación única | Integración concurrente + fault injection | `headless-chat-idempotency.test.mjs`, `conversation-reconciliation.test.mjs` | Crash antes/después de checkpoint/commit se clasifica con manifiesto; CLI/dashboard producen la misma resolución y nunca reejecutan. |
| FR-010, FR-011, NFR-004, NFR-005, NFR-006 | Contrato estructurado, seguro y versionado | Contrato + sanitización | `headless-chat-contract.test.mjs`, `headless-chat-sanitization.test.mjs`, schemas JSON | Envelope indica `redacted`/códigos; stdout, stderr, journal e inspect no filtran dirección, billing, secretos, raw, prompts o URLs. |
| FR-015 | IA inválida/baja confianza | Integración | `headless-chat-failures.test.mjs` | Aplica fallback, aclaración, contador y handoff canónicos sin acción inválida. |
| FR-016 | IA, DB, catálogo, cobertura u otro servicio no disponible | Integración | `headless-chat-failures.test.mjs` | Resultado seguro no confunde fallo con éxito y conserva estado cuando no hay acción válida. |
| FR-017 | Inspección sin efectos | Integración | `headless-chat-session.test.mjs` | Snapshot permitido sin renovar expiración, IA, routing ni mutación. |
| FR-018 | Cierre y retención | Integración | `headless-chat-session.test.mjs` | `close` es idempotente, bloquea turnos y no borra historial/draft/pedido/alertas. |
| FR-019 | Solo texto y límites explícitos | Contrato | `headless-chat-contract.test.mjs` | 4096 caracteres acepta; 4097, vacío y tipos de media se rechazan antes de IA/negocio. |
| FR-021 | Solo local/debug y ausente del despliegue | E2E local + inspección bundle | `headless-chat-deployment.test.mjs`, script dry-run | Fuera de gates falla cerrado; bundle y rutas desplegables no contienen interfaz headless. |
| FR-022, FR-024, NFR-002 | Identidad nueva/preexistente y aislamiento | Integración con dos tenants | `headless-chat-isolation.test.mjs`, `headless-chat-session.test.mjs` | Nueva por defecto; reuse válido; WhatsApp, inexistente o cross-tenant se rechaza sin fuga. |
| FR-023 | IA real por defecto; `test_double` inline explícito | Unidad + integración | `headless-chat-failures.test.mjs`, `headless-chat-parity.test.mjs` | El doble sustituye solo raw y atraviesa parser; sin doble usa configuración real del tenant. |
| NFR-009 | Operabilidad por agente | E2E guiado | `quickstart.md` y evidencia de revisión | Un agente completa start/turn/inspect/close en menos de 10 minutos y puede reconciliar un turno indeterminado sin Meta ni conocimiento SQL. |

Secuencia obligatoria: (1) caracterizar WhatsApp, pausa/reanudación y bypass actuales; (2) escribir regresiones que exijan IA/catálogo para toda intención automatizable y ausencia de IA durante manual; (3) implementar claim durable del inbound pendiente y extraer el caso de uso normalizado; (4) probar contrato, gates y journal con idempotencia completa; (5) integrar contra al menos dos tenants del Supabase local reiniciable; (6) ejecutar paridad, suite completa, typecheck, lint y dry-run. Los dobles inline modelan solo salida cruda de IA y fallos externos; repositorios y ejecutores no se simulan en integración.

Comandos previstos después de implementar: `supabase status`, `pnpm --filter @42day/api test`, scripts focalizados `test:headless` y `test:headless:integration`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` y `scripts/bash/verify-no-headless-deploy.sh`. La integración debe fallar como prerrequisito no satisfecho si el stack local, archivo dedicado o seed no están disponibles; nunca debe caer a un proyecto remoto ni sustituirse silenciosamente por fakes.

## Entrega, observabilidad y recuperación

- **Rollout**: el catálogo provider-neutral y la reanudación desde manual modifican el flujo compartido desplegable; se validan primero contra Supabase local con caracterización/paridad. La CLI permanece local y ausente del Worker. La migración compartida se verifica localmente antes de cualquier rollout remoto posterior, que queda fuera de la ejecución headless.
- **Observabilidad**: stdout queda reservado al envelope JSON redactado. Diagnósticos van a stderr con IDs opacos, etapa, duración y código seguro; nunca texto del cliente, respuesta completa, manifest, digests correlacionables fuera del tenant, prompt, raw, tokens, credenciales o URLs firmadas. La captura completa permanece en `messages` dentro del tenant y solo el harness de integración autorizado la usa para paridad.
- **Contención de fallos**: claim durable, manifest previo a mutaciones, stale guards y transacciones de ejecutores reducen la ventana incierta. Fault injection cubre crash antes del manifest, después del manifest, durante rollback, después de commit y antes de finalizar mensaje/journal. Ningún timeout dispara replay. `inspect` expone solo evidencia segura; CLI y dashboard delegan en reconciliación común, que resuelve únicamente todo/nada y conserva `indeterminate` ante parcialidad.
- **Rollback**: retirar script/entrada y módulos headless no revierte datos. La extracción/catálogo compartidos se revierten como unidad si fallan caracterizaciones; la RPC/semántica de estados se retira solo mediante una migración forward que preserve mensajes existentes. El journal versionado puede conservarse o borrarse como limpieza local explícita; `close` no borra negocio.

## Seguimiento de complejidad

| Complejidad | Por qué se necesita | Alternativa simple rechazada porque | Dueño/condición de retiro |
| --- | --- | --- | --- |
| Journal filesystem además de Postgres | Se necesita sesión/idempotencia local sin dejar tablas headless en artefactos desplegados. | Tablas canónicas simplificarían consultas, pero violan la ausencia estricta de infraestructura headless desplegable; memoria de proceso no sobrevive entre comandos. | Feature headless; retirar si una decisión futura autoriza infraestructura de control local dentro de migraciones. |
| Credenciales locales con acceso total | La base es local, reiniciable y el runner debe poder operar sobre cualquier tenant registrado. | Restringir con RLS/roles por tenant no añade seguridad frente al dueño de la máquina y complicaría la paridad backend. | Dueño: feature headless; nunca trasladar esta autorización a un Supabase remoto. |
| Manifiesto de ejecución dentro de `messages.payload.internal` | Reconciliar tras un crash exige evidencia durable previa a efectos sin crear infraestructura headless ni almacenar el plan/PII en journal. | Inferir desde estado final es ambiguo y reejecutar IA rompe idempotencia; una tabla nueva ampliaría migración y superficie sin necesidad. | Dueño: chat-routing; retirar solo si el modelo canónico incorpora un ledger transaccional equivalente. |
