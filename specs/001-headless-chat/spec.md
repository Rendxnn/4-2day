# Feature Specification: Modo headless del chat de ParaHoy

**Feature Branch**: `feature/headless-mode`

**Created**: 2026-08-12

**Status**: Approved — aprobación explícita del usuario el 2026-08-12

**Implementation gate**: La aprobación del producto y las decisiones del análisis del 2026-08-12 están
integradas; resta repetir `$speckit-analyze` y resolver cualquier hallazgo bloqueante nuevo.

**Input**: User description: "Exponer un modo headless controlado desde consola para enviar turnos de
texto, mantener sesiones y observar respuestas y transiciones usando exactamente el flujo
conversacional de WhatsApp después de normalizar el transporte, sin duplicar el router ni enviar a
Meta, con resultados estructurados seguros y aislamiento de entorno y tenant."

## Context and Current Evidence *(mandatory)*

- **Problem**: ParaHoy solo permite recorrer el flujo conversacional completo mediante eventos de
  WhatsApp. Un agente no dispone de una interfaz controlada para ejecutar conversaciones de varios
  turnos, inspeccionar sus resultados y verificar transiciones sin construir un webhook de Meta ni
  intentar entregas reales al cliente.
- **Current behavior**:
  - El webhook valida y normaliza el payload, registra el evento crudo para idempotencia y procesa
    cada mensaje normalizado. Después resuelve tenant, cliente y conversación, persiste el mensaje
    entrante, guarda ubicación cuando aplica y entrega el turno al router conversacional.
  - El tenant se resuelve por el identificador receptor de WhatsApp registrado en `control`; después
    todas las lecturas y mutaciones de negocio usan el schema del tenant resuelto.
  - La identidad del cliente se deriva actualmente del teléfono de origen. Las conversaciones se
    registran con canal `whatsapp`, se reutilizan mientras estén activas y extienden su vencimiento a
    30 minutos desde el último turno entrante. Las conversaciones terminadas o vencidas no se
    reutilizan.
  - `routeInboundMessage` es el router efectivo. Recibe ambiente, tenant, conversación, mensaje
    normalizado, traza e identificador del mensaje persistido. No hay hoy otro consumidor de este
    contrato fuera del handler de WhatsApp.
  - Antes del plan semántico, el router aún resuelve localmente solicitudes explícitas de humano,
    consulta de estado, saludo/menú y respuestas exactas de pago, billing o configuración. Esta es la
    línea base que el feature debe caracterizar antes de migrar esas decisiones a IA y herramientas
    controladas dentro del flujo compartido.
  - Cuando el texto alcanza el plan semántico, la IA recibe estado, menú, draft, último prompt y
    operaciones permitidas. La salida se valida en estructura, confianza, IDs, evidencia, reglas y
    estado antes de aplicar cambios. Las mutaciones de draft y conversación se protegen contra datos
    obsoletos y los hechos autoritativos se recalculan en backend.
  - Una salida de IA vacía o de baja confianza solicita aclaración. Al tercer intento de aclaración
    sin resolución, la conversación pasa a intervención humana. Si los proveedores configurados no
    producen un plan válido, el sistema conserva el pedido, registra un evento, intenta abrir una
    alerta técnica y compone una respuesta segura.
  - Toda respuesta de texto del router usa actualmente un único helper que primero intenta enviarla a
    Meta y después registra el resultado saliente. Por tanto, invocar el router directamente desde una
    prueba headless hoy produciría tráfico externo si las credenciales estuvieran configuradas.
  - No existe una interfaz headless, una sesión sintética ni un comando del repositorio que ejecute
    este flujo sin WhatsApp.
- **Acoplamientos verificados**:
  - La idempotencia del evento crudo y la normalización pertenecen al webhook; no forman parte del
    router post-normalización.
  - La resolución de tenant depende del canal de WhatsApp, y la resolución de cliente depende del
    teléfono remitente.
  - La creación/reutilización de conversación, la persistencia inbound y la preparación del input del
    router están encapsuladas dentro del handler y no constituyen hoy un caso de uso público
    independiente.
  - El router y todas sus ramas comparten persistencia real de menú, conversación, draft, orden,
    eventos y alertas, pero la salida de texto está acoplada al cliente de Meta.
  - La selección de proveedor IA y fallback es configuración tenant-aware; no es una decisión del
    transporte.
- **Evidence**:
  - `apps/api/src/modules/whatsapp-webhook/handler.ts`: secuencia desde normalización hasta routing y
    único armado actual de `RouteInboundMessageInput`.
  - `apps/api/src/modules/whatsapp-webhook/normalize.ts` y `packages/types/src/whatsapp.ts`: frontera y
    contrato del mensaje normalizado.
  - `apps/api/src/modules/tenant-resolver/tenant-resolver.ts`: resolución de canal y tenant activo.
  - `apps/api/src/features/conversations/service.ts`,
    `apps/api/src/features/conversations/repository.ts` y `packages/core/src/conversation.ts`: creación,
    reutilización, pausa, finalización y vencimiento de 30 minutos.
  - `apps/api/src/features/chat-routing/router.ts`: orden actual de ramas deterministas y fallback
    semántico.
  - `apps/api/src/features/chat-routing/semantic/operation-plan.ts` y
    `apps/api/src/features/chat-routing/semantic/order.ts`: contexto IA, operaciones permitidas,
    validación, fallback de proveedor, aplicación transaccional y fallos seguros.
  - `apps/api/src/features/chat-routing/manual/handoff.ts`: aclaraciones, límite de intentos, pausa y
    alerta humana.
  - `apps/api/src/features/chat-routing/outbound/send.ts` y
    `apps/api/src/modules/whatsapp-webhook/whatsapp-client.ts`: acoplamiento de cada respuesta con Meta.
  - `apps/api/src/modules/message-log/message-log.ts`: persistencia de mensajes inbound/outbound y
    metadata de routing.
  - `apps/api/test/routing-policy-signals.test.mjs`, `apps/api/test/order-adjustment.test.mjs`,
    `apps/api/test/routing-tracing.test.mjs` y `apps/api/test/conversation-automation.test.mjs`:
    caracterización parcial de routing, plan semántico, trazas y pausa; varias verificaciones son
    estructurales y no existe todavía una prueba de conversación headless de extremo a extremo.
- **Desired outcome**: Un operador autorizado o agente puede iniciar y continuar una conversación de
  texto aislada desde consola, observar de forma estructurada y segura cada respuesta y transición, y
  obtener el mismo comportamiento que produciría WhatsApp desde la frontera posterior a la
  normalización. El ejercicio conserva validaciones, persistencia y efectos internos reales del
  entorno de prueba, pero nunca contacta a Meta ni introduce un router paralelo.

## Clarifications

### Session 2026-08-12

- Q: ¿En qué ambientes puede existir y ejecutarse el modo headless? → A: Solo en ambiente local con
  debug habilitado; no debe existir en ningún despliegue.
- Q: ¿Cómo se determina la identidad de una corrida? → A: Por defecto se crea una identidad sintética
  nueva; si la instrucción incluye una identidad, se usa exactamente la indicada.
- Q: ¿Cómo se determina el tenant de una corrida? → A: La instrucción debe seleccionar explícitamente
  el tenant.
- Q: Cuando la instrucción incluye una identidad, ¿qué identidades puede seleccionar? → A: Solo una
  identidad creada previamente por headless dentro del tenant seleccionado.
- Q: ¿Cómo debe elegir la instrucción el comportamiento de IA en una ejecución headless? → A: Por
  defecto usa la IA configurada del tenant; los tests pueden inyectar explícitamente un `test_double`
  inline, sin catálogo persistente.
- Q: ¿Qué debe ocurrir con los mensajes que actualmente resuelve el router mediante bypass
  determinísticos? → A: Todo texto procesable por automatización debe interpretarse mediante el modelo
  IA en el flujo compartido; el modelo selecciona operaciones de un catálogo provider-neutral, como el
  plan estructurado que hoy edita campos y estado del pedido, y el backend valida y ejecuta cualquier
  acción.
- Q: ¿A qué ambiente de datos puede conectarse la CLI local headless? → A: Exclusivamente al stack
  Supabase local definido por `supabase/config.toml`; ya no se autoriza `staging` ni ningún proyecto
  remoto.
- Q: ¿Cómo se demuestra que la ejecución usa el entorno correcto? → A: Toda ejecución headless debe
  cargar un archivo de ambiente dedicado, ignorado por Git, cuyas URLs deben ser locales y coincidir con
  los puertos del stack Supabase del repositorio; si falta o apunta a red remota, se rechaza antes de
  leer journal o datos.
- Q: ¿Qué constituye un caller y tenant autorizados? → A: Cualquier proceso local que supere los gates
  explícitos puede seleccionar cualquier tenant registrado en la base local y usar las credenciales
  locales con acceso total a esa base; la instrucción no puede suministrar un schema arbitrario.
- Q: ¿Qué ocurre con texto recibido mientras una conversación está en modo manual? → A: El inbound se
  conserva, pero no se envía a IA ni recibe respuesta automática. Al desactivar modo manual, si el
  último mensaje de la conversación es del cliente y sigue sin procesamiento automático, se procesa
  exactamente una vez mediante IA antes de esperar otro mensaje.
- Q: ¿Qué salidas debe capturar el modo headless? → A: Captura las respuestas y efectos emitidos dentro
  del turno headless. Acciones posteriores no relacionadas del dashboard, cron o campañas quedan fuera;
  la respuesta directa al reactivar un inbound de origen headless es la única excepción y se persiste
  como `captured` para una inspección posterior, sin alterar el resultado durable del turno original.
- Q: ¿Qué ocurre si el proceso falla cuando pudieron aplicarse efectos pero no se guardó el resultado?
  → A: El turno queda `indeterminate`, se bloquea el reintento automático y se exige inspección y
  reconciliación antes de continuar.
- Q: ¿Debe enmendarse la constitución para permitir que mensajes recibidos durante pausa manual no
  pasen por IA hasta reactivar? → A: Sí; la excepción queda explícita en la constitución y termina
  cuando el último inbound pendiente vuelve al flujo IA al reactivar.
- Q: ¿Cómo se clasifican los inbound históricos que ya estaban `logged` antes de introducir el claim?
  → A: La migración los marca `processed`; la nueva semántica de pendientes comienza después de ese
  corte y no intenta inferir ni reprocesar mensajes históricos.
- Q: ¿Qué ocurre con los inbound anteriores cuando llegan varios mensajes durante una pausa manual?
  → A: Se marcan `superseded`; únicamente el último inbound elegible permanece pendiente y puede ser
  reclamado al reactivar.
- Q: ¿Cómo se recupera un turno `indeterminate` después de un crash posterior al claim? → A: Mediante
  una operación explícita `reconcile`; el operador declara si observó efectos y el backend valida la
  transición antes de desbloquear o mantener bloqueada la sesión.
- Q: ¿Dónde queda la respuesta si el dashboard reactiva una conversación cuyo último inbound provino de
  headless? → A: Se persiste como outbound `captured`, nunca se envía a Meta y queda visible mediante
  `inspect`; no modifica retroactivamente el resultado durable del turno que recibió el inbound.
- Q: ¿Qué evidencia permite reconciliar con seguridad después de un crash? → A: Antes de cualquier
  mutación se persiste un manifiesto sanitizado del plan ya validado, con precondiciones, efectos
  esperados, claves idempotentes y huellas de postcondición. La reconciliación nunca vuelve a invocar IA
  y solo resuelve cuando el estado autoritativo demuestra aplicación completa o ausencia total de
  efectos; cualquier resultado parcial permanece `indeterminate`.
- Q: ¿Cómo se preservan paridad de respuesta y privacidad cuando el texto al cliente contiene dirección
  o billing? → A: La persistencia tenant-local conserva la respuesta completa que habría recibido el
  cliente para validar paridad; stdout, stderr, journal e `inspect` exponen únicamente una proyección
  redactada que informa si hubo redacción y sus códigos, sin modificar la captura autoritativa.

## Scope *(mandatory)*

### In Scope

- Iniciar una sesión headless únicamente mediante una CLI ejecutada localmente con debug habilitado,
  archivo de ambiente headless dedicado y Supabase local verificado, para el tenant seleccionado
  explícitamente entre los registrados en la base local.
- Enviar uno o varios turnos de texto normalizado dentro de la misma sesión.
- Reanudar una sesión identificada y observar su estado vigente sin depender de memoria del proceso
  de consola.
- Ejecutar el mismo flujo compartido que WhatsApp usa después de normalizar el transporte: resolución
  de identidad de prueba, conversación, persistencia inbound, interpretación IA de todo texto
  procesable por automatización,
  usuario, selección de herramientas controladas según el estado, validaciones backend, persistencia,
  transiciones, eventos, alertas y composición de respuestas.
- Capturar las respuestas que el flujo habría enviado y devolverlas al llamador sin realizar ninguna
  solicitud a Meta. La captura pertenece al turno headless cuando se emite dentro de él; si el dashboard
  reactiva posteriormente un inbound headless pendiente, su respuesta se persiste como captura separada
  y queda visible mediante `inspect`, sin reescribir el resultado del turno original.
- Devolver un resultado estructurado por turno con identificadores seguros de correlación, respuesta
  compuesta, estados antes/después, resumen de efectos, decisión de routing/IA sanitizada y fallos o
  advertencias observables.
- Preservar aislamiento lógico entre tenants, sesiones e identidades sintéticas dentro de la base
  local, incluida la concurrencia y los reintentos, aunque las credenciales locales tengan acceso total.
- Conservar el ciclo de vida conversacional vigente: reutilización de conversación activa,
  extensión de expiración por turno, expiración a los 30 minutos, estados terminales y pausa manual.
- Reprocesar exactamente una vez el último inbound pendiente cuando se desactive el modo manual y el
  último mensaje de la conversación siga siendo del cliente.
- Permitir que un operador backend autorizado reconcilie un procesamiento compartido `indeterminate`
  mediante el mismo caso de uso usado por la CLI local, sin desplegar la interfaz headless ni depender de
  acceso SQL manual.
- Probar paridad con WhatsApp en el límite post-normalización usando condiciones y dependencias
  controladas para que la comparación sea reproducible.
- Documentar el modo de uso, límites de seguridad, datos de prueba requeridos y procedimiento de
  limpieza o retención que resulte aprobado.

### Out of Scope

- Cambiar el catálogo, checkout, billing, pagos, órdenes, cobertura, handoff o reglas de transición
  existentes, salvo sustituir los bypass textuales deterministas por interpretación IA y herramientas
  controladas equivalentes dentro del flujo compartido.
- Crear un router, state machine, conjunto de prompts, catálogo, repositorio o persistencia alternos
  para pruebas.
- Enviar mensajes, estados, plantillas, medios o cualquier otro tráfico a Meta.
- Simular el webhook crudo, su firma/verificación, recepción de estados de Meta o idempotencia propia
  del evento crudo. La paridad comienza con un turno de texto ya normalizado.
- Soportar inicialmente audio, imagen, documento, comprobante, ubicación, botones o respuestas
  interactivas. Su normalización y efectos de transporte siguen cubriéndose por pruebas del canal.
- Automatizar acciones humanas del dashboard, aprobación del restaurante, revisión de comprobantes o
  progreso de cocina desde la misma interfaz headless. La operación backend de reconciliación de un
  procesamiento `indeterminate` no constituye automatización de esas acciones ni exige una UI nueva.
- Exponer secretos, prompts completos, payloads crudos de proveedores, credenciales, direcciones,
  billing, teléfonos reales o datos de otros tenants en el resultado estructurado.
- Definir en esta fase la estructura final de archivos, protocolo de invocación, endpoint, comando,
  adaptadores o cambios de esquema. Esas decisiones pertenecen al plan técnico.
- Incluir o habilitar la interfaz headless en cualquier despliegue, incluidos preview, staging y
  producción, o conectarla desde local a cualquier Supabase remoto.
- Capturar, interceptar o modificar notificaciones posteriores iniciadas por acciones humanas del
  dashboard, cron, campañas u otros procesos fuera del turno headless, salvo la respuesta directa del
  caso de uso compartido al reactivar un inbound de origen headless, que debe capturarse para impedir
  tráfico a Meta.
- Permitir consultas SQL arbitrarias desde la instrucción headless; el acceso total de las credenciales
  locales no amplía el contrato conversacional controlado.

### Dependencies

- El stack Supabase local del repositorio iniciado y saludable, con migraciones/seed aplicados y al
  menos un tenant registrado con catálogo/configuración suficientes para el escenario.
- La configuración `[api].schemas` del stack local incluye `control`, `tenant_template` y todos los
  schemas registrados en `control.tenants`; el procedimiento local los sincroniza y reinicia PostgREST
  cuando se añade un tenant.
- Un archivo de ambiente headless dedicado, ignorado por Git, con `APP_ENV=local`, debug habilitado,
  URLs loopback que coincidan con `supabase/config.toml` y credenciales del stack local.
- Acceso desde la máquina local a los servicios externos requeridos por el flujo, como IA o
  geocodificación cuando el turno lo necesite; Supabase no es remoto.
- Configuración tenant-aware de proveedor IA y fallback para la ejecución predeterminada; los tests
  pueden inyectar únicamente dobles inline controlados.
- Las reglas vigentes de conversación, draft, órdenes, cobertura, billing, pagos, alertas y
  observabilidad.
- Credenciales backend del stack Supabase local con acceso total a su base; no se imprimen, no se
  aceptan dentro del comando y no se incorporan a artefactos desplegados.

## Paridad con WhatsApp

La unidad de paridad es el procesamiento de un mensaje de texto después de la normalización de
transporte. Dados el mismo tenant, identidad lógica, estado persistido, texto normalizado, configuración,
reloj y resultados controlados de dependencias externas, ambos canales deben producir:

- la misma interpretación IA obligatoria y la misma selección de herramientas controladas disponibles
  para el estado evaluado;
- las mismas acciones aceptadas o rechazadas y las mismas validaciones de IDs, evidencia y estado;
- la misma respuesta de negocio compuesta, en el mismo orden cuando haya más de una;
- el mismo estado final de conversación, draft y orden;
- los mismos eventos, alertas y mutaciones internas relevantes;
- la misma conducta frente a baja confianza, salida inválida, concurrencia o dependencia no
  disponible.

Las únicas diferencias aceptadas son las propias del transporte: identificadores de entrega,
acknowledgements, payload crudo, estado de envío y metadata exclusiva de Meta. La salida headless debe
registrar que fue capturada y no entregada; no puede simular un identificador de Meta ni declarar que
Meta aceptó el mensaje.

La paridad no significa exigir texto idéntico entre dos invocaciones independientes de un modelo no
determinista. La prueba reproducible debe controlar el resultado del proveedor; la ejecución con IA
real demuestra que ambos canales comparten la misma ruta, configuración y validaciones.

La ejecución headless usa por defecto la configuración IA vigente del tenant seleccionado. Una prueba
determinista puede inyectar explícitamente un `test_double` definido dentro del propio test para
sustituir solo el resultado crudo del proveedor; ese resultado recorre el mismo contrato estructurado,
validaciones, acciones y manejo de fallos que una respuesta real. No existe un catálogo persistente ni
fixtures fijos seleccionables por CLI, stdin, ambiente o archivo. El `test_double` no puede seleccionar
un router alterno ni modificar la configuración persistida del tenant.

## Seguridad, entorno y aislamiento tenant

- La instrucción debe seleccionar un tenant. El caller no puede seleccionar un schema arbitrario ni
  derivarlo de texto libre; el tenant indicado debe resolverse contra `control.tenants` de la base
  local. Cualquier tenant registrado localmente es elegible, sin depender de su estado operativo.
- La interfaz headless solo puede existir y ejecutarse como proceso local cuando debug está habilitado.
  Debe cargar exclusivamente el archivo de ambiente headless dedicado, comprobar `APP_ENV=local` y
  verificar que toda URL Supabase sea loopback y coincida con los puertos declarados en
  `supabase/config.toml`. Antes de admitir un tenant también verifica que su schema registrado esté
  expuesto por el PostgREST local. Debe fallar cerrado ante otro archivo o destino y no formar parte de
  ningún despliegue.
- Cuando la instrucción no incluye una identidad, cada corrida crea una identidad sintética nueva no
  confundible con un cliente real. Cuando incluye una identidad, el sistema solo acepta una identidad
  creada previamente por headless dentro del tenant seleccionado; nunca adopta una identidad o
  conversación originada por WhatsApp.
- Durante un comando, todo acceso y toda mutación conversacional permanecen dentro del schema del
  tenant seleccionado, aunque las credenciales del stack local tengan acceso total. Un identificador de
  sesión, conversación, draft u orden de otro tenant debe rechazarse sin revelar si existe.
- El resultado estructurado aplica mínimo privilegio: incluye únicamente datos necesarios para
  entender el turno y redacta PII, secretos, cuerpos externos y contexto interno no aprobado.
- Los intentos exitosos y rechazados son auditables mediante correlación segura, ambiente, tenant,
  sesión y resultado, sin registrar el texto del cliente fuera de la transcripción de prueba
  autorizada.
- El modo headless debe fallar cerrado si no puede demostrar que el ambiente, tenant e identidad
  cumplen las restricciones aprobadas.
- Las credenciales de Meta no son requisito para usar el modo headless y su presencia accidental no
  puede habilitar envíos.
- Las credenciales backend de Supabase local pertenecen al archivo de ambiente dedicado del operador;
  nunca se imprimen, persisten en el journal ni se aceptan dentro del comando.

## Ciclo de vida de sesión

1. El caller inicia una sesión en ambiente local con debug habilitado, selecciona explícitamente el
   tenant y recibe un identificador opaco de sesión y el snapshot inicial permitido. Si no indica una
   identidad se crea una nueva; si la indica se usa el valor suministrado únicamente cuando corresponde
   a una identidad creada previamente por headless dentro del mismo tenant.
2. Cada turno aceptado se asocia de forma idempotente a esa sesión e identidad sintética, persiste el
   inbound y procesa exactamente una vez sus efectos de negocio.
3. La sesión puede continuarse desde otro proceso de consola usando su identificador; el estado
   autoritativo se recarga desde persistencia antes de cada turno.
4. Un turno dentro de una conversación activa extiende su vencimiento igual que WhatsApp. Tras 30
   minutos de inactividad, la conversación anterior se marca vencida y el siguiente turno crea una
   nueva conversación según las reglas vigentes.
5. Mientras una conversación está en `manual`, sus mensajes inbound se persisten pero no se envían a
   IA ni generan respuesta automática. Si llegan varios, cada inbound anterior se marca `superseded` y
   únicamente el último queda pendiente. Al desactivar manual, si el último mensaje es inbound del
   cliente y no tiene constancia de procesamiento automático, el mismo caso de uso lo reclama y procesa
   exactamente una vez mediante IA. Si ese inbound se originó en headless, cualquier respuesta se
   persiste con entrega `captured`, queda visible en `inspect` y no modifica el resultado durable del
   turno original. Una conversación `completed` o `expired` no se reactiva como si siguiera abierta.
6. Finalizar el cliente de consola no elimina ni revierte datos. La forma aprobada de cerrar, retener o
   limpiar sesiones debe preservar evidencia y evitar contaminación entre ejecuciones.
7. Dos turnos concurrentes sobre la misma sesión no pueden aplicar silenciosamente efectos
   incompatibles; uno debe serializarse o rechazarse de forma observable sin corrupción ni duplicados.
8. Si el proceso muere cuando pudieron aplicarse efectos pero no alcanzó a guardar el resultado, el
   turno queda `indeterminate`; no puede reintentarse automáticamente y requiere `inspect` y una
   operación explícita `reconcile` antes de continuar esa sesión. El operador declara si observó
   efectos, pero el backend contrasta la declaración con el manifiesto durable escrito antes de mutar y
   con el estado autoritativo. Solo cierra como aplicado cuando demuestra todos los efectos esperados o
   como fallido cuando demuestra que ninguno ocurrió; ante evidencia parcial, contradictoria o
   insuficiente conserva el bloqueo.

## Fallos de IA y servicios

- Una respuesta de IA que no cumple el contrato estructurado sigue el fallback de proveedor vigente.
  Si ningún proveedor entrega un plan válido, el pedido no cambia, el fallo es observable, se intenta
  crear evento/alerta y se captura la misma respuesta segura que recibiría WhatsApp.
- Un plan vacío o bajo el umbral vigente solicita aclaración; los intentos de aclaración y el handoff
  posterior siguen el contador persistido actual.
- Una acción no permitida, sin evidencia, con IDs inexistentes, ambigua u obsoleta conserva el estado
  anterior y produce la aclaración o handoff correspondiente.
- Una indisponibilidad de persistencia impide reportar éxito. El resultado distingue entre turno no
  aceptado, efecto rechazado de forma segura, respuesta capturada con advertencias y fallo no
  recuperado.
- Una indisponibilidad de Meta nunca afecta el modo headless porque Meta no participa. Cualquier
  intento de red hacia Meta constituye un fallo de seguridad y de paridad del feature.
- Un servicio auxiliar no disponible conserva las mismas reglas del flujo compartido: no inventa
  cobertura, disponibilidad, precio, identidad ni transición, y comunica un resultado seguro y
  observable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ejecutar una conversación multiturno real (Priority: P1)

Un agente inicia una sesión aislada, envía mensajes naturales sucesivos y observa cómo el sistema
construye y confirma un pedido con el mismo comportamiento post-normalización de WhatsApp.

**Why this priority**: Es el valor principal del feature y permite validar el producto sin tráfico a
clientes ni dependencia del transporte Meta.

**Independent Test**: Con un tenant de prueba y resultados IA controlados, ejecutar desde una sesión
nueva una conversación que agrega productos, completa fulfillment, billing y pago, confirma el resumen
y crea una sola orden.

**Acceptance Scenarios**:

1. **Given** un ambiente y tenant autorizados con catálogo publicado, **When** el agente inicia una
   sesión y envía varios turnos válidos, **Then** cada turno devuelve respuesta estructurada, conserva
   la misma identidad lógica y avanza conversación/draft igual que el flujo compartido.
2. **Given** un draft listo en `awaiting_confirmation`, **When** el agente confirma de forma válida,
   **Then** se crea una sola orden, la conversación pasa al estado vigente de revisión y el resultado
   reporta los efectos sin incluir datos sensibles.
3. **Given** la sesión anterior, **When** otro proceso autorizado continúa usando su identificador,
   **Then** recupera el estado persistido y no inicia una conversación paralela.
4. **Given** cualquier turno headless exitoso, **When** se inspecciona la red y los registros,
   **Then** no existe solicitud a Meta ni identificador de mensaje atribuido a Meta.
5. **Given** una conversación en `manual` cuyo último mensaje persistido es un inbound del cliente aún
   no procesado, **When** un operador reactiva la automatización, **Then** el mensaje no fue enviado a
   IA durante la pausa y ahora se reclama y procesa exactamente una vez mediante el flujo compartido;
   si su origen fue headless, la respuesta queda `captured`, visible por `inspect` y no altera el
   resultado durable anterior.

---

### User Story 2 - Observar decisiones y transiciones de forma segura (Priority: P1)

Un agente necesita determinar qué ocurrió en cada turno sin leer directamente tablas ni exponer
payloads internos peligrosos.

**Why this priority**: Una consola que solo imprima el texto del asistente no permite depurar paridad,
acciones controladas ni transiciones.

**Independent Test**: Ejecutar turnos que cubran una intención antes determinista mediante IA y
herramientas controladas, una intención semántica, una aclaración y un handoff; comprobar que el
contrato distingue sus resultados con campos estables y sanitizados.

**Acceptance Scenarios**:

1. **Given** un turno procesado, **When** el agente recibe el resultado, **Then** puede identificar
   sesión, turno, correlación, estado anterior/posterior, respuestas capturadas, fuente/reason de
   routing, resultado IA sanitizado, efectos y advertencias.
2. **Given** un resultado que involucró dirección, billing, proveedor IA o error externo, **When** se
   serializa o registra, **Then** no contiene secretos, credenciales, prompt completo, payload crudo,
   teléfono real ni PII no necesaria.
3. **Given** una respuesta compuesta sin mutación, **When** se devuelve al agente, **Then** se distingue
   de un turno que falló antes de ser aceptado y de un turno con mutaciones aplicadas.

---

### User Story 3 - Verificar paridad reproducible (Priority: P1)

Un desarrollador compara el resultado del canal WhatsApp y el headless a partir del mismo límite
normalizado y con dependencias controladas.

**Why this priority**: Evita que el modo de prueba se convierta en una implementación alternativa que
pasa pruebas mientras el canal real se comporta distinto.

**Independent Test**: Alimentar ambos caminos con el mismo mensaje normalizado, snapshot inicial,
reloj y fixtures de IA/servicios, y comparar respuestas, transiciones, mutaciones, eventos y alertas
salvo metadata exclusiva de transporte.

**Acceptance Scenarios**:

1. **Given** condiciones iniciales equivalentes y dependencias deterministas, **When** WhatsApp y
   headless procesan el mismo turno textual, **Then** los resultados de negocio son equivalentes según
   el contrato de paridad.
2. **Given** una intención que antes resolvía un bypass determinista, **When** se prueba por ambos
   canales, **Then** ambos envían el texto al modelo y exponen el mismo conjunto de herramientas
   controladas correspondiente al estado.
3. **Given** una nueva rama conversacional agregada en el futuro, **When** se ejecutan las pruebas de
   paridad, **Then** falla si uno de los canales no utiliza el mismo caso de uso compartido.

---

### User Story 4 - Aislar sesiones, tenants y reintentos (Priority: P1)

Un operador puede ejecutar pruebas en paralelo sin mezclar clientes, conversaciones ni datos de otros
tenants.

**Why this priority**: El feature tendrá acceso total a la base local y capacidad de mutar pedidos y
órdenes; una fuga tenant o una colisión de identidad invalidaría la prueba.

**Independent Test**: Crear sesiones concurrentes en dos tenants autorizados, intentar cruzar sus
identificadores y repetir el mismo turno.

**Acceptance Scenarios**:

1. **Given** dos sesiones de tenants diferentes, **When** reciben turnos simultáneos, **Then** cada una
   solo lee y modifica su tenant.
2. **Given** un identificador válido de otro tenant, **When** un caller intenta usarlo, **Then** el
   sistema rechaza la operación sin revelar estado, cliente, draft u orden.
3. **Given** el mismo identificador idempotente de turno enviado dos veces, **When** ambos intentos se
   procesan, **Then** existe a lo sumo una aplicación de efectos y el segundo resultado informa que es
   repetido o devuelve el resultado correlacionado.
4. **Given** dos turnos distintos concurrentes sobre la misma sesión, **When** compiten por el mismo
   estado, **Then** no producen una combinación parcial y el conflicto es observable.

---

### User Story 5 - Manejar fallos sin corromper la conversación (Priority: P2)

Un agente puede inducir y observar fallos de IA o servicios y comprobar que el flujo conserva sus
invariantes.

**Why this priority**: El modo headless debe ser útil para probar recuperación y no únicamente caminos
felices.

**Independent Test**: Ejecutar fixtures de salida inválida, baja confianza, proveedores no
configurados, conflicto de concurrencia y persistencia no disponible.

**Acceptance Scenarios**:

1. **Given** una salida IA inválida en el proveedor principal y un fallback válido, **When** se procesa
   el turno, **Then** se usa el fallback vigente y el resultado informa los intentos sanitizados.
2. **Given** que ningún proveedor entrega un plan válido, **When** se procesa texto semántico,
   **Then** draft/orden no cambian, se producen los eventos/alertas vigentes cuando la persistencia lo
   permite y se captura una respuesta segura.
3. **Given** tres aclaraciones consecutivas no resueltas, **When** ocurre la tercera, **Then** la
   conversación pasa a `manual`, queda pausada y el resultado informa el handoff.
4. **Given** persistencia no disponible antes de aceptar el turno, **When** el agente lo envía,
   **Then** recibe un fallo estructurado y el sistema no declara respuesta ni mutación exitosas.
5. **Given** un procesamiento reclamado que termina `indeterminate`, **When** un operador autorizado lo
   reconcilia desde la CLI local o el backend compartido, **Then** ambos usan la misma validación, no
   invocan IA ni reejecutan acciones y solo desbloquean ante evidencia autoritativa concluyente.

### Edge Cases and Failure Behavior

- **EC-001**: Texto vacío o compuesto solo por espacios se rechaza como input inválido antes de crear
  efectos conversacionales.
- **EC-002**: Un texto que exceda el límite seguro aprobado se rechaza sin truncarlo silenciosamente
  ni enviarlo parcialmente a IA.
- **EC-003**: Debug deshabilitado, archivo de ambiente dedicado ausente/incorrecto, `APP_ENV` distinto
  de `local`, tenant omitido/inexistente, schema tenant no expuesto por el PostgREST local o URL
  Supabase no loopback/inconsistente con `supabase/config.toml` se rechazan antes de acceder a negocio.
- **EC-004**: Una sesión inexistente, cerrada, de otro ambiente o de otro tenant no se adopta ni se
  recrea silenciosamente bajo el caller.
- **EC-013**: Una identidad inexistente, de otro tenant, no creada por headless o asociada a una
  conversación originada por WhatsApp se rechaza sin revelar datos ni crear una identidad sustituta.
- **EC-005**: Si la conversación está en `manual` o la automatización del tenant/conversación está
  deshabilitada, el inbound se persiste pero no invoca IA ni responde. Cada nuevo inbound durante la
  pausa marca `superseded` al pendiente anterior. Cuando se desactiva manual, solo se reprocesa si el
  último mensaje es inbound del cliente y sigue pendiente; el claim compartido evita duplicarlo ante
  reintentos o concurrencia.
- **EC-006**: Si la conversación venció, el siguiente turno respeta la expiración de 30 minutos y no
  modifica el draft de la conversación anterior.
- **EC-007**: Un turno repetido después de un timeout del caller no duplica líneas, órdenes, alertas ni
  mensajes salientes capturados.
- **EC-008**: Un plan IA con operación no permitida, ID inventado, evidencia insuficiente o snapshot
  obsoleto no muta el estado y devuelve la aclaración segura vigente.
- **EC-009**: Una respuesta compuesta antes de un fallo al registrar el outbound se devuelve con una
  advertencia observable; no se presenta falsamente como registro completo.
- **EC-010**: Si cualquier camino intenta usar el cliente de Meta, el turno falla como violación de la
  garantía headless y deja evidencia segura para diagnóstico.
- **EC-011**: Una dirección escrita puede invocar geocodificación/cobertura real del ambiente de
  prueba; su indisponibilidad no se sustituye por cobertura inventada.
- **EC-012**: La aleatoriedad de IDs, el reloj y proveedores no deterministas se controlan en pruebas
  de paridad; en ejecución real se informan como contexto de correlación y no como garantía de texto
  idéntico entre corridas.
- **EC-014**: Un `test_double` ausente, desconocido o malformado se rechaza o se procesa como salida
  inválida según corresponda; nunca activa silenciosamente una llamada al proveedor real ni evita las
  validaciones del flujo compartido.
- **EC-015**: Si cualquier URL Supabase del archivo dedicado no es loopback o no coincide con los
  puertos locales configurados, la CLI falla antes de resolver tenant, identidad o sesión, incluso
  cuando las credenciales sean válidas para ese destino.
- **EC-016**: Un crash después de un efecto potencial y antes de persistir el resultado local deja el
  turno `indeterminate`; un retry automático se rechaza hasta completar `inspect` y `reconcile`. Una
  declaración del operador que no coincida con el manifiesto previo y el estado autoritativo se rechaza
  y mantiene el bloqueo. Una aplicación parcial nunca se clasifica como `applied` ni `failed`.
- **EC-017**: Una notificación no relacionada iniciada después del turno por dashboard, cron o campaña
  no forma parte de la captura headless y no puede atribuirse al resultado de ese turno. La respuesta
  directa al reprocesar un inbound headless durante reactivación manual sí se persiste como `captured`
  separada y queda visible mediante `inspect`, pero tampoco se incorpora retroactivamente al resultado.
- **EC-018**: Durante la migración que introduce el claim, todo inbound preexistente con `status=logged`
  se marca `processed` antes de activar la nueva semántica; ningún mensaje histórico se considera
  pendiente ni se reprocesa por inferencia.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir a un caller autorizado iniciar una sesión headless únicamente
  desde una CLI local con debug habilitado y archivo de ambiente headless dedicado, seleccionando
  explícitamente exactamente un tenant registrado en el Supabase local del repositorio. El setup local
  DEBE mantener expuestos en PostgREST todos los schemas registrados para que cualquiera sea elegible.
- **FR-002**: El sistema DEBE permitir enviar turnos de texto consecutivos a una sesión y recargar el
  estado autoritativo persistido antes de procesar cada turno.
- **FR-003**: Cada turno DEBE atravesar el mismo caso de uso compartido que WhatsApp utiliza después de
  normalizar el transporte; ningún comportamiento conversacional PUEDE implementarse en un router,
  state machine o conjunto de reglas alterno.
- **FR-004**: El modo headless DEBE ejecutar las mismas lecturas, interpretación IA, operaciones
  permitidas, validaciones, cálculos, mutaciones, transiciones, eventos, alertas y composición de
  respuesta que el canal WhatsApp bajo condiciones equivalentes.
- **FR-005**: Fuera de una pausa manual o automatización deshabilitada, el flujo compartido de WhatsApp
  y headless DEBE enviar todo texto del usuario al modelo IA y exponerle únicamente herramientas
  controladas válidas para el estado actual. Esas herramientas DEBEN formar un catálogo
  provider-neutral de operaciones estructuradas, equivalente al mecanismo actual que propone cambios
  de campos/estado del pedido; el modelo solo PUEDE seleccionarlas y el backend DEBE validar evidencia,
  calcular hechos autoritativos, ejecutar la acción y aplicar la transición.
- **FR-006**: El modo headless NO DEBE realizar solicitudes a Meta bajo ninguna configuración,
  incluida la presencia de credenciales válidas.
- **FR-007**: Toda respuesta emitida dentro del turno headless que el flujo habría enviado por WhatsApp
  DEBE capturarse completa en la persistencia tenant-local con semántica veraz de salida headless. El
  resultado al caller DEBE devolver en orden una proyección segura de esas respuestas, indicando de
  forma estructurada si fue redactada y por qué;
  notificaciones posteriores no relacionadas de dashboard, cron o campañas quedan fuera. Si el
  dashboard procesa al reactivar un inbound cuyo origen persistido es headless, su respuesta DEBE usar
  captura headless, persistirse como outbound `captured` y aparecer en una inspección posterior, sin
  modificar el resultado durable del turno original.
- **FR-008**: La captura headless NO DEBE crear ni simular identificadores, acknowledgements o estados
  de entrega de Meta.
- **FR-009**: Cada turno DEBE aceptar un identificador idempotente controlado por el caller y aplicar
  sus efectos como máximo una vez, incluso si el caller reintenta tras un timeout. Si no puede
  demostrarse si hubo efectos, el turno DEBE quedar `indeterminate`, bloquear reintentos automáticos y
  exigir `inspect` y una operación explícita `reconcile`. La reconciliación DEBE recibir la observación
  del operador y validarla contra un manifiesto durable, sanitizado y persistido antes de cualquier
  mutación, además del estado autoritativo. El manifiesto DEBE identificar precondiciones, efectos
  esperados, claves idempotentes y huellas verificables sin incluir texto libre, PII ni secretos. La
  reconciliación NO DEBE invocar IA ni reejecutar acciones y DEBE mantener el bloqueo ante aplicación
  parcial o cuando no pueda demostrar una resolución segura. La misma validación DEBE estar disponible
  para la CLI local y para un caller backend autorizado del flujo compartido.
- **FR-010**: El resultado de cada turno DEBE distinguir al menos: aceptación/rechazo, sesión y turno,
  correlación, estado anterior/posterior, respuestas capturadas, fuente y razón de routing, resultado
  IA sanitizado, efectos de negocio observables, alertas/handoff, advertencias y error seguro. Cada
  respuesta proyectada DEBE indicar `redacted` y códigos de redacción estables.
- **FR-011**: El resultado DEBE describir efectos mediante identificadores opacos y resúmenes seguros;
  NO DEBE exponer prompts completos, payloads crudos, secretos, tokens, URLs firmadas, teléfonos reales,
  direcciones, billing ni datos no autorizados de clientes. Esta restricción aplica a stdout, stderr,
  journal, logs e `inspect`; no obliga a alterar el mensaje completo guardado dentro del tenant como
  evidencia autoritativa de lo que el canal habría entregado.
- **FR-012**: La sesión DEBE conservar la política vigente de conversación activa, renovación de
  expiración por turno y vencimiento tras 30 minutos de inactividad.
- **FR-013**: Una conversación `manual` NO DEBE enviar sus inbound a IA ni responder automáticamente.
  Si recibe varios, cada inbound anterior DEBE quedar `superseded` y solo el último permanecer
  pendiente. Cuando un operador desactive manual, si el último mensaje persistido es inbound del cliente
  y sigue sin procesamiento automático, el sistema DEBE procesarlo exactamente una vez mediante el caso
  de uso e IA compartidos. Una conversación `completed` o `expired` NO DEBE reactivarse por conveniencia.
- **FR-014**: Un turno que cause confirmación válida DEBE crear como máximo una orden y conservar el
  estado de revisión operativa vigente.
- **FR-015**: Una salida IA inválida o baja en confianza DEBE seguir el fallback, aclaración, contador
  y handoff existentes, sin mutar el pedido cuando ninguna acción sea válida.
- **FR-016**: Un fallo de proveedor IA, persistencia, catálogo, cobertura u otro servicio DEBE producir
  el mismo resultado seguro del flujo compartido y un estado estructurado que no confunda fallo con
  éxito.
- **FR-017**: La interfaz DEBE permitir inspeccionar el estado actual permitido de una sesión sin
  modificar la conversación ni invocar IA o servicios de negocio innecesarios.
- **FR-018**: La interfaz DEBE permitir terminar el uso interactivo de una sesión sin borrar
  silenciosamente su historial, draft, orden, eventos o alertas.
- **FR-019**: La primera versión DEBE aceptar únicamente texto y DEBE rechazar de forma explícita
  intentos de audio, imagen, documento, comprobante, ubicación o interacción estructurada.
- **FR-020**: Las pruebas de paridad DEBEN comparar ambos canales desde el mensaje normalizado con el
  mismo estado inicial, reloj y resultados de dependencias, excluyendo solo metadata propia del
  transporte.
- **FR-021**: La interfaz headless DEBE existir y ejecutarse exclusivamente como CLI local cuando debug
  esté habilitado; DEBE cargar un archivo de ambiente dedicado, exigir `APP_ENV=local`, aceptar solo
  endpoints loopback que coincidan con `supabase/config.toml`, rechazar todo Supabase remoto y NO DEBE
  incluirse ni habilitarse en ningún despliegue, incluidos preview, staging y producción.
- **FR-022**: Al iniciar una corrida sin identidad, el sistema DEBE crear una identidad sintética nueva.
  Si la instrucción suministra una identidad, el sistema DEBE usar ese valor en lugar de generar otro,
  solo después de verificar que fue creado previamente por headless dentro del tenant seleccionado.
- **FR-023**: La ejecución headless DEBE usar por defecto la configuración IA real del tenant
  seleccionado. Un test PUEDE inyectar explícitamente un `test_double` inline que sustituya solo la
  respuesta cruda del proveedor; el doble DEBE atravesar el mismo contrato, validaciones, acciones y
  manejo de fallos, y NO DEBE modificar la configuración persistida ni activar un router alterno.
- **FR-024**: El sistema DEBE rechazar cualquier identidad suministrada que no haya sido creada
  previamente por headless dentro del tenant seleccionado. En particular, NO DEBE adoptar identidades
  ni conversaciones originadas por WhatsApp.

### Non-Functional Requirements

- **NFR-001**: El sistema DEBE comprobar ejecución mediante CLI local, debug habilitado, archivo de
  ambiente dedicado, `APP_ENV=local`, endpoints Supabase loopback coincidentes con
  `supabase/config.toml`, schema tenant presente en `[api].schemas` y tenant seleccionado antes de
  resolver cualquier sesión, cliente o conversación, y fallar cerrado ante datos inconsistentes.
- **NFR-002**: Cien por ciento de las pruebas de cruce de tenant definidas en US4 DEBEN ser rechazadas
  sin lectura ni mutación observable fuera del tenant autorizado.
- **NFR-003**: Cien por ciento de las ejecuciones headless, exitosas o fallidas, DEBEN producir cero
  solicitudes de red a dominios de Meta.
- **NFR-004**: Cien por ciento de los campos estructurados y logs añadidos por el feature DEBEN pasar
  pruebas de sanitización para secretos, PII y payloads externos no aprobados.
- **NFR-005**: La correlación de sesión/turno DEBE permitir reconstruir el resultado de una ejecución
  sin depender de texto libre en logs ni revelar el contenido del cliente fuera de la transcripción
  autorizada.
- **NFR-006**: El contrato estructurado DEBE permanecer estable y versionado de forma que un agente
  pueda distinguir una respuesta compatible de una incompatible sin analizar texto humano.
- **NFR-007**: Bajo dependencias controladas, una suite de al menos diez escenarios representativos
  DEBE demostrar equivalencia post-normalización entre WhatsApp y headless para caminos felices,
  límites y fallos.
- **NFR-008**: Los turnos concurrentes o repetidos DEBEN terminar sin mutaciones parciales y con un
  resultado inequívoco de aplicado, repetido, rechazado, fallido o `indeterminate`; este último bloquea
  replay automático hasta reconciliación.
- **NFR-009**: La documentación DEBE permitir a un agente autorizado iniciar, continuar, inspeccionar
  y cerrar una sesión de prueba sin conocer detalles internos de tablas ni usar credenciales de Meta.

### Key Entities *(include when data is involved)*

- **Sesión headless**: Contexto autorizado y opaco que vincula la CLI/journal locales, la instancia
  Supabase local verificada, el tenant seleccionado, la identidad efectiva y la conversación activa.
  Puede abarcar más de una conversación a lo largo del vencimiento o finalización, pero nunca más de una
  instancia local o tenant.
- **Identidad efectiva**: Actor usado por la corrida. Es una identidad sintética nueva cuando la
  instrucción no aporta valor, o una identidad headless preexistente del mismo tenant cuando sí lo
  hace. Nunca representa un cliente o conversación originados por WhatsApp. Posee el mínimo contexto
  necesario para que el flujo compartido ejerza persistencia y reutilización.
- **Turno headless**: Solicitud textual idempotente dentro de una sesión, con correlación, orden lógico,
  resultado y estado de procesamiento.
- **Resultado de turno**: Representación estructurada y sanitizada de respuestas capturadas,
  transiciones, efectos, routing/IA, alertas, advertencias y errores.
- **Snapshot de estado**: Vista permitida de conversación, draft y orden antes o después del turno;
  excluye PII y detalles internos no necesarios.
- **Respuesta capturada**: Mensaje compuesto por el flujo compartido que en WhatsApp se intentaría
  entregar por Meta, pero en headless solo se registra y devuelve con semántica explícita de no envío.
- **Escenario de paridad**: Estado inicial, turno normalizado, reloj y resultados controlados de
  dependencias usados para comparar ambos caminos.

## Verification Traceability *(mandatory)*

| Requirement | Acceptance scenarios | Required evidence |
| --- | --- | --- |
| FR-001, FR-002, FR-012, FR-013 | US1.1, US1.3, US1.5, EC-004–EC-006 | Pruebas de comportamiento multiturno, reanudación, expiración, terminales, pausa sin IA y procesamiento único al salir de manual |
| FR-003, FR-004, FR-005, FR-020 | US3.1–US3.3 | Pruebas de integración/paridad sobre el mismo límite normalizado; una prueba de estructura compartida solo como evidencia complementaria |
| FR-006, FR-007, FR-008 | US1.4, EC-009, EC-010 | Pruebas de integración con red a Meta bloqueada/espía, captura ordenada y persistencia veraz |
| FR-009, FR-014 | US1.2, US4.3, EC-007 | Pruebas de reintento antes/después de timeout y confirmación única de orden |
| FR-010, FR-011, FR-017 | US2.1–US2.3 | Pruebas de contrato estructurado, inspección sin efectos y snapshots sanitizados |
| FR-015, FR-016 | US5.1–US5.4, EC-008, EC-011 | Integración con dobles inline de IA inválida/baja confianza, fallback, servicios caídos y conservación de estado |
| FR-018 | US1.3, EC-004 | Prueba de cierre del cliente y posterior reanudación/auditoría sin pérdida de datos |
| FR-019 | EC-001, EC-002 | Pruebas de validación de entrada vacía, sobredimensionada y tipos no soportados |
| FR-021 | US1.4, EC-003, EC-010 | Pruebas que demuestran disponibilidad exclusiva en local/debug y ausencia en artefactos desplegados |
| FR-022, FR-024 | US1.1, US1.3, US4.1, EC-013 | Pruebas de identidad nueva/preexistente, pertenencia tenant y rechazo de identidades no headless |
| FR-023 | US3.1, US5.1, EC-014 | Pruebas del modo real predeterminado, `test_double` inline y rechazo/fallo seguro de dobles inválidos |
| NFR-001, NFR-002 | US4.1–US4.2, EC-003–EC-004 | Suite de autorización y aislamiento entre al menos dos tenants |
| NFR-003 | US1.4, EC-010 | Aserción global de cero solicitudes a Meta en toda la suite headless |
| NFR-004, NFR-005, NFR-006 | US2.1–US2.3 | Pruebas de sanitización, correlación y compatibilidad/versionado del contrato |
| NFR-007, NFR-008 | US3, US4.3–US4.4 | Matriz de al menos diez escenarios y pruebas de concurrencia/reintento |
| NFR-009 | US1, US2 | Quickstart ejecutado por un agente contra un tenant de prueba limpio |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un agente autorizado completa una conversación de pedido de al menos ocho turnos,
  incluida confirmación, usando solo la interfaz headless y sin tráfico a Meta.
- **SC-002**: En al menos diez escenarios controlados de paridad, el 100% de capturas internas completas,
  estados, mutaciones, eventos y alertas coinciden entre WhatsApp post-normalización y headless,
  excluyendo únicamente metadata de transporte documentada; la proyección pública redactada se valida
  separadamente contra el contrato de seguridad.
- **SC-003**: Repetir cualquiera de los turnos idempotentes de la suite no crea órdenes, líneas,
  mensajes capturados ni alertas adicionales.
- **SC-004**: El 100% de intentos de usar una sesión o entidad de otro tenant se rechaza sin exponer
  existencia ni datos y sin producir mutaciones fuera del tenant autorizado.
- **SC-005**: El 100% de ejecuciones headless verificadas produce cero llamadas a Meta, incluso con
  credenciales de Meta válidas presentes en el ambiente de prueba.
- **SC-006**: Un agente puede identificar desde un solo resultado estructurado si el turno fue
  aplicado, repetido, rechazado, falló o quedó `indeterminate`, qué estado cambió y qué respuesta se
  capturó, sin consultar directamente la base de datos.
- **SC-007**: Las pruebas de salida inválida, baja confianza, proveedor no disponible y conflicto de
  concurrencia conservan draft/orden en el 100% de los casos donde no existe una acción válida
  confirmada.
- **SC-008**: Un agente nuevo sigue la guía y logra iniciar, continuar, inspeccionar y cerrar una sesión
  de prueba en menos de 10 minutos, sin credenciales de Meta ni conocimiento del esquema interno.
- **SC-009**: El 100% de intentos de ejecutar headless con debug deshabilitado, sin el archivo dedicado,
  con `APP_ENV` distinto de `local` o con cualquier endpoint Supabase remoto/inconsistente se rechaza
  antes de resolver tenant, identidad o conversación, y ningún artefacto desplegado expone la interfaz.
- **SC-010**: En el 100% de las pruebas de pausa manual, ningún inbound invoca IA durante la pausa y,
  si al reactivar el último mensaje es del cliente y está pendiente, se procesa exactamente una vez.

## Assumptions

- La primera versión procesa exclusivamente texto ya normalizado; las pruebas del payload crudo y de
  media continúan perteneciendo al canal WhatsApp.
- Las corridas normales usan la IA configurada del tenant. Los dobles IA son valores inline de pruebas
  deterministas, no una configuración persistente ni el comportamiento predeterminado.
- “Paridad exacta” significa un único comportamiento post-normalización compartido, no comparar
  literalmente metadata de entrega ni exigir repetibilidad textual de modelos no deterministas.
- Los datos creados por headless son datos de prueba reales dentro del ambiente permitido: deben
  ejercer las mismas validaciones y persistencia, no una base paralela en memoria.
- La persistencia headless usa exclusivamente el stack Supabase local declarado en
  `supabase/config.toml`; ninguna ejecución headless se conecta a `development`, staging o producción.
- Este feature corrige en el flujo compartido la desalineación vigente de “todo texto procesable por
  automatización pasa por IA”: los bypass textuales deterministas se sustituyen por un catálogo
  provider-neutral de operaciones estructuradas disponible al modelo, sin trasladar al modelo cálculos
  ni mutaciones autoritativas. Los inbound recibidos durante pausa manual o automatización deshabilitada
  son la excepción explícita y no invocan IA.
- Inspeccionar una sesión es una operación de lectura y no renueva expiración, incrementa intentos de
  aclaración ni invoca IA.
- Cerrar el proceso de consola no equivale a cancelar pedido, completar conversación ni borrar
  evidencia.
- Los límites aprobados son 4096 caracteres Unicode por turno, sin TTL/purga automática del journal y
  una ejecución activa por sesión mediante lock; sesiones distintas pueden avanzar en paralelo.

## Open Questions

- Ninguna — las ambigüedades críticas quedaron resueltas el 2026-08-12.
