# Checklist de preparación de requisitos: chat headless local

**Propósito**: evaluar si la especificación y el plan son completos, claros, consistentes y medibles antes de generar e implementar tareas, con énfasis en paridad, aislamiento, seguridad, contratos y recuperación.

**Creado**: 2026-08-12

**Feature**: [spec.md](../spec.md)

**Audiencia/momento**: revisor de PR y autor del feature, como gate formal previo a implementación.

**Aprobación**: checklist aprobado explícitamente por el usuario/revisor el 2026-08-12 y actualizado con sus decisiones posteriores sobre Supabase local, pausa manual y catálogo provider-neutral.

**Nota**: este checklist valida la calidad de los requisitos escritos; no valida código ni comportamiento implementado. Los ítems pertenecen al revisor y no deben autoaprobarse durante implementación.

## Completitud de requisitos

- [x] CHK001 ¿Está definido el límite exacto entre normalización de transporte y caso de uso conversacional compartido, incluidos resolución de cliente, conversación, persistencia inbound y routing? [Completeness, Spec §FR-003, Plan §Arquitectura]
- [x] CHK002 ¿Están enumeradas todas las clases de efectos que deben mantener paridad —mutaciones, eventos, alertas, handoff, notificaciones y respuestas posteriores— y no solo la respuesta inmediata? [Completeness, Spec §FR-004, Spec §FR-007]
- [x] CHK003 ¿Está especificado qué configuración constituye “debug habilitado” y qué fuentes son autoritativas para validar archivo dedicado, `APP_ENV=local`, `project_id`, host, puertos y schemas PostgREST de Supabase local? [Completeness, Spec §FR-001, Spec §FR-021, Plan §D-003]
- [x] CHK004 ¿Está documentada la procedencia verificable de una identidad headless y la información mínima que debe conservarse para impedir adoptar clientes WhatsApp? [Completeness, Spec §FR-022, Spec §FR-024, Data Model §HeadlessIdentity]
- [x] CHK005 ¿Están definidos todos los estados y transiciones de sesión y turno, incluidos cierre repetido, retry, conflicto e indeterminación? [Completeness, Spec §FR-009, Spec §FR-018, Data Model §HeadlessSession, Data Model §HeadlessTurnRecord]
- [x] CHK006 ¿Está definido el conjunto completo de campos permitido en snapshots y respuestas proyectadas, incluidos `redacted`/`redactionCodes`, y queda separada la captura tenant-local completa? [Completeness, Spec §FR-007, Spec §FR-010, Spec §FR-011, Contract §Envelope]
- [x] CHK007 ¿Están documentadas la retención y la limpieza del journal/datos sintéticos, incluida la validación obligatoria del stack antes de permitir un reset de Supabase local? [Completeness, Spec §FR-018, Data Model §Retención]

## Claridad de requisitos

- [x] CHK008 ¿La expresión “misma lógica” se concreta en observables comparables y diferencias de transporte permitidas, sin depender de interpretación subjetiva? [Clarity, Spec §FR-003–FR-005, Contract §Paridad]
- [x] CHK009 ¿El término “solo local” exige tanto CLI no desplegable como Supabase loopback y rechaza cualquier fallback a un destino remoto? [Clarity, Spec §FR-021, Plan §D-003]
- [x] CHK010 ¿La noción de “corrida” aclara la relación entre invocación CLI, identidad, sesión y conversación vigente? [Clarity, Spec §FR-002, Spec §FR-012, Data Model §HeadlessSession]
- [x] CHK011 ¿La semántica de identidad “nueva por defecto” aclara cuándo se crea el cliente de negocio y qué sucede si esa creación queda parcial? [Clarity, Spec §FR-022, Spec §FR-016]
- [x] CHK012 ¿Está aclarado que un fixture reemplaza únicamente la respuesta cruda del proveedor y cuál es la conducta ante fixture ausente, desconocido o malformado? [Clarity, Spec §FR-023, Spec §EC-014]
- [x] CHK013 ¿Los significados de `applied`, `repeated`, `rejected`, `failed` e `indeterminate` son mutuamente excluyentes y permiten una decisión de retry/reconciliación inequívoca? [Clarity, Spec §FR-009, Spec §FR-010, Data Model §HeadlessTurnRecord]
- [x] CHK014 ¿El límite de 4096 caracteres precisa cómo se cuentan Unicode, whitespace y texto vacío sin introducir normalización silenciosa? [Clarity, Spec §FR-019, Plan §D-013]

## Consistencia entre artefactos

- [x] CHK015 ¿Son consistentes la ausencia de la interfaz headless en desplegados, su acceso exclusivo a Supabase local y los cambios compartidos de catálogo IA/reanudación manual que sí formarán parte del Worker? [Consistency, Spec §FR-003, Spec §FR-005, Spec §FR-013, Spec §FR-021]
- [x] CHK016 ¿La conservación de `channel=whatsapp` es compatible con la exigencia de persistir una semántica veraz de proveedor headless? [Consistency, Spec §FR-007–FR-008, Research §D-011]
- [x] CHK017 ¿La IA real por defecto es consistente con el requisito de pruebas deterministas y queda clara la separación entre smoke real y paridad con dependencias controladas? [Consistency, Spec §FR-020, Spec §FR-023, Spec §NFR-007]
- [x] CHK018 ¿El cierre sin borrado es consistente con la posibilidad de reusar una identidad y con la política de conversación activa de 30 minutos? [Consistency, Spec §FR-012, Spec §FR-018, Spec §FR-022]
- [x] CHK019 ¿El límite de captura distingue respuestas del turno, respuesta directa posterior al reactivar un inbound headless y notificaciones no relacionadas de dashboard, cron o campañas, sin reescribir resultados durables? [Consistency, Spec §FR-006–FR-007, Spec §EC-017]
- [x] CHK020 ¿La regla “a lo sumo una vez” es consistente con el estado `indeterminate` y evita prometer una recuperación automática imposible de demostrar? [Consistency, Spec §FR-009, Spec §FR-014, Data Model §HeadlessTurnRecord]

## Calidad de criterios de aceptación

- [x] CHK021 ¿Puede medirse objetivamente la paridad mediante la proyección canónica y el listado cerrado de diferencias permitidas? [Measurability, Spec §SC-002, Contract §Paridad]
- [x] CHK022 ¿El criterio de cero llamadas a Meta cubre respuestas inmediatas, notificaciones diferidas, fallos y presencia de credenciales válidas? [Acceptance Criteria, Spec §SC-005, Spec §EC-010]
- [x] CHK023 ¿El criterio de ausencia en desplegados define artefactos inspeccionables —bundle, sourcemap, rutas, fixtures y configuración— en vez de limitarse a que la CLI esté deshabilitada? [Acceptance Criteria, Spec §SC-009, Plan §D-012]
- [x] CHK024 ¿El criterio de aislamiento define “sin lectura observable” y “sin revelar existencia” para identidad, sesión y datos de negocio cross-tenant? [Acceptance Criteria, Spec §SC-004, Spec §NFR-002]
- [x] CHK025 ¿La reconstrucción desde un resultado único identifica campos mínimos y excluye depender de logs libres o consultas directas a DB? [Acceptance Criteria, Spec §SC-006, Spec §NFR-005]
- [x] CHK026 ¿El objetivo de uso en menos de diez minutos especifica prerrequisitos y punto inicial suficientes para que sea reproducible por un agente nuevo? [Acceptance Criteria, Spec §SC-008, Quickstart §Prerrequisitos]

## Cobertura de escenarios

- [x] CHK027 ¿Los requisitos cubren el flujo primario completo desde identidad nueva hasta pedido confirmado, inspección y cierre? [Coverage, Spec §US1, Spec §SC-001]
- [x] CHK028 ¿Los flujos alternos de identidad preexistente, conversación vigente/expirada/manual y `test_double` inline están definidos de forma independiente? [Coverage, Spec §FR-012–FR-013, Spec §FR-022–FR-023]
- [x] CHK029 ¿Las excepciones de IA inválida, fallback, indisponibilidad total, catálogo obsoleto y geocodificación caída tienen resultados seguros definidos? [Coverage, Spec §FR-015–FR-016, Spec §EC-008, Spec §EC-011]
- [x] CHK030 ¿Los escenarios de recuperación distinguen fallo sin efectos, efecto completo, efecto parcial, manifiesto inválido, estado indeterminado y conflicto de idempotencia, y comparten la decisión entre CLI y dashboard? [Coverage, Recovery, Spec §FR-009, Spec §FR-016, Plan §Reconciliación]
- [x] CHK031 ¿La matriz de paridad incluye caminos determinísticos, semánticos, de handoff, confirmación, fallos y automatización manual en cantidad suficiente? [Coverage, Spec §FR-020, Spec §NFR-007, Contract §Matriz mínima]
- [x] CHK032 ¿Los intentos de audio, imagen, documento, comprobante, ubicación e interacción estructurada tienen una respuesta de rechazo especificada y consistente? [Coverage, Spec §FR-019, Spec §EC-002]

## Casos límite y concurrencia

- [x] CHK033 ¿Está definido el resultado cuando el mismo `turnId` reaparece con texto o fixture diferente? [Edge Case, Spec §FR-009, Contract §turn]
- [x] CHK034 ¿Está definido el orden observable cuando llegan turnos diferentes concurrentes a una misma sesión y cuando pertenecen a sesiones distintas? [Edge Case, Spec §NFR-008, Data Model §Locks]
- [x] CHK035 ¿Están cubiertos locks huérfanos, corrupción/versiones desconocidas del journal y cliente local eliminado fuera del runner? [Gap, Recovery, Data Model §Locks, Data Model §HeadlessIdentity]
- [x] CHK036 ¿Está definido el comportamiento cuando la sesión vence o se cierra mientras un turno está esperando el lock? [Gap, Edge Case, Spec §FR-012–FR-013, Spec §NFR-008]
- [x] CHK037 ¿Está especificado qué ocurre si la captura de una respuesta falla después de una mutación de negocio válida? [Gap, Recovery, Spec §FR-007, Spec §FR-016]

## Requisitos no funcionales, dependencias y supuestos

- [x] CHK038 ¿Está justificada la ausencia de una meta de latencia mientras pueden intervenir proveedores externos y quedan medibles los límites de tamaño, serialización e idempotencia? [Assumption, Plan §Contexto técnico]
- [x] CHK039 ¿Las dependencias de Supabase local, proveedores IA, geocodificación y catálogo indican cuáles son obligatorias, sustituibles o bloqueantes para cada clase de prueba? [Dependency, Spec §FR-016, Spec §FR-023, Quickstart §Prerrequisitos]
- [x] CHK040 ¿Las reglas de sanitización abarcan stdout, stderr, journal, `inspect`, logs y errores, sin confundirlas con la evidencia completa tenant-local necesaria para negocio/paridad? [Completeness, Security, Spec §FR-007, Spec §FR-011, Spec §NFR-004]

## Notas

- Marcar ítems completados con `[x]` únicamente durante revisión de requisitos.
- Añadir el hallazgo y el artefacto que lo resuelve junto al ítem correspondiente.
- Si un ítem revela un cambio de producto, actualizar y aprobar la SPEC antes de implementación.
- Si revela una decisión técnica, actualizar `plan.md` o sus contratos antes de generar/ejecutar tareas afectadas.
