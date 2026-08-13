# Investigación técnica: chat headless local

**Fecha**: 2026-08-12  
**Especificación**: [spec.md](./spec.md)

## Método y evidencia

Se inspeccionaron el webhook de WhatsApp, el router, la interpretación semántica, los servicios de conversación/cliente, el registro de mensajes, las notificaciones posteriores, las migraciones tenant, la configuración de Wrangler y las suites actuales. También se contrastó el diseño de datos con la documentación vigente de Supabase.

La evidencia permite separar dos conceptos:

1. **Plano de negocio**: clientes, conversaciones, mensajes, borradores, pedidos, alertas y transiciones. Debe ser exactamente el existente y persistir exclusivamente en el Supabase local del repositorio.
2. **Plano de control del runner**: identidad opaca seleccionable, sesión de consola, claim idempotente y resultado seguro. No existe hoy y no debe terminar en artefactos desplegados.

## Decisiones

### D-001 — Extraer un caso de uso posterior a normalización

**Decisión**: extraer de `handleInboundMessage` un `processNormalizedChatTurn` dueño de la resolución de cliente, conversación, persistencia inbound y ejecución del router. WhatsApp y headless serán adaptadores de entrada.

**Razón**: ese tramo contiene la lógica común que la especificación exige compartir. Llamar solo al router omitiría persistencia y ciclo conversacional; invocar el webhook desde consola fabricaría un transporte Meta y mantendría el acoplamiento.

**Alternativas rechazadas**:

- Duplicar el handler para CLI: crea divergencia funcional.
- Enviar payloads falsos al endpoint WhatsApp: mezcla normalización, firma e idempotencia de transporte con la prueba de negocio.
- Llamar directamente a servicios de borrador/pedido: elude interpretación y router.

### D-002 — CLI de proceso único, no endpoint HTTP

**Decisión**: añadir una entrada Node separada que recibe una línea JSON por stdin y devuelve una línea JSON por stdout. No habrá ruta Hono, servidor local ni importación desde `src/index.ts`.

**Razón**: minimiza superficie, facilita automatización por agentes y permite demostrar que el runner no integra el Worker desplegado.

**Alternativas rechazadas**:

- Ruta `/debug/headless`: aunque estuviera protegida, existiría en el artefacto desplegado.
- REPL interactivo como único contrato: dificulta idempotencia, automatización y validación estructurada.

### D-003 — Archivo dedicado y Supabase local antes de acceder a datos

**Decisión**: la aplicación headless carga obligatoriamente `.env.headless.local`, verifica entrada CLI local, `PARAHOY_HEADLESS_DEBUG=true`, `APP_ENV=local` y que los endpoints Supabase sean loopback y coincidan con `supabase/config.toml`. Solo entonces lee journal o resuelve tenant. No acepta selección de archivo desde el comando ni fallback a `.dev.vars`/ambiente remoto.

**Razón**: producto sustituyó el uso temporal de staging por una base local reiniciable. El archivo dedicado y la comprobación de host/puertos impiden apuntar por error a production, staging u otro proyecto.

Los repositorios actuales usan PostgREST con selección explícita de schema. Supabase local solo publica
los schemas listados en `[api].schemas`, y los cambios requieren reiniciar el stack. Por eso el setup
versiona `control`, `tenant_template` y los tenants seed, y un helper local sincroniza todos los
`schema_name` registrados antes de ejecutar headless. Un tenant no expuesto falla como prerrequisito;
no se crea un repositorio Postgres alterno.

**Alternativas rechazadas**:

- Solo `APP_ENV`: puede estar mal configurado o combinarse con otra URL.
- Solo flag debug: no identifica el destino de datos.
- Permitir cualquier Supabase remoto o confiar en variables heredadas: podría alcanzar producción u otro proyecto no autorizado.

### D-004 — Journal filesystem local; sin migraciones headless

**Decisión**: almacenar el plano de control en `.local/headless-chat/v1/`, ignorado por Git. La persistencia de negocio continúa en las tablas actuales de cualquier tenant registrado localmente. No se añaden tablas, RLS, grants ni schemas headless; una migración compartida puede definir el claim del inbound al reactivar manual.

**Razón**: una migración canónica se aplicaría también a entornos desplegados, aun si ninguna ruta usara las tablas. El journal local satisface continuidad entre invocaciones sin introducir infraestructura headless desplegable.

**Alternativas rechazadas**:

- Tablas `headless_sessions` en `control`: más fáciles de consultar, pero quedarían desplegadas.
- Solo memoria del proceso: no mantiene sesión entre comandos.
- Codificar el estado completo en cada comando: transfiere secretos/estado y debilita aislamiento.

La elección mantiene el principio de mínimo privilegio. Supabase distingue grants de tabla y RLS, y recomienda revisar ambos controles; además, desde 2026 las tablas nuevas ya no se exponen automáticamente en Data API para proyectos nuevos, pero los grants siguen siendo una decisión separada ([Securing your API](https://supabase.com/docs/guides/api/securing-your-api), [cambio de exposición de tablas](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). Al no crear tablas, este feature evita ampliar cualquiera de esas superficies.

### D-005 — Identidad opaca con mapeo tenant-local

**Decisión**: `start` crea por defecto un `identityId` opaco y un cliente sintético en el tenant local seleccionado. El journal mapea ese ID al cliente interno; el comando nunca acepta teléfono, customer ID, schema ni identidad WhatsApp. Si se pasa `identityId`, debe existir en el journal, pertenecer al mismo `localProjectId`/tenant y tener origen `headless`.

**Razón**: la tabla `customers` solo identifica hoy por teléfono y no registra origen. Exponer ese campo permitiría seleccionar una identidad real. El mapeo local hace verificable la procedencia sin migrar el esquema.

**Alternativas rechazadas**:

- Aceptar teléfono: no distingue sintético de WhatsApp.
- Aceptar `customerId`: es enumerabilidad directa y no acredita origen.
- Usar prefijo de teléfono como única protección: convención débil sin prueba de creación por el runner.

### D-006 — Puerto de entrega seleccionado por origen del inbound

**Decisión**: los emisores conversacionales usan `OutboundDeliveryPort` seleccionado por el origen
persistido del inbound. WhatsApp conserva el adaptador Meta; un inbound headless usa captura local,
registra en el tenant el mensaje saliente completo con proveedor `headless` y agrega una proyección
segura redactada al resultado cuando
ocurre dentro del turno. Si se procesa posteriormente al reactivar desde dashboard, persiste una
captura separada consultable por `inspect` sin reescribir el resultado durable anterior. Dashboard,
cron y campañas no relacionados quedan fuera.

**Razón**: el origen del inbound debe gobernar la entrega para garantizar cero Meta incluso cuando el
procesamiento se difiere por pausa manual. La correlación permite observar esa respuesta posterior sin
atribuirla retroactivamente al resultado inmutable del turno.

**Alternativas rechazadas**:

- Capturar todas las notificaciones futuras: requeriría infraestructura adicional y excede el alcance;
  solo se captura la respuesta directa causada por el inbound headless pendiente.
- Mock global de `fetch`: útil como aserción de prueba, no como diseño.
- Marcar como WhatsApp un mensaje no enviado: falsifica persistencia.

### D-007 — Fixture solo en el borde del proveedor de IA

**Decisión**: la CLI usa siempre la configuración real del tenant y no expone `aiFixtureId` en su
protocolo. Las pruebas deterministas pueden sustituir únicamente la salida cruda del proveedor
mediante inyección interna del harness. Parser, schema, confianza, fallback, validaciones y
ejecutores permanecen comunes; ningún fixture se carga desde stdin o desde una ruta arbitraria.

**Razón**: permite pruebas deterministas conservando el comportamiento que importa. Inyectar un plan ya parseado eludiría la principal superficie de riesgo.

**Alternativas rechazadas**:

- Fixture inline/path arbitrario: permite leer archivos o introducir datos no controlados.
- Mockear el router completo: no prueba paridad.
- Usar siempre IA real: hace las pruebas no deterministas y dependientes de disponibilidad/costo.

### D-008 — Protocolo versionado y una invocación por comando

**Decisión**: comandos `start`, `turn`, `inspect`, `reconcile` y `close`, todos con `version: 1` y tenant obligatorio. `turn` exige `sessionId`, `turnId` y texto. `reconcile` exige sesión, turno indeterminado y una observación `effects_applied|no_effects` que el backend valida contra el estado autoritativo; no fuerza una transición ni reejecuta el turno. stdout contiene exactamente un documento JSON; stderr queda para diagnósticos seguros.

**Razón**: hace explícitas selección, idempotencia y ciclo de vida; una línea por proceso evita estado implícito del terminal.

**Alternativas rechazadas**:

- Sesión inferida por “última usada”: insegura con agentes concurrentes.
- Texto libre con flags: más difícil de validar y extender sin ambigüedad.

### D-009 — Claim atómico y serialización por sesión

**Decisión**: antes de IA o persistencia de negocio, el journal toma un lock exclusivo por sesión y crea un claim para `(sessionId, turnId)`. Un retry devuelve el resultado ya durable. El ID del mensaje inbound será compuesto de sesión y turno para aprovechar la unicidad existente. Turnos diferentes de una misma sesión se serializan.

**Razón**: evita confirmaciones duplicadas y carreras sobre el mismo borrador. La unicidad de mensajes es una segunda defensa, no el coordinador principal.

**Alternativas rechazadas**:

- Solo índice de mensajes: el proceso podría ejecutar efectos antes/después de conflictos parciales.
- Paralelismo dentro de una sesión: el router depende del estado secuencial.

Si el proceso muere después de efectos pero antes de guardar el resultado, el turno queda
`indeterminate`: no se reejecuta automáticamente. Para que la reconciliación tenga evidencia durable,
el backend guarda un manifiesto canónico sanitizado después de validar el plan y antes del primer
efecto; `inspect` solo expone una proyección segura.

### D-010 — Proyección segura de paridad

**Decisión**: comparar dentro del harness una proyección canónica formada por la respuesta completa
persistida, estado/automatización de conversación, estado y totales del borrador, pedido creado/estado,
tipos de efectos y códigos de routing/IA. La salida pública usa otra proyección que redacta dirección,
billing y patrones sensibles, y declara códigos estables. Se excluyen prompts, raw de proveedor,
trazas completas, headers, credenciales, teléfono y URLs de cualquier reporte.

**Razón**: igualdad byte a byte de filas internas sería frágil por IDs/tiempos; comparar solo texto no detectaría divergencias de estado. La proyección selecciona observables funcionales y seguros.

### D-011 — Sin cambio de modelo de conversación

**Decisión**: reutilizar el `channel=whatsapp` vigente para el agregado conversacional y representar el origen de transporte en `messages.provider=headless` y el journal.

**Razón**: el canal actual participa en la búsqueda de conversaciones activas. Añadir `headless` forzaría migraciones y ramas de repositorio que no aportan lógica de negocio distinta.

**Alternativa rechazada**: ampliar el enum/campo de canal. Confunde canal de negocio con adaptador de prueba y contradice la ausencia de migraciones.

### D-012 — Verificar ausencia en artefactos con build real

**Decisión**: ejecutar el binario local de Wrangler con `deploy --env staging --dry-run --outdir <tmp>` únicamente para construir el artefacto desplegable y buscar nombres de módulos, comandos, fixtures y flag headless en el output. Esta verificación no ejecuta headless ni autoriza acceso a Supabase staging. Además, comprobar que las rutas HTTP desconocidas mantienen 404.

**Razón**: revisar imports por source no demuestra el bundle resultante. El dry-run produce el artefacto sin publicar.

### D-013 — Límite de entrada y códigos de proceso

**Decisión**: texto no vacío de máximo 4096 caracteres Unicode; identificadores con alfabeto restringido y longitud acotada. Exit code `0` para éxito/repetición, `2` para rechazo de entrada/seguridad y `1` para fallo de procesamiento o estado indeterminado.

**Razón**: límites explícitos protegen costo y memoria; códigos estables permiten automatización sin analizar texto.

### D-014 — Ciclo de vida sin borrado automático

**Decisión**: `close` marca la sesión cerrada de forma idempotente, conserva resultados e impide nuevos turnos. No habrá comando de borrado en la primera versión. La limpieza es una operación deliberada: por IDs exactos del journal o, para reiniciar todo el entorno local, mediante `supabase db reset` después de validar `project_id` y endpoints.

**Razón**: `close` no debe ser destructivo ni esconder evidencia. Como la base es exclusivamente local,
un reset total explícito es seguro dentro del alcance y más reproducible que borrados amplios construidos
por el runner.

### D-015 — Catálogo provider-neutral de operaciones, no callbacks nativos

**Decisión**: conservar el patrón estructurado actual: el modelo recibe un catálogo de operaciones con
nombre, argumentos y estados permitidos y devuelve un plan JSON. El catálogo se amplía para cubrir
saludo/menú, consulta de estado, humano, pago, billing y configuración. Ningún proveedor recibe
callbacks ejecutables; parser, evidencia y ejecutores permanecen en backend.

**Razón**: coincide con el mecanismo que ya usa el modelo para proponer cambios de campos/estado,
mantiene un solo contrato entre Gemini/OpenRouter/fixtures y evita que “herramienta” implique dos
mecanismos distintos.

### D-016 — Manual omite IA y procesa el último inbound al reanudar

**Decisión**: los inbound recibidos con automatización efectiva deshabilitada se persisten con estado
pendiente y no invocan IA. La reactivación de una conversación manual reclama atómicamente el último
inbound solo si sigue pendiente y continúa siendo el último mensaje; después lo entrega al mismo caso
de uso sin volver a insertarlo. El claim usa el ID persistido, estados monotónicos y clasificación
`indeterminate` si un crash puede haber dejado efectos.

**Razón**: respeta que una pausa manual no procese el texto, pero evita perder el último mensaje del
cliente cuando el operador devuelve el control a la automatización.

### D-017 — Manifiesto previo a efectos y reconciliación backend común

**Decisión**: persistir un `execution_manifest` versionado en el payload interno del inbound después
del parser/validación y antes de ejecutar la primera mutación. Una función tenant-aware toma locks de
fila sin `SKIP LOCKED`, verifica versiones previas y guarda el checkpoint. La reconciliación se
implementa una sola vez en `reconcileNormalizedChatTurn` y la invocan tanto la CLI local como una
operación autenticada de dashboard; no se diseña UI en esta entrega.

El manifiesto registra únicamente digest del plan validado, tipos de operación, objetivos internos,
claves idempotentes, versiones previas y fingerprints de postcondiciones. La reconciliación declara
`applied` solo con todos los efectos, `failed` solo con ninguno y conserva `indeterminate` ante estado
parcial, contradictorio o evidencia inválida. Nunca ejecuta IA, geocodificación, entrega ni acciones.

**Razón**: snapshots posteriores y observación humana no demuestran por sí solos qué intentaba ejecutar
el turno. El checkpoint previo permite distinguir todo/ninguno sin convertir una declaración en
autoridad ni reejecutar efectos inciertos. PostgreSQL documenta que `SELECT ... FOR UPDATE` bloquea las
filas objetivo hasta finalizar la transacción y recomienda adquirir locks en orden consistente para
evitar deadlocks. Supabase recomienda funciones `security invoker` por defecto, relaciones plenamente
calificadas cuando se controla el `search_path` y revocar ejecución pública explícitamente.

**Alternativas rechazadas**:

- Decidir solo con snapshots o texto del operador: no prueba intención ni completitud.
- Repetir el plan para descubrir qué ocurrió: viola at-most-once.
- `SKIP LOCKED`: puede omitir la fila cuya decisión debe ser autoritativa.
- RPC `security definer` o ejecutable por roles públicos: amplía privilegios innecesariamente.
- Reconciliación exclusiva del CLI: dejaría el flujo compartido desplegado sin recuperación soportada.

## Estrategia de prueba derivada

La matriz mínima de paridad incluye: saludo/menú mediante herramienta IA, consulta de pedido mediante herramienta IA, solicitud humana mediante herramienta IA, adición semántica de producto, ID inventado, pago mediante herramienta IA, producto configurable mediante herramienta IA, confirmación única, baja confianza, tercer intento de aclaración, proveedor primario inválido con fallback válido, indisponibilidad total de IA, automatización manual y geocodificación no disponible.

Cada escenario corre sobre un estado base equivalente y compara la proyección definida en [contracts/parity-projection.md](./contracts/parity-projection.md). Las pruebas de cero Meta instalan además un espía que falla ante cualquier URL `graph.facebook.com`.

## Incertidumbres resueltas y límites restantes

- La especificación ya resolvió entorno solo local, identidad nueva por defecto/seleccionable y tenant explícito.
- Producto decidió que la CLI use exclusivamente Supabase local mediante un archivo de ambiente dedicado y pueda seleccionar cualquier tenant registrado localmente con credenciales de acceso total.
- No se cambia la atomicidad general de confirmación de pedidos. El journal protege el turno headless; una transacción de negocio cross-channel sería un feature separado.
- La suite real de integración requiere el stack local saludable, migraciones/seed y al menos dos tenants locales para aislamiento; debe fallar cerrado ante endpoints remotos y reportar el gate como bloqueado cuando esos prerrequisitos no estén disponibles.

## Fuentes externas verificadas

- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api) — separación entre privilegios de tabla, schemas expuestos y RLS.
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS como control adicional para acceso por Data API.
- [Supabase: Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas) — exposición y grants explícitos de schemas personalizados.
- [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config) — `api.schemas`
  controla los schemas publicados por PostgREST local y los cambios de configuración requieren restart.
- [Supabase changelog: tables not exposed automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) — cambio vigente en 2026 y necesidad de no asumir exposición implícita.
- [Supabase: Database Functions](https://supabase.com/docs/guides/database/functions) — `security invoker`,
  `search_path` seguro y revocación/concesión explícita de ejecución.
- [PostgreSQL: Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) —
  semántica de row locks y orden consistente para prevenir deadlocks.
