# Feature Specification: Configuración rápida móvil de QR

**Feature Branch**: `master`

**Created**: 2026-09-09

**Status**: Propuesto para revisión

**Input**: Un administrador en campo debe escanear el QR físico desde su celular, configurar etiqueta y destino, guardar y activar la unidad sin buscarla manualmente, y copiar su URL permanente para programar el NFC.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Escanear, configurar y activar (Priority: P1)

Un administrador global detenido en un lugar seguro abre “Configuración rápida”, escanea el QR que tiene en la mano, pega el destino, escribe una etiqueta reconocible y guarda la unidad activa sin navegar por el inventario.

**Why this priority**: Elimina la búsqueda manual que hace lenta y propensa a errores la configuración de unidades físicas desde el celular.

**Independent Test**: Desde un teléfono autenticado, escanear una unidad disponible, completar etiqueta y destino, y comprobar que queda activa y redirige al destino configurado.

**Acceptance Scenarios**:

1. **Given** un administrador global y un QR válido de ParaHoy, **When** concede acceso a la cámara y lo escanea, **Then** el sistema localiza exactamente la unidad y muestra código, estado y datos actuales.
2. **Given** una unidad disponible o suspendida, **When** el administrador ingresa etiqueta, destino válido y una asociación opcional y elige “Guardar y activar”, **Then** todos los cambios y la activación se completan como una sola operación.
3. **Given** una unidad ya activa, **When** se ingresa un destino distinto, **Then** el sistema muestra el destino actual y exige una confirmación antes de conservar el estado activo y reemplazar el destino.
4. **Given** una unidad sin negocio o sede, **When** se guarda y activa, **Then** la operación se completa sin advertencia bloqueante y la asociación permanece vacía.

---

### User Story 2 - Recuperarse sin cámara (Priority: P1)

Un administrador puede pegar la URL permanente o escribir su código cuando la cámara no está disponible, el permiso fue negado o el QR no se deja leer.

**Why this priority**: La operación en campo no puede depender de un permiso, navegador o condición de iluminación particular.

**Independent Test**: Denegar el permiso de cámara, pegar una URL válida de `go.thaledon.com`, completar el formulario y activar la unidad.

**Acceptance Scenarios**:

1. **Given** una cámara no disponible o sin permiso, **When** el flujo informa el problema, **Then** ofrece inmediatamente la entrada manual sin perder datos ya escritos.
2. **Given** una URL o código válido de ParaHoy pegado manualmente, **When** el administrador continúa, **Then** localiza la misma unidad que habría encontrado el escáner.
3. **Given** un QR externo, un código inválido o una unidad inexistente, **When** se intenta resolver, **Then** no se abre ni se sigue el enlace y se muestra un error recuperable.

---

### User Story 3 - Copiar para NFC y continuar (Priority: P2)

Después de configurar una unidad, el administrador copia con un toque la URL permanente exacta que debe escribir en el chip NFC y puede comenzar con la siguiente unidad.

**Why this priority**: Reduce la posibilidad de programar el NFC con el destino final o con la URL perteneciente a otro QR.

**Independent Test**: Configurar una unidad, copiar su enlace, comparar el portapapeles con el QR y reiniciar el flujo para escanear otra unidad.

**Acceptance Scenarios**:

1. **Given** una configuración exitosa, **When** aparece el resultado, **Then** la URL permanente se muestra junto al código y tiene una acción principal “Copiar enlace para NFC”.
2. **Given** acceso al portapapeles, **When** el administrador copia, **Then** recibe confirmación clara y el valor copiado coincide exactamente con la URL codificada en el QR.
3. **Given** que el navegador rechaza el portapapeles, **When** falla la copia, **Then** la URL permanece visible y seleccionable para copia manual.
4. **Given** una unidad terminada, **When** el administrador elige “Escanear otro”, **Then** el flujo limpia la unidad anterior y vuelve al escáner.

### Edge Cases and Failure Behavior

- **EC-001**: Una unidad archivada se identifica, pero no puede modificarse ni activarse; el flujo ofrece cerrar o escanear otra.
- **EC-002**: Si el QR se detecta varias veces, solo la primera lectura inicia la consulta y la cámara se detiene de inmediato.
- **EC-003**: Si otra sesión modifica la unidad después de escanearla, el guardado no sobrescribe silenciosamente el cambio y obliga a recargar los datos.
- **EC-004**: Un fallo de red conserva etiqueta y destino localmente mientras el diálogo siga abierto y permite reintentar.
- **EC-005**: Cerrar el diálogo, cambiar de pantalla o completar una lectura detiene todos los tracks de cámara.
- **EC-006**: Un destino inseguro o incompatible se rechaza con un mensaje accionable sin activar la unidad.
- **EC-007**: Si el destino pertenece a Google, WhatsApp o Instagram, o coincide con la ruta canónica `/carta` de ParaHoy, se clasifica automáticamente; un HTTPS público no reconocido se clasifica como sitio web. La clasificación manual detallada permanece disponible en el editor completo.
- **EC-008**: La interacción está diseñada para usarse con el vehículo detenido; no se incorporan flujos que incentiven operar el teléfono mientras se conduce.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El inventario QR/NFC DEBE ofrecer una acción prominente “Configuración rápida” accesible sin buscar una unidad.
- **FR-002**: El flujo DEBE abrir una experiencia de pantalla completa en móvil y permitir escanear un QR usando preferentemente la cámara trasera.
- **FR-003**: El flujo DEBE aceptar únicamente un código público válido o una URL canónica `https://go.thaledon.com/r/<código>`; nunca debe navegar automáticamente al contenido escaneado.
- **FR-004**: El administrador DEBE poder pegar una URL o escribir un código como alternativa completa a la cámara.
- **FR-005**: La búsqueda DEBE resolver el código exacto en todo el inventario, sin depender del límite ni de los filtros de la lista visible.
- **FR-006**: Después de resolver la unidad, el flujo DEBE mostrar su código, URL permanente, estado, etiqueta, destino actual y si está asociada a un negocio.
- **FR-007**: El formulario rápido DEBE requerir una etiqueta no vacía y un destino HTTPS válido.
- **FR-008**: El tipo de destino DEBE inferirse para Google Reviews, WhatsApp e Instagram mediante sus hosts permitidos, y para cartas de ParaHoy mediante el host público configurado y la ruta `/carta`; el resto de HTTPS públicos se clasifica como sitio web.
- **FR-009**: La operación rápida NO DEBE exigir negocio, sede, verificación NFC ni UID NFC. Debe ofrecer un selector de negocio opcional que conserve la asociación existente si no se modifica, elimine negocio y sede al elegir “Sin asignar”, y asigne el negocio y su sede predeterminada al elegir uno.
- **FR-010**: “Guardar y activar” DEBE persistir etiqueta, destino, tipo inferido, asociación opcional y estado activo en una sola mutación atómica y auditable.
- **FR-011**: La mutación DEBE usar la revisión leída para detectar concurrencia y no sobrescribir una versión más reciente.
- **FR-012**: Las unidades disponibles, suspendidas o activas DEBEN poder pasar por el flujo rápido; las archivadas DEBEN permanecer inmutables.
- **FR-013**: El destino DEBE cumplir las mismas reglas de seguridad del editor completo antes de persistirse.
- **FR-014**: Después del éxito, el flujo DEBE ofrecer copiar con un toque la URL permanente para NFC, mostrar confirmación y mantener una alternativa seleccionable si el portapapeles falla.
- **FR-015**: El flujo DEBE permitir reiniciar inmediatamente para escanear otra unidad sin volver al listado.
- **FR-016**: El acceso y las mutaciones DEBEN seguir limitados a administradores globales autenticados.
- **FR-017**: La cámara DEBE detenerse al detectar un código, cerrar el flujo, perder visibilidad o desmontar la vista; las imágenes de cámara NO DEBEN enviarse ni persistirse.
- **FR-018**: Los errores de permiso, compatibilidad, código, unidad, destino, concurrencia, red y portapapeles DEBEN tener estados diferenciados y recuperables.
- **FR-019**: El alcance NO DEBE programar NFC desde el navegador ni marcarlo automáticamente como programado; la asociación opcional se limita al negocio y sede predeterminada, sin administrar lotes ni otros hitos físicos.

### Non-Functional Requirements

- **NFR-001**: Todos los controles principales DEBEN tener etiquetas accesibles, foco visible y un área táctil mínima de 44 × 44 px.
- **NFR-002**: Con un QR enfocado y luz suficiente, la lectura DEBERÍA completarse en menos de tres segundos en los dispositivos piloto.
- **NFR-003**: El formulario DEBE evitar scroll horizontal y permanecer utilizable desde 320 px de ancho.
- **NFR-004**: La operación atómica DEBE conservar las políticas existentes de autorización, RLS, mínimo privilegio y auditoría.
- **NFR-005**: El escáner DEBE funcionar bajo HTTPS y degradarse a entrada manual cuando el navegador no permite cámara.

### Key Entities

- **Sesión de configuración rápida**: Estado efímero de la interacción, incluyendo lectura, unidad resuelta, borrador, envío y resultado; no se persiste como entidad de negocio.
- **Unidad de enlace**: Entidad existente identificada por código público, con etiqueta, destino, asociación opcional, estado y revisión.
- **Evento de auditoría**: Registro existente que conserva actor, estado anterior y estado posterior de la configuración y activación rápidas.

## Verification Traceability *(mandatory)*

| Requirement | Acceptance scenarios | Required evidence |
| --- | --- | --- |
| FR-001, FR-002, FR-006, NFR-001, NFR-003 | US1.1, US1.2 | Pruebas de comportamiento UI y revisión móvil |
| FR-003-FR-005, FR-017, FR-018, NFR-002, NFR-005 | US1.1, US2.1-US2.3, EC-002, EC-005 | Pruebas del parser/escáner y matriz manual de dispositivos |
| FR-007-FR-013, FR-016, NFR-004 | US1.2-US1.4, EC-001, EC-003, EC-006 | Pruebas de dominio, API, autorización y transacción de base de datos |
| FR-014, FR-015, FR-019 | US3.1-US3.4 | Pruebas UI de éxito, portapapeles y reinicio |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un administrador puede pasar de abrir “Configuración rápida” a una unidad activa en menos de 60 segundos durante el piloto móvil.
- **SC-002**: En 20 configuraciones consecutivas, el 100% modifica la unidad cuyo código coincide con el QR físico escaneado.
- **SC-003**: En los dispositivos piloto, al menos 18 de 20 QR legibles se detectan en el primer intento y en menos de tres segundos.
- **SC-004**: El 100% de las pruebas de interrupción entre guardado y activación termina con ambos cambios aplicados o ninguno aplicado.
- **SC-005**: El 100% de enlaces copiados para NFC coincide exactamente con la URL permanente mostrada y codificada en el QR.
- **SC-006**: Los usuarios sin rol de administrador global no pueden resolver ni modificar unidades mediante las rutas rápidas.

## Assumptions

- El administrador opera el teléfono con la moto estacionada y dispone de una sesión autenticada vigente.
- `parahoy.thaledon.com` usa HTTPS, requisito del acceso a cámara y portapapeles modernos.
- La etiqueta rápida representa el nombre con el que el equipo reconocerá el hablador; el negocio solo cambia mediante una selección explícita.
- Si se elige un negocio, el flujo reutiliza su sede predeterminada como lo hace el editor completo.
- La primera entrega prioriza cámara trasera, entrada manual y copia; linterna, zoom, vibración y programación Web NFC quedan fuera del MVP.
- La UI detallada actual continúa disponible para lote, asociación, hitos físicos, descarga y auditoría.

## Open Questions

None — no critical ambiguities require product input before planning.
