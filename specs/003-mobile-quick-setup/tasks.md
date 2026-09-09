# Tasks: Configuración rápida móvil de QR

**Input**: Artefactos aprobados de `/specs/003-mobile-quick-setup/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/quick-setup-api.md` y checklist revisado

**Tests**: Cada requisito funcional incluye prueba automatizada o evidencia manual conforme a `TESTING.md`.

## Phase 1: Setup and Characterization

**Purpose**: Proteger el CRUD actual y preparar contratos/dependencia sin exponer el flujo nuevo.

- [X] T001 Ejecutar y registrar el baseline de enlaces dinámicos con `apps/api/test/dynamic-links.test.mjs` y `apps/dashboard/src/features/admin/DynamicLinksSection.tsx` para FR-001, FR-016 y FR-019
- [X] T002 Verificar la versión vigente, añadir `@zxing/browser` fijado a `apps/dashboard/package.json` y actualizar `pnpm-lock.yaml` para FR-002, FR-017 y NFR-005
- [X] T003 [P] Añadir contratos de request/result y semántica de asociación opcional a `packages/types/src/dynamic-links.ts` y `packages/types/src/index.ts` para FR-005, FR-006, FR-009 y FR-010
- [ ] T004 Crear un Conventional Commit de setup que incluya únicamente `apps/dashboard/package.json`, `pnpm-lock.yaml` y `packages/types/` después del baseline exitoso

**Checkpoint**: Dependencia reproducible, contratos revisables y comportamiento actual protegido.

---

## Phase 2: Foundational Changes

**Purpose**: Implementar parsing e inferencia autoritativos antes de cámara o rutas.

- [X] T005 [P] Escribir pruebas fallidas de referencia canónica, hosts externos e inferencia en `packages/core/test/dynamic-links.test.mjs` para FR-003, FR-004, FR-008, FR-013 y EC-007
- [X] T006 Implementar `parseDynamicLinkReference` e `inferDynamicLinkDestinationType` en `packages/core/src/dynamic-links.ts` para FR-003, FR-008 y FR-013
- [X] T007 Ejecutar tests/typecheck focalizados de `@42day/core` y registrar resultado en `specs/003-mobile-quick-setup/quickstart.md` para SC-002
- [ ] T008 Crear un Conventional Commit de fundamento que incluya `packages/core/` y la evidencia de `specs/003-mobile-quick-setup/quickstart.md`

**Checkpoint**: Entradas escaneadas o pegadas producen un código y tipo estables.

---

## Phase 3: User Story 1 - Escanear, configurar y activar (Priority: P1) 🎯 MVP

**Goal**: Resolver una unidad física y actualizarla/activarla atómicamente desde móvil.

**Independent Test**: Escanear una unidad disponible, escribir etiqueta/destino y comprobar unidad activa, redirect y auditoría en una operación.

### Tests for User Story 1

- [X] T009 [P] [US1] Escribir pruebas API fallidas de lookup, autorización, mutación única, asociación opcional, estados y revisión obsoleta en `apps/api/test/dynamic-links.test.mjs` para FR-005, FR-007, FR-009-FR-013, FR-016, FR-018, NFR-004, SC-004 y SC-006
- [X] T010 [P] [US1] Escribir pruebas UI fallidas de scan→resolve→edit→submit→success y layout móvil en `apps/dashboard/test/dynamic-link-quick-setup.test.mjs` para FR-001, FR-002, FR-006, FR-007, FR-010, FR-012, FR-017, FR-018, NFR-001 y NFR-003

### Implementation for User Story 1

- [X] T011 [US1] Añadir `GET /by-code/:code` y `PATCH /:id/quick-configuration` antes de rutas genéricas en `apps/api/src/features/dynamic-links/admin-routes.ts` para FR-005, FR-007, FR-010-FR-013, FR-016 y FR-018
- [X] T012 [US1] Orquestar inferencia y una llamada a `updateDynamicLinkUnit` en `apps/api/src/features/dynamic-links/service.ts`, reutilizando `apps/api/src/features/dynamic-links/repository.ts`, para FR-009-FR-011 y NFR-004
- [X] T013 [P] [US1] Añadir `getDynamicLinkByCode` y `quickConfigureDynamicLink` en `apps/dashboard/src/api.ts` para FR-005, FR-006 y FR-010
- [X] T014 [US1] Implementar diálogo, unión discriminada y formulario táctil en `apps/dashboard/src/features/admin/QuickDynamicLinkSetup.tsx` para FR-006, FR-007, FR-009, FR-010, FR-012, FR-018, NFR-001 y NFR-003
- [X] T015 [US1] Implementar cámara trasera, primera lectura y cleanup con adapter inyectable en `apps/dashboard/src/features/admin/DynamicLinkQrScanner.tsx` para FR-002, FR-003, FR-017, NFR-002 y NFR-005
- [X] T016 [US1] Integrar botón superior y acción sticky móvil en `apps/dashboard/src/features/admin/DynamicLinksSection.tsx` para FR-001 y reconciliar la unidad retornada para FR-010
- [X] T017 [US1] Ejecutar tests/typecheck/build focalizados de `@42day/core`, `@42day/api` y `@42day/dashboard`, registrando resultados en `specs/003-mobile-quick-setup/quickstart.md`
- [ ] T018 [US1] Crear un Conventional Commit del MVP con los archivos de core, API, dashboard y tests de Phase 3

**Checkpoint**: US1 completa; el CRUD detallado continúa operativo y no hay migraciones.

---

## Phase 4: User Story 2 - Recuperarse sin cámara (Priority: P1)

**Goal**: Completar la operación por URL/código y recuperarse de fallos comunes.

**Independent Test**: Denegar cámara, pegar URL canónica y activar; repetir con QR externo, red fallida y conflicto.

### Tests for User Story 2

- [X] T019 [P] [US2] Ampliar pruebas UI para permiso, incompatibilidad, entrada manual, QR externo, red y borrador en `apps/dashboard/test/dynamic-link-quick-setup.test.mjs` para FR-003, FR-004, FR-018, EC-003-EC-006 y NFR-005

### Implementation for User Story 2

- [X] T020 [US2] Añadir entrada manual equivalente, errores diferenciados, reintento y recarga por conflicto en `apps/dashboard/src/features/admin/QuickDynamicLinkSetup.tsx` para FR-004, FR-018 y SC-004
- [X] T021 [US2] Añadir mapeo estable de errores en `apps/dashboard/src/api.ts` y `apps/api/src/features/dynamic-links/admin-routes.ts` para FR-018 sin filtrar detalles
- [X] T022 [US2] Ejecutar tests/typecheck/build focalizados de API/dashboard y registrar cámara denegada en `specs/003-mobile-quick-setup/quickstart.md`
- [ ] T023 [US2] Crear un Conventional Commit de recuperación que incluya solo archivos y pruebas de Phase 4

**Checkpoint**: La cámara no es un punto único de fallo.

---

## Phase 5: User Story 3 - Copiar para NFC y continuar (Priority: P2)

**Goal**: Copiar la URL correcta y encadenar unidades sin volver al listado.

**Independent Test**: Completar una unidad, copiar, comparar URL, simular clipboard denegado y escanear otra.

### Tests for User Story 3

- [X] T024 [P] [US3] Añadir pruebas UI de copia exitosa/fallida, URL seleccionable y reinicio en `apps/dashboard/test/dynamic-link-quick-setup.test.mjs` para FR-014, FR-015, FR-019 y SC-005

### Implementation for User Story 3

- [X] T025 [US3] Implementar “Copiar enlace para NFC”, fallback readonly y “Escanear otro” en `apps/dashboard/src/features/admin/QuickDynamicLinkSetup.tsx` para FR-014, FR-015 y FR-019
- [X] T026 [US3] Ejecutar test/typecheck/build focalizados de dashboard y registrar clipboard permitido/denegado en `specs/003-mobile-quick-setup/quickstart.md`
- [ ] T027 [US3] Crear un Conventional Commit del flujo NFC que incluya solo archivos y pruebas de Phase 5

**Checkpoint**: El operador puede encadenar QR→configuración→copia NFC.

---

## Final Phase: Cross-Cutting Verification and Convergence Readiness

- [X] T028 [P] Actualizar capacidad y brechas en `docs/current-status.md` para FR-001-FR-019
- [X] T029 [P] Añadir smoke móvil, privacidad de cámara y comparación NFC a `docs/runbooks/smoke-tests.md` para FR-014, FR-017, NFR-002 y NFR-005
- [ ] T030 Ejecutar DB real para atomicidad, auditoría, RLS/grants y revisión obsoleta según `specs/003-mobile-quick-setup/quickstart.md` para FR-010, FR-011, FR-016, NFR-004 y SC-004
- [ ] T031 Ejecutar matriz manual iOS/Android, 320 px, permisos/clipboard y 20 lecturas, anexando evidencia en `specs/003-mobile-quick-setup/quickstart.md` para NFR-001-NFR-003, NFR-005 y SC-001-SC-003
- [ ] T032 Validar trazabilidad FR/NFR/SC contra pruebas y evidencia en `specs/003-mobile-quick-setup/spec.md` y `specs/003-mobile-quick-setup/plan.md`
- [ ] T033 Ejecutar `pnpm test`, `pnpm typecheck` y `pnpm build` desde raíz y registrar resultados en `specs/003-mobile-quick-setup/quickstart.md`
- [X] T034 Revisar el diff contra `CODESTYLE.md`, secretos, auth, cámara, compatibilidad y cambios ajenos, documentando excepciones en `specs/003-mobile-quick-setup/plan.md`
- [ ] T035 Crear el Conventional Commit final con `docs/current-status.md`, `docs/runbooks/smoke-tests.md` y evidencia verificada
- [ ] T036 Ejecutar `$speckit-converge`, incorporar tareas faltantes a `specs/003-mobile-quick-setup/tasks.md` y repetir hasta converger

## Dependencies and Execution Order

- Setup/characterization precede cambios de comportamiento.
- Phase 2 bloquea todas las historias.
- US1 entrega el MVP; US2 y US3 dependen de su componente compartido.
- Las pruebas de US2 y US3 pueden prepararse en paralelo después de T014.
- La fase final exige todas las historias incluidas en el release.

## Parallel Opportunities

- T003 y T005 pueden prepararse en paralelo cuando los contratos estén acordados.
- T009 y T010 se escriben en paralelo después de Phase 2.
- T013 puede avanzar en paralelo con T011 cuando el contrato esté aprobado.
- T028 y T029 pueden avanzar en paralelo tras estabilizar el comportamiento.

## Suggested MVP

Phases 1–3 entregan el valor principal: escaneo y configuración atómica. Sin embargo, US2 es requisito de salida para campo porque permisos/cámara pueden fallar; no se recomienda piloto físico sin Phase 4.

## Format Validation

Las 36 tareas usan checkbox, ID secuencial, etiqueta de historia donde corresponde, requisitos trazables y rutas concretas.
