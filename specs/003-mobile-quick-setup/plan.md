# Implementation Plan: Configuración rápida móvil de QR

**Branch**: `master` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-mobile-quick-setup/spec.md`

## Summary

Se añadirá una entrada prominente “Configuración rápida” al inventario QR/NFC. En móvil abrirá un diálogo de pantalla completa que escanea el QR con la cámara trasera, resuelve la unidad por su código exacto y permite escribir etiqueta, destino y una asociación opcional. Una sola mutación autenticada reutilizará la función transaccional existente para actualizar y activar la unidad. El resultado mostrará una acción principal para copiar la URL permanente al programador NFC y otra para escanear la siguiente unidad.

La cámara se encapsulará en un componente cargado bajo demanda con `@zxing/browser`, porque la API nativa `BarcodeDetector` no ofrece una base compatible suficiente. Cuando cámara, permiso o lectura fallen, el mismo flujo acepta pegar la URL o código. No se crearán tablas ni se requiere una migración: el índice único de `public_code`, el control de revisión, la auditoría y la RPC `control.update_dynamic_link_unit` ya cubren la operación atómica.

## Technical Context

**Language/Version**: TypeScript estricto en el monorepo vigente

**Primary Dependencies**: React, Vite, Hono, Supabase/PostgREST, `@42day/core`, `@42day/types`, nueva dependencia runtime `@zxing/browser` fijada en `apps/dashboard`

**Storage**: PostgreSQL/Supabase existente en `control.dynamic_link_units` y `control.dynamic_link_audit_events`; sin tablas nuevas

**Testing**: Node test runner `*.test.mjs`, pruebas UI de comportamiento, integración API con fakes de PostgREST y validación manual móvil

**Target Platform**: Dashboard web responsive bajo HTTPS; Safari iOS y Chrome Android de los dispositivos piloto

**Project Type**: Aplicación web monorepo con dashboard y Worker API

**Performance Goals**: Resolver una unidad exacta en una consulta indexada; lectura enfocada menor a 3 s; operación completa menor a 60 s en piloto

**Constraints**: Solo `system_admin`; sin captura persistida; controles táctiles de 44 px; ancho mínimo 320 px; cámara únicamente en contexto seguro; sin programación Web NFC

**Scale/Scope**: Operación interna, una unidad por sesión rápida, inventario potencialmente mayor a 200 registros y uso secuencial en campo

## Constitution Check

*GATE: aprobado antes de diseño y revisado después del diseño.*

- **Spec primero**: PASS. El comportamiento está definido en `spec.md` antes de código.
- **Dueño de reglas**: PASS. Parsing e inferencia puros viven en core; rutas y UI delegan.
- **Fronteras no confiables**: PASS. Cámara, clipboard, URL, body HTTP y respuestas remotas se validan.
- **Auth y tenant**: PASS. Solo `system_admin`; la mutación acepta únicamente un `tenantId` opcional validado y el backend deriva, conserva o elimina la sede conforme a la selección. Nunca acepta una sede arbitraria.
- **Atomicidad, idempotencia y concurrencia**: PASS. Una RPC, lock de fila y revisión optimista; reintento obsoleto produce conflicto sin sobrescritura.
- **Supabase y RLS**: PASS. Se reutilizan tablas con RLS/grants existentes y una RPC `security invoker`; no se amplía acceso cliente.
- **Pruebas trazables**: PASS. Cada requisito tiene evidencia automatizada o manual prevista.
- **Efectos y privacidad**: PASS. El componente detiene cámara/tracks; frames no salen del dispositivo.
- **Dependencias**: PASS condicionado. `@zxing/browser` se incorpora fijado, con lockfile y carga diferida; la versión se verifica al implementar.

## Current Evidence and Reuse

- `apps/dashboard/src/features/admin/DynamicLinksSection.tsx` ya posee inventario, mensajes, actualización de unidad, activación y copia al portapapeles, pero carga máximo 200 unidades y obliga a encontrar una tarjeta.
- `apps/api/src/features/dynamic-links/repository.ts` ya expone `findDynamicLinkUnitByCode`, respaldado por el `unique` de `public_code`.
- `apps/api/src/features/dynamic-links/admin-routes.ts` ya protege todas las operaciones con `requireSystemAdmin`, valida destinos y usa revisión optimista.
- `control.update_dynamic_link_unit` acepta en la misma llamada `label`, `destination_type`, `destination_url` y `status`, bloquea la fila, comprueba `revision` y escribe auditoría.
- `packages/core/src/dynamic-links.ts` ya normaliza códigos y valida destinos. Se ampliará sin duplicar esas reglas en React.
- El editor completo sigue siendo dueño de lote, descargas, UID e hitos físicos. La configuración rápida limita la asociación al negocio seleccionado y su sede predeterminada.

## Recommended Interaction

1. En la cabecera de QR/NFC aparece “Configuración rápida”; en móvil se mantiene visible como acción sticky inferior dentro de la sección.
2. Al abrir, se muestra un diálogo full-screen con cámara trasera, guía visual, texto “Apunta al QR de ParaHoy” y alternativa “Pegar enlace o código”.
3. La primera lectura válida detiene la cámara. El cliente extrae únicamente el código de una URL propia de `go.thaledon.com` o de un código manual y consulta la unidad exacta. Para QR propios legados sin esquema o con barra final normaliza localmente a HTTPS; no navega ni sigue la lectura.
4. El formulario muestra código, URL permanente, estado y negocio actual. Presenta etiqueta, destino y un selector opcional de negocio. Sin cambio conserva la asociación; “Sin asignar” la elimina; un negocio elegido asigna su sede predeterminada. El backend infiere el tipo autoritativo.
5. “Guardar y activar” envía una sola solicitud. No se muestra confirmación por falta de negocio, sede o NFC. Si una unidad activa cambia de destino, se muestra una confirmación con el destino anterior y el nuevo.
6. En éxito se muestran el código y `go.thaledon.com/r/...`, con “Copiar enlace para NFC” como acción primaria y “Escanear otro” como acción secundaria.
7. Si el portapapeles falla, la URL queda en un campo readonly seleccionable. Si cámara o permiso fallan, la entrada manual permanece disponible. Si hay conflicto de revisión, se recargan los datos antes de permitir un nuevo intento.

## Architecture and Responsibilities

```text
QuickDynamicLinkSetup (state machine and orchestration)
  -> DynamicLinkQrScanner (camera lifecycle only)
  -> parseDynamicLinkReference (pure canonical input parsing)
  -> getDynamicLinkByCode (authenticated exact lookup)
  -> inferDynamicLinkDestinationType (pure classification)
  -> quickConfigureDynamicLink (single authenticated mutation)
       -> validateDestination
       -> updateDynamicLinkUnit (one existing RPC call)
            -> row lock + expected revision + update + audit
  -> copyPermanentUrl (clipboard with visible fallback)
```

La UI se modelará como unión discriminada: `scanning | resolving | editing | submitting | success | error`. Solo `DynamicLinkQrScanner` conoce stream, video y decoder. El padre conserva el borrador y decide reintentos. El backend vuelve a parsear/validar todo y deriva el tipo autoritativo.

## Project Structure

### Documentation (this feature)

```text
specs/003-mobile-quick-setup/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── quick-setup-api.md
├── checklists/
│   ├── requirements.md
│   └── mobile-ux.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/dashboard/
├── package.json                                      # add pinned scanner dependency
├── src/api.ts                                        # exact lookup and atomic quick mutation
├── src/features/admin/DynamicLinksSection.tsx        # entry point and unit refresh
├── src/features/admin/QuickDynamicLinkSetup.tsx      # dialog, form and state machine
├── src/features/admin/DynamicLinkQrScanner.tsx       # camera/decoder lifecycle
└── test/dynamic-link-quick-setup.test.mjs            # observable mobile flow
apps/api/
├── src/features/dynamic-links/admin-routes.ts        # lookup and quick configuration routes
├── src/features/dynamic-links/service.ts             # orchestration/inference delegation
└── test/dynamic-links.test.mjs                       # auth, lookup, mutation and errors
packages/core/
├── src/dynamic-links.ts                              # parser and destination inference
└── test/dynamic-links.test.mjs                       # pure parsing/classification tests
packages/types/src/dynamic-links.ts                    # shared request/result contracts if needed
pnpm-lock.yaml                                         # pinned dependency resolution
docs/current-status.md                                 # implemented status after delivery
docs/runbooks/smoke-tests.md                           # mobile camera/NFC smoke flow
```

**Structure Decision**: Se amplía el feature existente sin crear una app móvil ni una nueva frontera de datos. Los componentes nuevos evitan que `DynamicLinksSection.tsx` siga creciendo y permiten probar el ciclo de cámara por separado.

## API and Mutation Design

- `GET /dashboard/admin/dynamic-links/by-code/:code`: normaliza y valida el código, exige `system_admin`, usa `findDynamicLinkUnitByCode` y devuelve una sola unidad o `404`.
- `PATCH /dashboard/admin/dynamic-links/:id/quick-configuration`: recibe `revision`, `label`, `destinationUrl` y `tenantId` opcional; valida etiqueta, negocio, deriva sede predeterminada, infiere tipo, valida destino y llama una vez a `updateDynamicLinkUnit` con `status: active`.
- Si la unidad ya estaba activa, el evento será `updated`; si pasa de disponible/suspendida a activa, será `activated`. Ambos conservan `before_state` y `after_state`.
- Si `tenantId` se omite, el patch conserva la asociación; `null` elimina negocio/sede; un UUID válido deriva la sede predeterminada en backend. El request nunca acepta sede arbitraria, UID ni hitos.
- No se añade idempotency key: la revisión optimista convierte una repetición de la misma respuesta en `409`, evitando duplicación o sobrescritura. La UI adopta la unidad devuelta como éxito antes de permitir un nuevo envío.

## Data and Supabase Impact

No se requiere migración. `public_code` ya es único e indexado; la búsqueda exacta usa ese índice. La RPC actual mantiene una transacción breve, bloquea solo la unidad objetivo, incrementa `revision` y registra el evento. No se crean grants, políticas o funciones nuevas. Durante implementación se verificará mediante prueba real que una sola llamada cambia etiqueta, destino y estado, y que una revisión obsoleta deja la fila intacta.

## Failure, Privacy and Observability

- Cámara denegada/no disponible: estado local recuperable y entrada manual inmediata.
- QR inválido/externo: no se navega, no se solicita esa URL y no se consulta inventario hasta obtener un código válido. La UI diferencia este fallo de una unidad inexistente y de un fallo de API/red.
- Lookup autenticado: `401` pide iniciar sesión de nuevo; `403` informa que la cuenta no posee el rol administrador; `404` conserva el diagnóstico de unidad ausente; `400` informa formato no aceptado; `429` pide esperar y reintentar; `502`/`5xx` informa indisponibilidad temporal. Ningún mensaje muestra cuerpos, tokens, endpoints internos o detalles de proveedores.
- Unidad inexistente/archivada: mensaje específico; no se exponen destino o asociación de otra unidad.
- Destino inválido: error de campo desde código estable del backend.
- `409 dynamic_link_stale`: mantener borrador y pedir al operador volver a resolver la unidad antes de reenviar con una revisión vigente.
- Red/5xx: mantener borrador y habilitar reintento sin cerrar el diálogo.
- Clipboard rechazado: feedback y campo seleccionable; no se marca NFC como programado.
- Logs: código técnico, unit id y resultado; nunca frames de cámara, URLs destino completas ni contenido del portapapeles.

## Rollout and Rollback

1. Entregar parser/inferencia y endpoints detrás de la UI todavía no accesible.
2. Entregar diálogo con entrada manual y mutación atómica.
3. Añadir escáner cargado bajo demanda y validar permisos en staging HTTPS.
4. Activar el botón para administradores y ejecutar piloto en al menos un iPhone y un Android.
5. Rollback frontend: ocultar el botón/volver al bundle anterior; el CRUD existente permanece intacto.
6. Rollback backend: volver al Worker anterior; no existen migraciones ni datos nuevos que revertir.

## Requirement-to-Test Matrix

| Requirements | Automated evidence | Manual/external evidence |
| --- | --- | --- |
| FR-003-FR-005, FR-008, FR-013 | `packages/core/test/dynamic-links.test.mjs`; API lookup tests | URLs pegadas desde teclado móvil |
| FR-007, FR-009-FR-012, FR-016, NFR-004 | `apps/api/test/dynamic-links.test.mjs`; prueba de RPC contra DB de test | Revisar auditoría en panel |
| FR-001, FR-002, FR-006, FR-014, FR-015, FR-18 | `apps/dashboard/test/dynamic-link-quick-setup.test.mjs` de caracterización y typecheck/build | iOS/Android, 320 px, cámara negada y clipboard negado |
| FR-017, NFR-002, NFR-005 | test de cleanup del scanner y decoder fake | 20 lecturas físicas y verificación de indicador de cámara apagado |
| SC-004 | integración DB: éxito completo o rollback/conflicto | Interrupción de red en staging |

## Complexity Tracking

No hay violaciones constitucionales que justificar.
