# Feature Specification: Enlaces dinámicos QR y NFC

**Feature Branch**: `codex/dynamic-links`

**Created**: 2026-09-07

**Status**: Approved for implementation

**Input**: Crear enlaces físicos permanentes para QR y NFC, administrados internamente por ParaHoy.

## Context and Current Evidence *(mandatory)*

- **Problem**: ParaHoy no tiene inventario de habladores físicos ni enlaces permanentes cuyos destinos puedan actualizarse sin reimprimir QR o reprogramar NFC.
- **Current behavior**: El dashboard tiene perfiles públicos bajo `parahoy.thaledon.com/r/:tenantSlug`, pero no existen códigos físicos, lotes, historial de enlaces ni una ruta de redirección independiente. La API se ejecuta como Cloudflare Worker y los datos globales viven en `control`.
- **Evidence**: `apps/dashboard/src/App.tsx`, `apps/api/src/index.ts`, `apps/api/wrangler.toml`, `docs/architecture/database-migrations.md`, `supabase/migrations/20260709193000_control_tenant_demo_baseline.sql`. El 2026-09-07 `parahoy.thaledon.com` respondió desde Vercel y `go.thaledon.com` no existía en DNS.
- **Desired outcome**: Cada unidad física conserva una URL `https://go.thaledon.com/r/<código>` que puede redirigir a un destino editable y administrarse internamente con trazabilidad.

## Scope *(mandatory)*

### In Scope

- Redirección pública temporal para unidades activas y páginas de respaldo seguras para estados no redirigibles.
- Inventario global de unidades y lotes, con código público permanente, estado, negocio/sede opcionales y destino actual.
- Administración exclusiva para usuarios `system_admin`: creación individual/en lote, búsqueda, cambio de destino, activación, suspensión, archivado, auditoría y exportación.
- Generación de QR SVG/PNG y lotes con manifiesto CSV.
- Registro de hitos de impresión, programación, verificación y bloqueo NFC.
- Suspensión de enlaces asignados cuando un negocio se suspenda o inactive.

### Out of Scope

- Autoservicio de negocios, tokens privados de activación y permisos tenant para enlaces.
- Analítica de visitantes, identificación de QR frente a NFC y retención de eventos.
- Una nueva página tipo Linktree; el MVP solo redirige a un enlace determinado.
- Programación NFC directamente desde el navegador o integración con lectores USB.
- Caché persistente de destinos para tolerar caída de la base de datos.

### Dependencies

- Una zona activa de Cloudflare para conectar `go.thaledon.com` al Worker.
- Migración DNS cuidadosa desde los nameservers actuales de GoDaddy.
- Supabase, Cloudflare Workers y el sistema de Auth existentes.
- Stickers NFC NTAG215 de 25 mm y una herramienta de escritura NDEF.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Abrir un hablador físico (Priority: P1)

Una persona escanea el QR o acerca su teléfono al NFC de un hablador y llega al destino vigente sin reemplazar el material físico.

**Why this priority**: La permanencia de la URL física es el valor central del producto.

**Independent Test**: Crear una unidad activa, abrir su URL permanente, cambiar su destino y comprobar que la misma URL lleva inmediatamente al nuevo valor.

**Acceptance Scenarios**:

1. **Given** una unidad activa con un destino válido, **When** se solicita su URL permanente, **Then** responde con una redirección temporal al destino configurado.
2. **Given** una unidad activa cuyo destino fue cambiado, **When** se vuelve a solicitar la misma URL, **Then** redirige al nuevo destino sin conservar el anterior en caché.
3. **Given** una unidad disponible sin activar, **When** se solicita su URL, **Then** se muestra una página de respaldo sin redirigir.
4. **Given** una unidad suspendida, archivada, desconocida o inválida, **When** se solicita su URL, **Then** se entrega la respuesta segura correspondiente sin revelar datos administrativos.

---

### User Story 2 - Administrar inventario de unidades (Priority: P1)

Un administrador interno crea unidades individuales o lotes, configura destinos, asigna unidades opcionalmente a negocio/sede y conserva su historial.

**Why this priority**: El equipo debe controlar inventario antes de entregar habladores y actualizar enlaces posteriormente.

**Independent Test**: Como administrador global, crear un lote, buscar una unidad por código, cambiar su destino, suspenderla y revisar su auditoría.

**Acceptance Scenarios**:

1. **Given** un administrador global, **When** crea un lote, **Then** recibe unidades con códigos únicos y URLs permanentes.
2. **Given** una unidad, **When** se actualiza su destino o asignación, **Then** se registra quién realizó el cambio y cuándo.
3. **Given** una unidad archivada, **When** un administrador intenta reactivarla, **Then** el sistema no permite reutilizarla.
4. **Given** un usuario no administrador, **When** intenta acceder al inventario, **Then** recibe una respuesta de autorización denegada.

---

### User Story 3 - Fabricar y verificar QR/NFC (Priority: P2)

Un operador descarga QR de impresión y un manifiesto para programar el mismo enlace en NFC, registrar la verificación y bloquear el tag después de comprobarlo.

**Why this priority**: Evita asociar erróneamente un QR con un NFC de otra unidad.

**Independent Test**: Descargar los SVG de un lote, marcar una unidad como impresa, programada, verificada y bloqueada, y consultar dichos hitos.

**Acceptance Scenarios**:

1. **Given** un lote creado, **When** el administrador descarga sus QR, **Then** cada SVG codifica únicamente la URL permanente de su unidad.
2. **Given** una unidad física verificada, **When** se registran sus hitos de fabricación, **Then** el historial conserva la secuencia y el UID NFC opcional.

### Edge Cases and Failure Behavior

- **EC-001**: Un código desconocido o mal formado responde sin consultar o revelar inventario; una unidad disponible, suspendida, archivada o inválida devuelve una página de respaldo no cacheable.
- **EC-002**: Destinos con protocolos peligrosos, hosts locales, IP privadas o bucles hacia `go.thaledon.com` se rechazan antes de persistirse.
- **EC-003**: Dos ediciones simultáneas de una unidad no pueden sobrescribir silenciosamente la versión más reciente.
- **EC-004**: Reintentar una creación de lote con la misma solicitud no duplica unidades.
- **EC-005**: Si el negocio asignado se suspende o inactive, sus enlaces dejan de redirigir; reactivar el negocio no reactiva los enlaces automáticamente.
- **EC-006**: Si la configuración global no está disponible, la ruta pública falla con una página temporal segura en lugar de usar un destino potencialmente obsoleto.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE asignar a cada unidad un código público único, difícil de adivinar e inmutable, junto con una URL permanente bajo `https://go.thaledon.com/r/<código>`.
- **FR-002**: El QR y el NFC de una misma unidad DEBEN contener exactamente la URL permanente, nunca el destino final.
- **FR-003**: La ruta pública DEBE redirigir temporalmente una unidad activa a su destino válido y no debe usar redirecciones permanentes ni caché de destino.
- **FR-004**: La ruta pública DEBE mostrar respuestas de respaldo para unidades disponibles, suspendidas, archivadas, desconocidas o con configuración inválida.
- **FR-005**: Solo un administrador global DEBE poder crear, consultar, editar, activar, suspender o archivar unidades y lotes.
- **FR-006**: El administrador DEBE poder crear una unidad individual y lotes de hasta 500 unidades de manera idempotente.
- **FR-007**: Cada unidad DEBE conservar etiqueta interna, lote opcional, negocio y sede opcionales, tipo/destino actual, estado, fechas e hitos opcionales de fabricación NFC.
- **FR-008**: El administrador DEBE poder buscar y filtrar unidades por código, etiqueta, lote, negocio, sede y estado.
- **FR-009**: El sistema DEBE validar destinos HTTPS; debe restringir hosts para Google Reviews, WhatsApp e Instagram, y rechazar protocolos peligrosos, destinos locales, IP privadas y bucles.
- **FR-010**: El sistema DEBE registrar un historial inmutable de los cambios administrativos relevantes de cada unidad.
- **FR-011**: El administrador DEBE poder descargar QR individuales en SVG/PNG y un lote con SVG y manifiesto CSV.
- **FR-012**: Archivar una unidad DEBE ser irreversible; su código nunca puede borrarse ni reutilizarse.
- **FR-013**: Cuando un negocio se suspenda o inactive, sus unidades asignadas y activas DEBEN dejar de redirigir y requerir reactivación manual.
- **FR-014**: El MVP NO DEBE incluir autoservicio de negocios, analítica de visitantes, tokens de activación privados ni una nueva página de múltiples enlaces.

### Non-Functional Requirements

- **NFR-001**: Las rutas públicas DEBEN ser no cacheables, no registrar PII y conservar un fallback seguro ante fallos de dependencia.
- **NFR-002**: Las mutaciones administrativas DEBEN ser auditables, autorizadas y resistentes a reintentos y concurrencia.
- **NFR-003**: Las tablas globales DEBEN tener RLS y grants explícitos que impidan acceso cliente directo.
- **NFR-004**: Los QR de 25 × 25 mm DEBEN usar negro sobre blanco, margen de cuatro módulos y corrección de errores M; el lote piloto debe demostrar lectura correcta en los dispositivos acordados.

### Key Entities *(include when data is involved)*

- **Unidad de enlace**: Hablador físico con código permanente, destino editable, estado y trazabilidad de fabricación.
- **Lote**: Grupo identificable de unidades creadas o fabricadas juntas.
- **Evento de auditoría**: Registro de una creación, cambio, transición o hito físico asociado a una unidad.
- **Negocio y sede**: Contexto opcional al que se asigna una unidad; no son necesarios para activarla.

## Verification Traceability *(mandatory)*

| Requirement | Acceptance scenarios | Required evidence |
| --- | --- | --- |
| FR-001, FR-003, FR-004 | US1.1-US1.4 | Pruebas de dominio y rutas públicas |
| FR-005, FR-006, FR-008, FR-010 | US2.1-US2.4 | Pruebas de API autenticada, autorización y auditoría |
| FR-007, FR-012, FR-013 | US2.2-US2.3, EC-005 | Migración, integración y transiciones |
| FR-009 | EC-002 | Pruebas de validación de destinos |
| FR-011, NFR-004 | US3.1-US3.2 | Pruebas UI y evidencia manual de QR/NFC impreso |
| NFR-001-NFR-003 | EC-001-EC-006 | Headers, RLS/grants, concurrencia e idempotencia |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un administrador puede crear un lote de hasta 500 unidades y descargar su manifiesto en menos de dos minutos, sin códigos duplicados.
- **SC-002**: El 100% de las unidades activas probadas redirigen con la misma URL física después de un cambio de destino.
- **SC-003**: Las lecturas de QR impresos de 25 × 25 mm alcanzan 30/30 lecturas correctas en el piloto de tres dispositivos definido.
- **SC-004**: El canario público devuelve la redirección y headers esperados durante 48 horas antes de autorizar impresión definitiva.
- **SC-005**: Usuarios no administradores no pueden leer ni modificar inventario global mediante la API ni acceso directo a datos.

## Assumptions

- El DNS autoritativo de `thaledon.com` se migrará a Cloudflare antes de conectar `go.thaledon.com` directamente al Worker.
- El administrador global existente es la única audiencia del MVP.
- Los NTAG215 de 25 mm se programarán con registros NDEF URI y se bloquearán después de verificar su contenido.
- La activación exige solo un destino válido; negocio, sede y verificación física generan advertencias, no bloqueos.
- Los QR se imprimirán en negro sobre blanco, con margen de cuatro módulos y corrección de errores M.
- Las URLs de destino se mantienen privadas para la administración; el visitante solo observa la redirección o la página de respaldo.

## Open Questions

None — critical ambiguities resolved on 2026-09-07.
