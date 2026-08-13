---

description: "Tareas ordenadas por dependencias para el chat headless local de ParaHoy"
---

# Tareas: chat headless local

**Entrada**: artefactos aprobados de `specs/001-headless-chat/`
**Prerrequisitos**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` y revisión humana de `checklists/readiness.md`.

**Pruebas**: obligatorias. Las tareas de prueba preceden o acompañan el comportamiento dueño y cada FR/NFR queda trazado a evidencia ejecutable.

## Formato: `[ID] [P?] [Story] Descripción`

- **[P]**: puede ejecutarse en paralelo después de satisfacer dependencias porque no edita los mismos archivos.
- **[Story]**: historia dueña (`US1`–`US5`); setup, cimientos y cierre no llevan etiqueta.
- Cada tarea incluye rutas concretas, requisitos y resultado observable.

> **Gate previo a implementación**: el implementador no autoaprueba `checklists/readiness.md`. Un revisor debe registrar su disposición y `$speckit-analyze` debe resolver inconsistencias bloqueantes antes de T002.

## Fase 1: Setup y caracterización

**Propósito**: congelar la línea base, preparar evidencia reproducible y evitar que la extracción cambie WhatsApp inadvertidamente.

- [X] T001 Registrar la revisión humana de los 40 ítems sin autoaprobación del implementador en `specs/001-headless-chat/checklists/readiness.md` y corregir primero cualquier gap bloqueante en `specs/001-headless-chat/spec.md` o `specs/001-headless-chat/plan.md`.
- [X] T002 Ejecutar `supabase status` y la línea base `pnpm --filter @42day/api test`, `pnpm --filter @42day/api typecheck` y `pnpm --filter @42day/api build`; registrar comando, fecha, versiones de Supabase/Node/pnpm, schemas locales expuestos y resultado real en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T003 [P] Añadir caracterización del flujo WhatsApp desde mensaje normalizado hasta router, persistencia y respuesta, incluida pausa manual sin IA y reactivación actual sin procesamiento pendiente ni selección de entrega por origen, en `apps/api/test/normalized-chat-use-case.test.mjs` y `apps/api/test/conversation-automation.test.mjs` para FR-003, FR-004, FR-005, FR-013 y FR-020.
- [X] T004 [P] Añadir caracterización de todas las llamadas salientes emitidas dentro de un turno del router y de la ausencia actual de captura al reactivar desde dashboard en `apps/api/test/customer-outbound-delivery.test.mjs` para FR-006, FR-007 y FR-008, excluyendo dashboard, cron y campañas no relacionados.
- [X] T005 [P] Reemplazar el catálogo fijo de fixtures por dobles deterministas inline y utilidades de test sin PII; no se conserva ningún JSON de catálogo/tenant o respuestas IA seleccionable por runtime, para FR-020 y FR-023.
- [X] T006 [P] Crear utilidades de reloj, IDs, fetch espía y repositorios falsos sin red en `apps/api/test/support/headless-chat-harness.mjs` para NFR-003, NFR-004, NFR-007 y NFR-008.
- [ ] T007 Ejecutar las caracterizaciones de `apps/api/test/normalized-chat-use-case.test.mjs`, `apps/api/test/conversation-automation.test.mjs` y `apps/api/test/customer-outbound-delivery.test.mjs`, documentar la línea base previa a cambios en `specs/001-headless-chat/implementation-evidence.md` y crear el commit enfocado `test(api): characterize normalized chat boundary`.

**Verificación**: las pruebas nuevas pasan contra el código previo y describen los bypass y efectos vigentes como línea base antes de su migración aprobada a IA/herramientas.

**Checkpoint**: línea base y dobles inline revisables; ninguna lógica de producto cambió.

---

## Fase 2: Cimientos compartidos

**Propósito**: extraer el único caso de uso post-normalización y los puertos estrechos que bloquearán todas las historias.

- [X] T008 [P] Extender `apps/api/test/normalized-chat-use-case.test.mjs`, `apps/api/test/conversation-automation.test.mjs` y crear `apps/api/test/conversation-reconciliation.test.mjs` con regresiones que exigen catálogo IA provider-neutral; cero IA/respuesta durante manual; claim único al reactivar; captura completa por origen con proyección segura; checkpoint durable antes del primer efecto; reconciliación CLI/dashboard idéntica; y resultados todo/ninguno/parcial sin replay para FR-003, FR-004, FR-005, FR-006, FR-007, FR-009 y FR-013.
- [X] T009 [P] Definir `NormalizedChatTurn` con origen persistido, `OutboundDeliveryPort`, `SemanticGenerationPort`, `ValidatedExecutionManifest`, `SafeCapturedResponseProjection`, `ClockPort`, `IdPort` y `SafeTurnObserver` en `apps/api/src/features/chat-routing/ports.ts` según `contracts/runtime-ports.md` para FR-003, FR-004, FR-005, FR-007, FR-009 y FR-023.
- [X] T010 Crear con Supabase CLI la migración compartida `supabase/migrations/*_claim_pending_inbound_on_automation_resume.sql` que haga backfill, active estados y exponga RPC tenant-aware de claim, checkpoint de manifiesto, finalización y reconciliación; tomar `SELECT ... FOR UPDATE` sin `SKIP LOCKED` y en orden estable; usar `SECURITY INVOKER` y relaciones calificadas; revocar ejecución de `PUBLIC`, `anon` y `authenticated` y concederla solo a `service_role`; propagar al template/tenants y generalizar provider, provider message ID, estado y `messages.payload.internal.execution_manifest` en `apps/api/src/modules/message-log/message-log.ts` para FR-007, FR-008, FR-009 y FR-013, sin tablas, columnas ni schemas headless.
- [X] T011 Implementar la orquestación común en `apps/api/src/features/chat-routing/process-normalized-chat-turn.ts`, incluido checkpoint del manifiesto validado antes del primer efecto, y el reconciliador sin IA/replay en `apps/api/src/features/chat-routing/reconcile-normalized-chat-turn.ts`; extender `apps/api/src/features/conversations/service.ts` y `apps/api/src/features/dashboard/routes/conversations.ts` para reactivación y para la operación autenticada definida en `contracts/dashboard-reconciliation.md`, ambas tenant-scoped y sin aceptar schema/manifiesto/estado terminal del caller, para FR-002, FR-003, FR-004, FR-007, FR-009, FR-012 y FR-013.
- [X] T012 Refactorizar `apps/api/src/modules/whatsapp-webhook/handler.ts` para conservar validación/normalización Meta y delegar exactamente una vez en `processNormalizedChatTurn` para FR-003, FR-004 y FR-005.
- [X] T013 Adaptar el envío a `OutboundDeliveryPort`, seleccionarlo por origen, implementar `HeadlessCapture` que persista la respuesta completa tenant-local y entregue solo `SafeCapturedResponseProjection`, sin imports CLI/journal/debug, en `apps/api/src/features/chat-routing/outbound/capture.ts`; mantener `WhatsAppDelivery` como dueño exclusivo de Meta en `apps/api/src/features/chat-routing/outbound/send.ts` para FR-006, FR-007, FR-008, FR-010 y FR-011.
- [X] T014 Migrar los bypass textuales de `apps/api/src/features/chat-routing/router.ts` al catálogo provider-neutral permitido por estado en `apps/api/src/features/chat-routing/semantic/operation-plan.ts` y `apps/api/src/features/chat-routing/semantic/order.ts`, incluida `get_order_status`, usando `SemanticGenerationPort` y plan JSON sin callbacks/tool-calling nativo, sin mover validación ni ejecutores backend para FR-004, FR-005, FR-015, FR-016 y FR-023.
- [X] T015 Ejecutar `node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/normalized-chat-use-case.test.mjs apps/api/test/customer-outbound-delivery.test.mjs apps/api/test/conversation-automation.test.mjs` y registrar el resultado en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T016 Ejecutar migraciones/reset sobre Supabase local, las pruebas focalizadas incluida `apps/api/test/conversation-reconciliation.test.mjs`, advisors locales soportados por la versión instalada de Supabase, `pnpm --filter @42day/api test`, typecheck y build; demostrar pausa sin IA, checkpoint/reanudación única, permisos de RPC y reconciliación todo/ninguno/parcial, registrando comandos y resultados reales en `specs/001-headless-chat/implementation-evidence.md`. `supabase db advisors --local` dejó documentado un warning preexistente fuera del alcance headless.
- [X] T017 Documentar el límite post-normalización y la dirección de dependencias en `docs/architecture/backend.md` y `docs/flows/conversation-flow.md` para FR-003 y FR-004.
- [ ] T018 Revisar el diff de `apps/api/src/features/chat-routing/`, `apps/api/src/modules/whatsapp-webhook/` y las pruebas afectadas, y crear el commit enfocado `refactor(api): extract normalized chat use case` solo con verificaciones verdes.

**Verificación**: WhatsApp conserva acciones y transiciones caracterizadas, sustituye los bypass textuales por catálogo IA, omite IA durante manual y procesa una vez el inbound pendiente al reactivar; ningún módulo de negocio importa CLI, filesystem o cliente Meta concreto.

**Checkpoint**: cimientos verificados y commit enfocado antes de iniciar historias.

---

## Fase 3: Historia de usuario 1 — Ejecutar una conversación multiturno real (P1)

**Objetivo**: iniciar una sesión local aislada, enviar texto sucesivo, conservar conversación/draft, confirmar una sola orden, capturar respuestas y cerrar sin tráfico a Meta.

**Prueba independiente**: con un tenant registrado en Supabase local y dependencias controladas, completar una conversación de al menos ocho turnos desde identidad nueva hasta confirmación; reintentar un turno, continuar desde otro proceso, inspeccionar cero tráfico Meta y cerrar sin borrar negocio.

### Pruebas de US1

- [X] T019 [P] [US1] Añadir pruebas de contrato de `start`, `turn`, `reconcile` y `close`, texto vacío/4096/4097 y rechazo de media en `apps/api/test/headless-chat-contract.test.mjs` para FR-001, FR-002, FR-009, FR-018, FR-019, FR-021 y NFR-001.
- [X] T020 [P] [US1] Añadir integración multiturno, retry, continuación cross-process, expiración, backfill, varios inbound manuales, reactivación única, respuesta completa persistida y proyección `captured` visible por `inspect`, checkpoint previo a efectos, reconciliación CLI/dashboard equivalente todo/ninguno/parcial, completed/expired y confirmación única en `apps/api/test/headless-chat-session.test.mjs`, `apps/api/test/conversation-automation.test.mjs` y `apps/api/test/conversation-reconciliation.test.mjs` para FR-002, FR-007, FR-009, FR-012, FR-013, FR-014, FR-018, SC-001, SC-003 y SC-010. La cobertura de integración adicional vive en `headless-chat-full-flow.test.mjs`.
- [X] T021 [P] [US1] Añadir aserción global de cero Meta, persistencia ordenada de la respuesta completa con entrega `captured` sin IDs/acks Meta y emisión exclusiva de su proyección segura al observer, durante el turno y al reactivar desde dashboard, en `apps/api/test/headless-chat-no-meta.test.mjs` para FR-006, FR-007, FR-008, NFR-003 y SC-005.
- [X] T022 [P] [US1] Añadir pruebas de archivo `.env.headless.local` obligatorio, ausencia de fallback, debug, `APP_ENV=local`, `project_id`, endpoints loopback/puertos coincidentes y schema tenant expuesto en `[api].schemas` antes de journal/negocio, incluida configuración internamente coherente que apunta a un Supabase remoto, en `apps/api/test/headless-chat-deployment.test.mjs` para FR-001, FR-021, NFR-001 y SC-009.

### Implementación de US1

- [X] T023 [P] [US1] Definir y validar comandos v1, incluido `reconcile` con `effects_applied|no_effects`, límites textuales, IDs opacos y rechazos de media en `apps/api/src/features/headless-chat/contracts.ts` para FR-001, FR-002, FR-009, FR-018, FR-019 y NFR-006.
- [X] T024 [P] [US1] Implementar carga exclusiva de `.env.headless.local`, gates de CLI/debug/`APP_ENV=local`, lectura de `project_id`/puertos/`api.schemas` desde `supabase/config.toml`, rechazo de endpoints no loopback o tenant no expuesto, y resolución de cualquier tenant registrado a `TenantContext` sin aceptar schema directo en `apps/api/src/features/headless-chat/tenant.ts` para FR-001, FR-021, FR-022, FR-024 y NFR-001.
- [X] T025 [US1] Implementar identidad sintética nueva/reuse tenant-local, sesión activa/cerrada, lock exclusivo, claim create-if-absent, digest, estados monotónicos, evidencia de reconciliación y escritura atómica en `apps/api/src/features/headless-chat/session-journal.ts` para FR-002, FR-009, FR-014, FR-018, FR-022, FR-024 y NFR-008.
- [X] T026 [US1] Implementar `start`, `turn`, `reconcile` y `close` delegando a los casos de uso comunes; `reconcile` aporta solo la observación y mapea la decisión autoritativa sin IA/replay ni lógica propia, preservando retries durables e `indeterminate`, en `apps/api/src/features/headless-chat/application.ts` para FR-002, FR-003, FR-009, FR-012, FR-013, FR-014 y FR-018.
- [X] T027 [P] [US1] Implementar orden y serialización de `SafeCapturedResponseProjection` con `redacted`/`redactionCodes`, sin copiar la respuesta completa al journal, en `apps/api/src/features/headless-chat/result.ts` para FR-006, FR-007, FR-008, FR-010 y FR-011.
- [X] T028 [US1] Integrar `HeadlessCapture` en toda emisión causada por inbound headless, persistiendo contenido completo en negocio y conectando al journal solo la proyección segura cuando exista turno CLI; conservar reactivación/reconciliación de dashboard libres de imports locales headless y persistir `captureContext=turn|manual_resume`, correlación opaca y cero Meta, en `apps/api/src/features/chat-routing/outbound/send.ts`, `apps/api/src/features/headless-chat/application.ts` y `apps/api/src/features/dashboard/routes/conversations.ts` para FR-004, FR-006, FR-007, FR-010 y FR-011.
- [X] T029 [US1] Crear la entrada de una línea stdin/stdout sin servidor HTTP en `apps/api/headless/cli.mjs` para FR-001, FR-002, FR-018, FR-019 y FR-021.
- [X] T030 [US1] Añadir el script `headless` con carga obligatoria de `apps/api/.env.headless.local`; crear la plantilla sin secretos; exponer `control`, `tenant_template` y tenants seed en `supabase/config.toml`; implementar `scripts/bash/sync-local-supabase-schemas.sh` idempotente que solo modifica config local y exige restart; documentar debug falso por defecto y excluir archivo real/journal en `apps/api/package.json` y `.gitignore` para FR-001, FR-021 y NFR-001.
- [X] T031 [US1] Ejecutar `apps/api/test/headless-chat-contract.test.mjs`, `apps/api/test/headless-chat-session.test.mjs`, `apps/api/test/headless-chat-no-meta.test.mjs` y `apps/api/test/headless-chat-deployment.test.mjs`, y registrar evidencia en `specs/001-headless-chat/implementation-evidence.md`.
- [ ] T032 [US1] Actualizar operación local y recorrido multiturno en `docs/runbooks/local-setup.md` y `specs/001-headless-chat/quickstart.md`, luego crear el commit enfocado `feat(api): add local headless chat sessions` con US1 verificada.

**Checkpoint**: US1 funciona de forma independiente; la CLI local/debug opera solo contra el Supabase local verificado, ya posee idempotencia fundacional, completa una conversación real y produce cero llamadas a Meta durante el turno.

---

## Fase 4: Historia de usuario 2 — Observar decisiones y transiciones de forma segura (P1)

**Objetivo**: devolver e inspeccionar resultados versionados que distingan routing, IA, transiciones y efectos sin exponer datos sensibles.

**Prueba independiente**: procesar una intención antes determinística mediante herramienta IA, una semántica, una aclaración y un handoff; validar el schema y demostrar que `inspect` no invoca IA ni modifica expiración/estado.

### Pruebas de US2

- [X] T033 [P] [US2] Validar envelopes exitosos, fallidos, `indeterminate` y `reconciled`, incluidas respuestas con `redacted` booleano y `redactionCodes` estables, contra `specs/001-headless-chat/contracts/headless-result.schema.json` en `apps/api/test/headless-chat-contract.test.mjs` para FR-009, FR-010, FR-011, NFR-005, NFR-006 y SC-006.
- [X] T034 [P] [US2] Añadir matriz que persista respuestas de negocio con dirección/billing y demuestre su redacción en stdout, stderr, journal, `inspect`, diffs y errores externos —sin alterar la fila tenant-local— en `apps/api/test/headless-chat-sanitization.test.mjs` para FR-007, FR-010, FR-011, NFR-004 y NFR-005.
- [X] T035 [P] [US2] Añadir inspección sin IA/mutación; proyecciones `manual_resume` ordenadas y correlacionadas; y reconciliación CLI/dashboard con manifiesto válido, ausente, corrupto, mismatch, todos, ninguno y efectos parciales sin replay en `apps/api/test/headless-chat-inspect.test.mjs` y `apps/api/test/conversation-reconciliation.test.mjs` para FR-007, FR-009, FR-010 y FR-017.

### Implementación de US2

- [X] T036 [P] [US2] Implementar el envelope v1, incluidos `indeterminate`, `reconciled`, `redacted`, `redactionCodes`, estados mutuamente excluyentes, códigos estables y allowlist de errores en `apps/api/src/features/headless-chat/result.ts` para FR-009, FR-010, FR-011, NFR-005, NFR-006 y SC-006.
- [X] T037 [P] [US2] Implementar snapshots seguros y consulta/proyección redactada de outbounds headless `manual_resume`, sin retornar su contenido tenant-local completo, en `apps/api/src/features/headless-chat/snapshot.ts` para FR-007, FR-010, FR-011 y FR-017.
- [X] T038 [US2] Incorporar `inspect`, snapshots before/after y correlación opaca sin efectos; mantener toda decisión de reconciliación en `reconcileNormalizedChatTurn` y usar en CLI solo el resultado seguro, en `apps/api/src/features/headless-chat/application.ts` para FR-009, FR-010 y FR-017.
- [X] T039 [US2] Redactar diagnósticos a stderr mediante eventos permitidos y evitar texto, prompt, raw, teléfono, dirección, billing y secretos en `apps/api/src/features/headless-chat/application.ts` y `apps/api/headless/cli.mjs` para FR-011, NFR-004 y NFR-005.
- [X] T040 [US2] Ejecutar `apps/api/test/headless-chat-contract.test.mjs`, `apps/api/test/headless-chat-sanitization.test.mjs` y `apps/api/test/headless-chat-inspect.test.mjs`, validando ambos schemas JSON y registrando evidencia en `specs/001-headless-chat/implementation-evidence.md`.
- [ ] T041 [US2] Documentar el contrato observable y ejemplos sanitizados en `docs/runbooks/smoke-tests.md`, luego crear el commit enfocado `feat(api): expose safe headless chat results` con US2 verificada.

**Checkpoint**: US2 permite explicar un turno desde un único resultado seguro e inspeccionar sin efectos.

---

## Fase 5: Historia de usuario 3 — Verificar paridad reproducible (P1)

**Objetivo**: comparar WhatsApp y headless sobre el mismo límite, estado y dependencias, permitiendo solo diferencias de transporte documentadas.

**Prueba independiente**: ejecutar los 15 escenarios de `contracts/parity-projection.md` con reloj, IDs y raw de IA controlados; exigir igualdad profunda de la captura interna canónica y validar por separado la proyección pública redactada.

### Pruebas de US3

- [X] T042 [P] [US3] Crear la matriz parametrizada de 15 escenarios, incluida pausa/reactivación y P-15 con dirección/billing: comparar respuesta interna completa entre `WhatsAppDelivery` fake y persistencia headless, y comprobar aparte la proyección pública redactada, en `apps/api/test/headless-chat-parity.test.mjs` y su integración Supabase `apps/api/test/headless-chat-parity-integration.test.mjs` para FR-003, FR-004, FR-005, FR-006, FR-007, FR-010, FR-011, FR-013, FR-020, NFR-007, SC-002, SC-005 y SC-010.
- [X] T043 [P] [US3] Añadir casos de IA real por defecto, test double explícito inline, salida desconocida/malformada y prohibición de fallback oculto en `apps/api/test/headless-chat-ai-mode.test.mjs` para FR-023 y EC-014.
- [X] T044 [P] [US3] Añadir guard estructural complementario que detecte router/caso de uso alterno en `apps/api/test/headless-chat-deployment.test.mjs` para FR-003, FR-020 y FR-021 sin usarlo como única evidencia.

### Implementación de US3

- [X] T045 [P] [US3] Mantener la inyección de respuestas crudas limitada a dobles inline dentro de tests; el runtime no contiene fixtures, catálogo de respuestas ni selector operativo, para FR-023.
- [X] T046 [P] [US3] Cubrir salida válida, inválida y baja confianza mediante dobles inline de test, sin JSON persistentes ni datos fijos de runtime, para FR-015, FR-020 y FR-023.
- [X] T047 [US3] Seleccionar IA real por defecto o test double explícito antes del mismo parser, sin modificar configuración tenant, en `apps/api/src/features/headless-chat/application.ts` y `apps/api/src/features/chat-routing/semantic/operation-plan.ts` para FR-004 y FR-023.
- [X] T048 [US3] Implementar canonicalización de IDs/tiempos y diferencias permitidas sobre capturas completas dentro de `apps/api/test/support/headless-chat-harness.mjs`; evitar imprimir contenido en diffs y validar por separado proyecciones redactadas según `contracts/parity-projection.md` para FR-007, FR-010, FR-011, FR-020 y NFR-007.
- [X] T049 [US3] Ejecutar `apps/api/test/headless-chat-parity.test.mjs`, `apps/api/test/headless-chat-ai-mode.test.mjs` y la regresión WhatsApp completa, registrando 15/15 escenarios o fallos reales en `specs/001-headless-chat/implementation-evidence.md`.
- [ ] T050 [US3] Actualizar la guía de paridad y dobles inline en `docs/runbooks/smoke-tests.md`, luego crear el commit enfocado `test(api): enforce headless whatsapp parity` con US3 verificada.

**Checkpoint**: US3 falla ante divergencia funcional y ante cualquier bypass textual que evite IA o cree una ruta alternativa.

---

## Fase 6: Historia de usuario 4 — Aislar sesiones, tenants y reintentos (P1)

**Objetivo**: impedir cruces tenant/identidad y garantizar turnos serializados e idempotentes bajo retry o concurrencia.

**Prueba independiente**: crear sesiones en dos tenants registrados de Supabase local, cruzar IDs, repetir el mismo turno concurrentemente y competir con turnos distintos sobre una sesión sin mutaciones parciales.

### Pruebas de US4

- [X] T051 [P] [US4] Añadir integración que rechace tenant omitido o inexistente, acepte un tenant inactivo cuando siga registrado y supere los demás gates locales, rechace identidad WhatsApp/no-headless y cubra cruces de identidad/sesión entre dos tenants en `apps/api/test/headless-chat-isolation.test.mjs` para FR-001, FR-022, FR-024, NFR-001, NFR-002 y SC-004.
- [X] T052 [P] [US4] Añadir retry secuencial/concurrente, digest conflictivo, confirmación única y respuesta durable repetida en `apps/api/test/headless-chat-idempotency.test.mjs` para FR-009, FR-014, NFR-008 y SC-003.
- [X] T053 [P] [US4] Añadir locks huérfanos, journal corrupto/versionado, cliente eliminado, sesión cerrada esperando lock y fault injection antes/después del checkpoint y después de cada frontera de efecto; probar locks en orden estable, conflicto concurrente y bloqueo hasta reconciliación todo/ninguno, manteniendo parciales `indeterminate`, en `apps/api/test/headless-chat-journal.test.mjs`, `apps/api/test/headless-chat-full-flow.test.mjs` y `apps/api/test/conversation-reconciliation.test.mjs` para FR-009, FR-016, FR-018 y NFR-008.

### Implementación de US4

- [X] T054 [US4] Completar recuperación de lock huérfano, rechazo de journal incompatible, revalidación después del lock y transición segura a `indeterminate`; el journal registra observación/decisión pero delega el cierre atómico al reconciliador backend y nunca infiere autoridad desde snapshots locales, en `apps/api/src/features/headless-chat/session-journal.ts` para FR-009, FR-014, FR-016 y NFR-008.
- [X] T055 [US4] Validar `identityId`/`sessionId` contra tenant ID y origen antes de consultas de negocio, normalizando mismatches a errores no enumerables en `apps/api/src/features/headless-chat/tenant.ts` para FR-022, FR-024, NFR-001 y NFR-002.
- [X] T056 [US4] Derivar el provider message ID inbound de sesión+turno y tratar la unicidad de mensajes como segunda defensa en `apps/api/src/features/headless-chat/application.ts` y `apps/api/src/modules/message-log/message-log.ts` para FR-009 y FR-014.
- [X] T057 [US4] Devolver resultados durables para retries, conflicto para digest diferente, `indeterminate` sin replay y `reconciled` solo desde la decisión autoritativa común; incluir metadatos de redacción sin filtrar manifiesto ni captura completa, en `apps/api/src/features/headless-chat/application.ts` y `apps/api/src/features/headless-chat/result.ts` para FR-009, FR-010, FR-011, FR-014 y NFR-008.
- [X] T058 [US4] Preparar/limpiar IDs sintéticos en dos tenants locales y permitir `supabase db reset` solo tras validar `project_id`/endpoints locales mediante `apps/api/test/support/headless-chat-harness.mjs` y `scripts/bash/reset-local-headless-chat.sh` para NFR-001 y NFR-002, sin tablas ni schemas headless.
- [X] T059 [US4] Ejecutar `apps/api/test/headless-chat-isolation.test.mjs`, `apps/api/test/headless-chat-idempotency.test.mjs` y `apps/api/test/headless-chat-journal.test.mjs` contra Supabase local, registrando `project_id`, tenants y resultado en `specs/001-headless-chat/implementation-evidence.md`.
- [ ] T060 [US4] Documentar concurrencia, uso seguro de `inspect`/`reconcile`, criterios para declarar efectos observados, retención y limpieza local segura en `docs/runbooks/local-setup.md`, luego crear el commit enfocado `feat(api): isolate headless sessions and retries` con US4 verificada.

**Checkpoint**: US4 rechaza el 100% de cruces y aplica cada turn ID como máximo una vez bajo concurrencia.

---

## Fase 7: Historia de usuario 5 — Manejar fallos sin corromper la conversación (P2)

**Objetivo**: inducir fallos de IA y dependencias conservando invariantes, fallbacks y clasificación segura.

**Prueba independiente**: ejecutar proveedor primario inválido con fallback válido, indisponibilidad total, tres aclaraciones, catálogo/snapshot inválido, geocodificación caída, persistencia caída y fallo de captura.

### Pruebas de US5

- [X] T061 [P] [US5] Añadir salida IA inválida/baja confianza, fallback, operación no permitida, ID inventado, tercer handoff y fallo al construir/persistir el manifiesto antes de efectos en `apps/api/test/headless-chat-failures.test.mjs` para FR-009, FR-015, FR-016, EC-008 y SC-007.
- [X] T062 [P] [US5] Añadir persistencia, catálogo, geocodificación y proveedores no disponibles, más caída tras cada efecto con reconciliación todo/ninguno/parcial sin nueva llamada externa, en `apps/api/test/headless-chat-dependencies.test.mjs`, `apps/api/test/headless-chat-failures.test.mjs`, `apps/api/test/headless-chat-full-flow.test.mjs` y `apps/api/test/conversation-reconciliation.test.mjs` para FR-009, FR-016, EC-011 y SC-007.
- [X] T063 [P] [US5] Añadir fallo al registrar outbound después de componer respuesta y violación por intento de Meta en `apps/api/test/headless-chat-no-meta.test.mjs` para FR-006, FR-007, FR-016, EC-009 y EC-010.

### Implementación de US5

- [X] T064 [P] [US5] Completar clasificación segura de fallos/retry y warnings de captura en `apps/api/src/features/headless-chat/result.ts` para FR-010, FR-016 y EC-009.
- [X] T065 [US5] Propagar fallos del pipeline común sin convertirlos en éxito y conservar fallback/aclaración/handoff existentes en `apps/api/src/features/chat-routing/semantic/operation-plan.ts` para FR-015, FR-016 y FR-023.
- [X] T066 [US5] Persistir `failed` solo cuando el manifiesto/estado prueba cero efectos, `applied` solo cuando prueba todos e `indeterminate` ante parciales o duda; no ejecutar reconciliación desde journal ni repetir dependencias, en `apps/api/src/features/chat-routing/reconcile-normalized-chat-turn.ts`, `apps/api/src/features/headless-chat/session-journal.ts` y `apps/api/src/features/headless-chat/application.ts` para FR-009, FR-014, FR-016 y NFR-008.
- [X] T067 [US5] Capturar errores de dependencias con códigos allowlisted y correlación opaca en `apps/api/src/features/headless-chat/application.ts` para FR-011, FR-016, NFR-004 y NFR-005.
- [X] T068 [US5] Ejecutar `apps/api/test/headless-chat-failures.test.mjs`, `apps/api/test/headless-chat-dependencies.test.mjs` y `apps/api/test/headless-chat-no-meta.test.mjs`, registrando invariantes before/after en `specs/001-headless-chat/implementation-evidence.md`.
- [ ] T069 [US5] Documentar manejo de fallos y decisión de retry/no-retry en `docs/runbooks/smoke-tests.md`, luego crear el commit enfocado `feat(api): contain headless chat failures` con US5 verificada.

**Checkpoint**: US5 distingue fallos, preserva estado sin acción válida y mantiene el comportamiento canónico de fallback/handoff.

---

## Fase 8: Verificación transversal y preparación para convergencia

- [X] T070 Crear el verificador dry-run que usa `apps/api/node_modules/.bin/wrangler` y un temporal seguro en `scripts/bash/verify-no-headless-deploy.sh` para FR-021 y SC-009; debe rechazar superficie headless y permitir únicamente captura/reconciliación backend compartidas, sin publicar ni borrar rutas amplias.
- [X] T071 Extender `apps/api/test/headless-chat-deployment.test.mjs` para inspeccionar JS, sourcemap, metadata y rutas del bundle dry-run y rechazar CLI, journal, fixtures, ambiente o flag headless; permitir captura compartida y la operación dashboard autenticada que delega a `reconcileNormalizedChatTurn`, sin una ruta debug/headless, para FR-009 y FR-021.
- [X] T072 Añadir scripts focalizados `test:headless` y `test:headless:integration` en `apps/api/package.json`, manteniendo `test` como suite total para NFR-007 y NFR-008.
- [X] T073 Auditar FR-001–FR-024 y NFR-001–NFR-009 contra archivos de prueba y resultados, incluidos manifiesto durable, reconciliación compartida y separación captura completa/proyección segura, registrando evidencia y bloqueos externos en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T074 Ejecutar `pnpm --filter @42day/api test`, `pnpm --filter @42day/api typecheck`, `pnpm --filter @42day/api build` y `scripts/bash/verify-no-headless-deploy.sh`, registrando resultados no truncados en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T075 Ejecutar `pnpm --filter @42day/api test:headless:integration` contra el Supabase local verificado con dos tenants registrados, sin imprimir credenciales, y registrar cualquier prerrequisito bloqueado como no aprobado en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T076 Ejecutar `pnpm test` desde la raíz y registrar el resultado completo en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T077 Ejecutar `pnpm typecheck` y `pnpm lint` desde la raíz y registrar ambos resultados en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T078 Ejecutar `pnpm build` desde la raíz y registrar el resultado en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T079 Recorrer `specs/001-headless-chat/quickstart.md` desde una CLI limpia contra Supabase local, medir el objetivo de menos de diez minutos y registrar fecha/resultado en `specs/001-headless-chat/implementation-evidence.md` para NFR-009 y SC-008.
- [X] T080 Actualizar comportamiento realmente entregado y comandos verificados en `docs/current-status.md`, `docs/architecture/backend.md`, `docs/flows/conversation-flow.md`, `docs/runbooks/local-setup.md` y `docs/runbooks/smoke-tests.md` sin presentar checks bloqueados como exitosos.
- [X] T081 Revisar todos los cambios del feature contra `CODESTYLE.md`, `TESTING.md`, `.specify/memory/constitution.md` y `specs/001-headless-chat/checklists/readiness.md`, documentando excepciones aprobadas en `specs/001-headless-chat/implementation-evidence.md`.
- [X] T082 Revisar el diff completo por secretos/PII, cruce tenant, endpoint remoto, imports CLI/journal/debug desde Worker, manifiestos con texto libre, proyecciones que filtren respuesta completa, RPC sin grants explícitos/relaciones calificadas/locks estables, dependencias nuevas, cambios no relacionados y migraciones fuera del alcance aprobado en `apps/api/`, `supabase/migrations/`, `scripts/bash/`, `docs/` y `specs/001-headless-chat/`.
- [ ] T083 Crear el commit final enfocado `chore(api): verify local headless chat` para documentación/evidencia transversal, ejecutar `$speckit-converge` y no declarar completado hasta resolver las tareas que agregue en `specs/001-headless-chat/tasks.md`.

## Fase 9: Convergencia

- [X] T084 [P] Añadir una prueba de integración que aplique la migración forward `20260813100000_fix_normalized_inbound_manifest_json.sql` sobre Supabase local y compruebe que `payload.internal.execution_manifest` y `payload.internal.postconditions` sobreviven al ciclo claim/finalize, evitando regresar al bug de `jsonb_set` anidado para FR-009, SC-007 y NFR-008.
- [X] T085 [P] Convertir el recorrido real sin fixture de Gemini en una prueba E2E reproducible y sanitizada que verifique proveedor/modelo, cinco planes JSON, pedido confirmado, cero Meta, retry sin nueva llamada, conflicto, `inspect` y `close` para FR-023, SC-001, SC-003 y SC-005.
- [X] T086 Generar el `ValidatedExecutionManifest` después de la validación de negocio del plan y antes de la primera mutación, incluyendo huellas verificables de los efectos esperados y no solo nombres de recursos, alineado con FR-009, el plan de reconciliación y NFR-008. Las huellas ahora incorporan estado esperado, resumen agregado del draft, entrega/pago, expectativa de pedido y respuesta, sin PII.
- [X] T087 Añadir integración contra Supabase que fuerce fallos antes/después del checkpoint y después de cada frontera de efecto, y pruebe que CLI y dashboard consultan la misma evidencia autoritativa para resolver todo/ninguno/parcial sin replay, alineado con FR-009, SC-007 y SC-010. La cobertura verifica none/partial/all mediante RPC, valida múltiples IDs de efecto, cubre la ruta HTTP de reconciliación del dashboard con respuesta autoritativa y evita replay; además inyecta fallos antes del checkpoint, después del checkpoint durable y después de outbound, draft, conversación y creación de orden, con retry bloqueado.

**Checkpoint**: todas las pruebas y gates aplicables están verdes con evidencia fechada; bloqueos están declarados; el siguiente estado válido es convergencia.

## Dependencias y orden de ejecución

### Grafo de historias

```text
Fase 1 Setup
   ↓
Fase 2 Cimientos compartidos
   ↓
US1 Multiturno real
   ├──────────────→ US2 Observabilidad segura ──→ US3 Paridad reproducible
   └──────────────→ US4 Aislamiento/reintentos ─┐
                                                  ├─→ US5 Fallos seguros
US2 Observabilidad segura ────────────────────────┘
   US3 + US4 + US5 ──────────────────────────────→ Verificación transversal
```

- Fase 1 precede cualquier modificación funcional.
- Fase 2 bloquea todas las historias porque establece el único caso de uso y puertos.
- US1 entrega el MVP con idempotencia fundacional y bloquea US2, US3 y US4.
- US2 y US4 pueden diseñarse en paralelo tras US1, pero sus tareas que editan `application.ts`/`result.ts` deben serializarse.
- US3 depende de US1 y US2 para comparar la proyección segura.
- US5 depende de US1, US2 y US4 para clasificar fallos, retries e indeterminación.
- La Fase 8 depende de todas las historias y termina antes de `$speckit-converge`.

## Oportunidades de paralelización

### Setup

- T003, T004, T005 y T006 pueden desarrollarse en paralelo después de T002 porque editan pruebas/dobles inline distintos.

### US1

- T019–T022 pueden escribirse en paralelo antes de implementación.
- T023 y T024 pueden implementarse en paralelo; T025/T026 dependen de ambos.
- T027 puede avanzar en paralelo con T025; T028 depende del puerto de salida de Fase 2 y de T026.

### US2

- T033–T035 pueden escribirse en paralelo.
- T036 y T037 pueden implementarse en paralelo; T038 integra ambos y T039 cierra serialización/logging.

### US3

- T042–T044 pueden escribirse en paralelo.
- T045 y T046 pueden avanzar en paralelo; T047 depende de T045 y T048 depende de T042/T046.

### US4

- T051–T053 pueden escribirse en paralelo.
- T055 y T058 pueden avanzar en paralelo; T054 extiende la base de T025 y precede los casos avanzados de T057.

### US5

- T061–T063 pueden escribirse en paralelo.
- T064 puede avanzar en paralelo con T065; T066/T067 integran la clasificación final.

## Estrategia de implementación incremental

### MVP primero

1. Completar Fases 1 y 2.
2. Completar US1 y demostrar una conversación real de ocho turnos sin Meta.
3. Detenerse para revisar el contrato y el límite compartido antes de ampliar observabilidad/paridad.

### Entrega incremental

1. **US1**: runner local usable, sesión real, identidad segura y captura básica.
2. **US2**: resultados/snapshots seguros e inspección.
3. **US3**: enforcement reproducible de paridad e IA real/dobles inline.
4. **US4**: aislamiento y garantías fuertes de concurrencia/idempotencia.
5. **US5**: matriz completa de fallos y recuperación.
6. **Fase 8**: gates globales, dry-run, documentación y convergencia.

## Reglas de finalización

- No marcar una tarea completa sin su cambio o evidencia exigida.
- No presentar como verde una integración Supabase, smoke real o comando bloqueado.
- Las pruebas de source/bundle complementan, pero no reemplazan evidencia conductual.
- Si implementación descubre un cambio de producto o arquitectura, detenerse y actualizar SPEC/plan/tareas antes de continuar.
- Cada checkpoint significativo termina en un Conventional Commit enfocado solo con verificaciones verdes.
- No hay tablas/schemas headless ni dependencias nuevas de producción; solo se admite la migración compartida de claim manual aprobada.
- La implementación no está completa hasta que `$speckit-converge` no encuentre trabajo restante.

## Fase 10: Convergencia

- [X] T088 [P] Completar la matriz de los 15 escenarios de paridad de `apps/api/test/headless-chat-parity.test.mjs` atravesando el router, los efectos y la persistencia real para WhatsApp fake y headless, incluyendo pausa/reactivación y dirección/facturación, alineado con SC-002 y NFR-007. La ejecución real queda en `apps/api/test/headless-chat-parity-integration.test.mjs` y complementa la matriz contractual.
- [X] T089 [P] Completar la matriz de fault injection de `apps/api/test/headless-chat-fault-injection.test.mjs`, `apps/api/test/headless-chat-dependencies.test.mjs` y reconciliación contra Supabase para cada frontera del manifiesto y para catálogo, persistencia, geocodificación y proveedores no disponibles, verificando todo/ninguno/parcial sin replay conforme a FR-016, SC-007 y T087. La matriz vigente cubre checkpoint, outbound, draft, conversación, orden y las dependencias locales no disponibles.
- [X] T090 Preparar una rutina reusable y segura de preparación/limpieza de los dos tenants sintéticos del harness, validar `project_id` y endpoints loopback antes de cualquier reset, y registrar advisors soportados por la versión local de Supabase conforme a NFR-001, NFR-002 y T058. `scripts/bash/reset-local-headless-chat.sh` permanece en dry-run por defecto, exige confirmación explícita para reset local, archiva el journal exacto y los advisors solo reportan un warning preexistente fuera del alcance headless.
- [X] T091 Ejecutar y documentar la auditoría final contra CODESTYLE, TESTING, constitución, readiness y diff completo —secretos/PII, tenant, endpoints remotos, superficie Worker, grants/RPC, migraciones, dependencias y cambios fuera de alcance— conforme a Constitution y T081-T082. La evidencia registra el resultado y mantiene fuera de alcance el cambio ajeno `instagram-1080x1350.png`.
