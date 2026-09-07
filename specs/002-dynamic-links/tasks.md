# Tareas: Enlaces dinámicos QR y NFC

## Dependencias

`Fundación` → `US1 redirección` → `US2 administración` → `US3 QR/NFC` → `operación y convergencia`.

## Phase 1: Setup

- [x] T001 Crear los artefactos de diseño en `specs/002-dynamic-links/`.
- [x] T002 Crear la migración canónica en `supabase/migrations/20260907143102_dynamic_links.sql`.

## Phase 2: Foundational

- [x] T003 Implementar tipos compartidos en `packages/types/src/dynamic-links.ts` y exportarlos desde `packages/types/src/index.ts`.
- [x] T004 Implementar códigos, URL canónica y validación de destino en `packages/core/src/dynamic-links.ts` y `packages/core/src/index.ts`.
- [x] T005 Implementar tablas, índices, RLS, RPC y trigger de suspensión en `supabase/migrations/20260907143102_dynamic_links.sql`.
- [x] T006 Añadir `DYNAMIC_LINK_BASE_URL` y contratos de API en `apps/api/src/lib/bindings.ts` y `specs/002-dynamic-links/contracts/dynamic-links-api.md`.

## Phase 3: User Story 1 — redirección pública

**Goal:** una URL física permanente redirige de forma segura al destino vigente.

- [x] T007 [US1] Escribir pruebas de código, destino, estado y cabeceras en `apps/api/test/dynamic-links.test.mjs`.
- [x] T008 [US1] Implementar repositorio y servicio de resolución en `apps/api/src/features/dynamic-links/repository.ts` y `service.ts`.
- [x] T009 [US1] Implementar GET/HEAD y fallbacks en `apps/api/src/features/dynamic-links/public-routes.ts` y montarlo en `apps/api/src/index.ts`.

## Phase 4: User Story 2 — administración

**Goal:** un administrador opera unidades/lotes con auditoría e idempotencia.

- [x] T010 [US2] Exportar autorización de administrador desde `apps/api/src/features/dashboard/auth.ts`.
- [x] T011 [US2] Implementar las rutas administrativas en `apps/api/src/features/dynamic-links/admin-routes.ts` y montarlas en `apps/api/src/features/dashboard/router.ts`.
- [x] T012 [US2] Añadir cliente, interfaz y edición de inventario en `apps/dashboard/src/features/admin/DynamicLinksSection.tsx`, `apps/dashboard/src/api.ts` y `apps/dashboard/src/App.tsx`.
- [ ] T013 [US2] Añadir pruebas de autorización, idempotencia, auditoría y concurrencia en `apps/api/test/dynamic-links.test.mjs`.

## Phase 5: User Story 3 — QR y NFC

**Goal:** se exportan QR exactos y se controlan hitos de fabricación NFC.

- [x] T014 [US3] Añadir generación SVG/PNG, CSV y descarga por lote en `apps/dashboard/src/features/admin/DynamicLinksSection.tsx`.
- [x] T015 [US3] Documentar flujo NFC y prueba física en `specs/002-dynamic-links/quickstart.md` y `docs/current-status.md`.

## Phase 6: Polish & cross-cutting

- [x] T016 Ejecutar los comandos de `TESTING.md`, corregir fallos y documentar evidencia en `docs/current-status.md`.
- [ ] T017 Validar configuración Worker/DNS y rollback en `apps/api/wrangler.toml` y `specs/002-dynamic-links/plan.md`.
- [ ] T018 Ejecutar convergencia contra `specs/002-dynamic-links/{spec,plan,tasks}.md` y completar cualquier tarea anexada.
