# Implementation Plan: Enlaces dinámicos QR y NFC

**Branch**: `codex/dynamic-links` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

## Resumen técnico

Se añadirá un inventario global en el esquema `control`, protegido con RLS y accesible exclusivamente desde el Worker mediante la service role. El Worker servirá `GET` y `HEAD /r/:code` en el host `go.thaledon.com`; el dashboard continuará usando `parahoy.thaledon.com/r/:tenantSlug` sin cambios. La redirección consulta el estado y el destino vigente en cada petición, aplica `302` y cabeceras `no-store`.

El dashboard administrará el inventario a través de rutas `/dashboard/admin/dynamic-links/*`, siempre autenticadas como `system_admin`. El QR se genera en el navegador a partir de la URL permanente y nunca desde el destino.

## Contexto actual y reutilización

- API: Cloudflare Worker con Hono, `apps/api/src/index.ts`; acceso a PostgREST centralizado en `lib/supabase-rest.ts`.
- UI: React/Vite; administración global ya presente en `apps/dashboard/src/App.tsx` y `features/admin`.
- Auth: Supabase Auth y `app_metadata.system_admin`, reutilizando `requireAuthUser` / `isSystemAdmin`.
- Datos globales: esquema `control`, donde ya viven `tenants` y `tenant_users`.
- QR: `qrcode@1.5.4` ya está disponible en el dashboard.

## Decisiones de arquitectura

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Host público | `https://go.thaledon.com/r/:code` directo al Worker | Separa por completo perfiles públicos existentes y enlaces físicos. |
| Código | 12 caracteres Crockford Base32 | 60 bits de entropía, corto e inmutable; se excluyen I/L/O/U. |
| Estados | `available`, `active`, `suspended`, `archived` | `archived` es terminal; no hay borrado/reutilización. |
| Redirect | 302 + `Cache-Control: no-store` | El destino puede cambiar sin espera de caché. |
| Datos | `control.dynamic_link_*` | Inventario no pertenece a un esquema tenant. |
| Escrituras | RPC transaccionales, revisión optimista e idempotency key | Garantiza auditoría y evita duplicados/sobrescrituras silenciosas. |
| Destinos | Validación híbrida | HTTPS general para web/carta, allowlists para Google/WhatsApp/Instagram. |
| QR | SVG/PNG, EC M, quiet zone 4, negro/blanco | Apto para sticker 25×25 mm y sin reducir lecturabilidad con logos. |
| NFC | NDEF URI idéntica, registro manual de hitos | El navegador no programa tags; la operación usa el URL canónico. |

## Estructura prevista

```text
apps/api/src/features/dynamic-links/
  service.ts                 # reglas públicas y administrativas
  repository.ts              # consultas control y RPC
  public-routes.ts           # GET/HEAD /r/:code y fallbacks
  admin-routes.ts            # CRUD protegido para dashboard
apps/dashboard/src/features/admin/
  DynamicLinksSection.tsx    # inventario, edición y exportación
  dynamic-links.ts           # cliente HTTP y helpers QR/CSV
packages/core/src/dynamic-links.ts
packages/types/src/dynamic-links.ts
supabase/migrations/*_dynamic_links.sql
```

## Fases

1. **Fundación y contrato.** Migración, modelos puros, validación, contrato de rutas y pruebas de seguridad.
2. **Redirección pública.** Resolver estado/destino, páginas de respaldo, cabeceras, tests HTTP.
3. **Administración.** Endpoints de lotes/unidades/auditoría y pantalla de administración con QR/CSV.
4. **Operación y entrega.** Documentación NFC, variables, despliegue Canary, pruebas impresas y rollback.

## Despliegue y reversión

1. Aplicar migración en staging y verificar RLS/grants/RPC con service role.
2. Configurar `DYNAMIC_LINK_BASE_URL=https://go.thaledon.com` en Worker.
3. Migrar zona DNS a Cloudflare, añadir Custom Domain del Worker, validar TLS y canario antes de imprimir.
4. Desplegar Worker y dashboard; mantener `parahoy` sin rutas nuevas de redirect.
5. Reversión: retirar el tráfico del Custom Domain o regresar el Worker anterior; no revertir la migración ni borrar códigos ya emitidos.

## Gate de calidad

- Pruebas de core/API y typecheck/lint exigidos por `TESTING.md`.
- Prueba manual: QR SVG impreso 25 mm, 30 lecturas correctas en tres dispositivos; NFC NTAG215 NDEF URI, UID anotado, lectura verificada y bloqueo final.
- Canary de 48 h con status/headers/redirect esperados antes de una impresión definitiva.

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command.

## Summary

[Primary requirement and the simplest safe technical approach]

## Current-State Evidence

<!-- Cite the files, symbols, tests, migrations, and dated external checks inspected. Explain the
current control/data flow and distinguish evidence from inference. -->

| Evidence | Current responsibility or behavior | Relevance |
| --- | --- | --- |
| `[real/path:line or symbol]` | [Verified behavior] | [Why it must change or remain] |

## Technical Context

**Language/Version**: [TypeScript/Node/Worker versions or NEEDS CLARIFICATION]

**Primary Dependencies**: [Existing dependencies; justify any addition]

**Storage**: [Supabase/Postgres/Storage or N/A]

**Testing**: [Existing runner, affected suites, and required new evidence]

**Target Platform**: [Cloudflare Workers/browser or N/A]

**Project Type**: [ParaHoy pnpm/Turborepo web application]

**Performance Goals**: [Measurable goal or N/A with reason]

**Constraints**: [Tenant, security, idempotency, AI, compatibility, and operational constraints]

**Scale/Scope**: [Affected modules, tenants, routes, and user journeys]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Evaluate every applicable constitutional principle plus `AGENTS.md`, `ARCHITECTURE.md`,
`CODESTYLE.md`, and `TESTING.md`. Any exception requires owner, reason, and removal condition in
Complexity Tracking.]

## Target Architecture and Responsibilities *(mandatory)*

### Resulting Flow

```text
[Concrete future control/data flow after implementation]
```

### Responsibility Changes

| Boundary or component | Current owner | Resulting owner | Reason |
| --- | --- | --- | --- |
| [Responsibility] | [Current location] | [Target location] | [Why] |

### Contracts and Data

- **Contracts/APIs/events**: [Added, changed, preserved, or N/A]
- **Prompts/controlled actions**: [Added, changed, preserved, or N/A]
- **Data/migrations**: [Schema, RLS, grants, tenant rollout, rollback, or N/A]
- **Compatibility**: [Backward compatibility and transition strategy]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── spec.md
├── plan.md
├── research.md          # when technical uncertainty requires it
├── data-model.md        # when data changes
├── quickstart.md        # verification and review path
├── contracts/           # when interfaces change
└── tasks.md             # created by $speckit-tasks
```

### Target Source Tree *(mandatory)*

<!-- Show only concrete repository paths. Mark each path as ADD, MODIFY, MOVE, or REMOVE and include
tests beside the behavior they verify. This is the expected repository shape after implementation. -->

```text
[MODIFY] apps/api/src/features/example/example.ts
[ADD]    apps/api/test/example-behavior.test.mjs
[REMOVE] apps/api/src/legacy/example.ts
```

| Path | Change | Resulting responsibility |
| --- | --- | --- |
| `[real/path]` | ADD/MODIFY/MOVE/REMOVE | [Single clear owner] |

## Test Strategy and Traceability *(mandatory)*

| Requirement | Scenario or risk | Test level | Target file/evidence | Expected assertion |
| --- | --- | --- | --- | --- |
| FR-001 | US1.1 | Unit/Integration/UI/E2E | `[real/path]` | [Observable result] |

Describe required fakes, fixtures, regression-first sequence, focused commands, full verification, and
any manual/external checks with owner and environment. Source-inspection tests cannot be the sole
evidence for behavioral requirements.

## Delivery, Observability, and Recovery

- **Rollout**: [Order, tenant exposure, feature flag, or immediate release]
- **Observability**: [Logs, traces, metrics, alerts, and safe diagnostic context]
- **Failure containment**: [How partial mutation or unsafe state is prevented]
- **Rollback**: [Code/data/config rollback and compatibility limits]

## Complexity Tracking

> Fill only when the Constitution Check has a justified violation or the design adds material
> complexity.

| Violation or complexity | Why needed | Simpler alternative rejected because | Owner/removal condition |
| --- | --- | --- | --- |
| [Item] | [Current need] | [Evidence] | [Owner and condition] |
