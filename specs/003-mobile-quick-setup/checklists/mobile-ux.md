# Requirements Quality Checklist: Configuración rápida móvil

**Purpose**: Revisar claridad, cobertura y consistencia de los requisitos móviles antes de implementar
**Created**: 2026-09-09
**Audience**: Revisor de producto y PR

## Requirement Completeness

- [ ] CHK001 ¿Están definidos el punto de entrada y su prominencia tanto en móvil como en escritorio? [Completeness, Spec §FR-001]
- [ ] CHK002 ¿Están especificados todos los estados de la sesión: escaneo, resolución, edición, envío, éxito y error? [Completeness, Spec §FR-018]
- [ ] CHK003 ¿Está explícito qué datos existentes se muestran y cuáles pueden modificarse en el flujo rápido? [Completeness, Spec §FR-006-FR-009]
- [ ] CHK004 ¿Está definido el camino equivalente cuando cámara o permiso no están disponibles? [Completeness, Spec §FR-004, NFR-005]

## Requirement Clarity

- [ ] CHK005 ¿La forma canónica aceptada de URL/código está definida sin permitir coincidencias parciales de otros hosts? [Clarity, Spec §FR-003]
- [ ] CHK006 ¿La regla “guardar y activar” define inequívocamente atomicidad y resultado ante fallos? [Clarity, Spec §FR-010, SC-004]
- [ ] CHK007 ¿La inferencia de tipo distingue hosts reconocidos, carta de ParaHoy y fallback website? [Clarity, Spec §FR-008]
- [ ] CHK008 ¿La conducta con unidades activas, suspendidas, disponibles y archivadas está definida por estado? [Clarity, Spec §FR-012]

## Requirement Consistency

- [ ] CHK009 ¿La asociación opcional es consistente entre escenarios, requisitos, supuestos y contrato? [Consistency, Spec §US1.4, FR-009]
- [ ] CHK010 ¿Los requisitos rápidos conservan las mismas reglas de destino y autorización del CRUD completo? [Consistency, Spec §FR-013, FR-016]
- [ ] CHK011 ¿La copia para NFC mantiene la invariante de URL idéntica al QR sin marcar hitos físicos automáticamente? [Consistency, Spec §FR-014, FR-019]

## Acceptance Criteria Quality

- [ ] CHK012 ¿El tiempo de configuración está cuantificado desde un inicio y final observables? [Measurability, Spec §SC-001]
- [ ] CHK013 ¿La métrica de lectura define muestra, éxito al primer intento y límite temporal? [Measurability, Spec §SC-003]
- [ ] CHK014 ¿La exactitud de unidad y enlace NFC se puede comprobar carácter por carácter? [Measurability, Spec §SC-002, SC-005]

## Scenario and Edge-Case Coverage

- [ ] CHK015 ¿Están cubiertos QR duplicado en frames, QR externo, código inexistente y unidad archivada? [Coverage, Spec §EC-001-EC-002, US2.3]
- [ ] CHK016 ¿Está definida la recuperación que conserva borrador para red, destino inválido y conflicto concurrente? [Coverage, Spec §EC-003-EC-006]
- [ ] CHK017 ¿Está definido cuándo se detiene la cámara para lectura, cierre, pérdida de visibilidad y desmontaje? [Coverage, Spec §FR-017]
- [ ] CHK018 ¿Está cubierto el fallo del portapapeles con una alternativa usable y explícita? [Coverage, Spec §US3.3, FR-014]

## Non-Functional Requirements

- [ ] CHK019 ¿Los requisitos de ancho, área táctil, foco y etiquetas cubren la interacción sin teclado físico? [Coverage, Spec §NFR-001, NFR-003]
- [ ] CHK020 ¿Privacidad, HTTPS y no persistencia de frames están definidos como condiciones obligatorias? [Security, Spec §FR-017, NFR-004-NFR-005]
- [ ] CHK021 ¿El requisito de uso con vehículo detenido evita que la UX incentive operación en movimiento? [Safety, Spec §EC-008]

## Dependencies & Assumptions

- [ ] CHK022 ¿La dependencia de cámara/navegador y la degradación manual están documentadas para los dispositivos piloto? [Dependency, Spec §Assumptions]
- [ ] CHK023 ¿Está explícito que asociación, NFC, lotes y auditoría detallada permanecen en el CRUD existente? [Scope, Spec §FR-019, Assumptions]
