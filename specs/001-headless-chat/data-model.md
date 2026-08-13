# Modelo de datos: chat headless local

**Estado**: diseño aprobado; incluye una migración compartida para el claim de inbound al salir de manual, pero ninguna tabla o schema headless.  
**Principio**: el plano de negocio usa exclusivamente el Supabase local definido por `supabase/config.toml` y el plano de control headless permanece en un journal local no desplegable.

## 1. Plano de negocio existente

No se añaden tablas ni columnas. El caso de uso compartido reutiliza las entidades actuales del esquema tenant seleccionado.

| Entidad existente | Uso headless | Invariantes preservados |
| --- | --- | --- |
| `control.tenants` | Resolver en local el slug obligatorio y obtener tenant ID/schema registrado. | El schema nunca se acepta del comando; cualquier tenant registrado localmente puede seleccionarse. |
| `<tenant>.customers` | Representar al cliente sintético mediante una clave interna generada. | Solo se accede después de validar la identidad en journal; no se acepta teléfono/customer ID del caller. |
| `<tenant>.conversations` | Mantener el mismo agregado y ventana de sesión que WhatsApp. | Estado, automatización y expiración usan los servicios existentes. |
| `<tenant>.messages` | Persistir inbound y outbound del flujo headless. | `provider=headless`; inbound usa ID compuesto; unicidad existente actúa como segunda defensa. |
| `<tenant>.draft_orders` y relaciones | Conservar intención/pedido en progreso entre turnos. | Solo acciones controladas actuales modifican estado. |
| `<tenant>.orders` y relaciones | Persistir confirmaciones exactamente como WhatsApp. | No se añade ejecutor alternativo ni se omiten validaciones. |
| Alertas/notificaciones existentes | Observar handoff y efectos operativos. | La respuesta conversacional se captura si el inbound causante tiene origen headless, incluso al reactivar desde dashboard; notificaciones no relacionadas conservan su canal. |

### Semántica de mensajes headless

- `provider`: `headless`.
- `provider_message_id` inbound: valor derivado de `sessionId` y `turnId`, no el texto ni datos personales.
- `direction`: valores actuales.
- Estado outbound: valor que indique captura local, no `sent` a WhatsApp.
- Payload/raw de Meta: ausente; no se fabrica un webhook ni un message ID de Meta.
- El outbound tenant-local conserva el contenido completo y exacto que habría recibido el cliente. Esa
  evidencia de negocio no se copia literalmente a stdout, stderr, journal ni `inspect`: dichas
  superficies consumen una `SafeCapturedResponseProjection` redactada y autocontenida.
- Un outbound generado al reactivar desde dashboard conserva correlación segura con el inbound headless,
  sesión y turno originales. Se incluye en consultas posteriores de `inspect`, pero no modifica el
  `HeadlessTurnRecord.result` ya almacenado.

El diseño debe confirmar en implementación que los repositorios toleran estos valores de texto. Si se descubre un constraint no observado, se detiene la implementación y se actualiza el plan; no se crea una migración incidental distinta del claim compartido aprobado.

### Claim compartido de inbound y reanudación manual

- La migración marca `processed` todo inbound preexistente con `status=logged` antes de activar la nueva
  semántica. Ese corte evita inferir o reprocesar pendientes históricos.
- Después del corte, todo inbound nuevo se crea con `status=logged`; este valor significa pendiente de
  claim, no entregado.
- El procesamiento normal reclama `logged -> processing` antes de invocar IA.
- Si la conversación está en manual o la automatización efectiva está deshabilitada, el mensaje queda
  `logged` y no invoca IA.
- Si llega otro inbound mientras existe uno `logged` en la conversación pausada, la misma operación
  marca el anterior `superseded`; únicamente el nuevo queda pendiente.
- La reactivación manual y el claim del último inbound forman una única operación tenant-aware. Solo se
  reclama cuando ese inbound es el mensaje más reciente de la conversación y continúa `logged`.
- El final confirmado marca `processed`. Un fallo demostrablemente anterior a efectos puede volver a
  una condición recuperable definida; si pudieron existir efectos, queda `indeterminate` y no se
  reejecuta automáticamente.
- La identidad idempotente es el ID persistido del mensaje; procesarlo al reanudar no inserta otro
  inbound.

### Manifiesto durable de ejecución

Después de parsear y validar el plan de IA contra estado y catálogo, pero **antes del primer efecto**, el
backend guarda en `messages.payload.internal.execution_manifest` un manifiesto canónico versionado. No
se añaden tablas ni columnas: se utiliza el payload interno ya existente del inbound reclamado.

El manifiesto contiene exclusivamente:

- versión de formato y digest canónico del plan validado;
- tipos de operaciones autorizadas e IDs internos canónicos de sus objetivos;
- claves idempotentes de los efectos esperados;
- versiones o digests previos de los agregados que protegen contra estado obsoleto;
- fingerprints estructurados de las postcondiciones esperadas.

No contiene texto del cliente, respuesta visible, dirección, billing, prompt, raw del modelo, tokens,
credenciales ni datos libres. El checkpoint se escribe bajo claim tenant-aware y lock de fila; el
ejecutor vuelve a validar versiones antes de mutar. Un mensaje solo pasa a `processed` cuando todas las
postcondiciones esperadas quedaron confirmadas.

La reconciliación compartida bloquea mensaje, conversación y objetivos en orden estable y evalúa el
manifiesto sin invocar IA, geocodificación, entrega ni ejecutores:

- `applied`: existen todas las postcondiciones y claves idempotentes esperadas;
- `failed`: continúan las precondiciones y se demuestra ausencia total de efectos;
- `indeterminate`: hay efecto parcial, contradicción, estado obsoleto o manifiesto ausente/corrupto.

La observación `effects_applied|no_effects` del operador es consultiva y nunca reemplaza estas pruebas.

## 2. Plano de control local

Raíz por defecto: `<repo>/.local/headless-chat/v1/`. La ubicación puede sobreescribirse solo en tests mediante una ruta temporal resuelta por el proceso, nunca desde un campo del comando.

```text
.local/headless-chat/v1/
├── identities/<identityId>.json
├── sessions/<sessionId>/session.json
├── sessions/<sessionId>/session.lock
└── sessions/<sessionId>/turns/<turnKey>.json
```

Los nombres físicos derivados de datos del caller se codifican o hashean; no se interpolan segmentos con `/`, `..` ni separadores de plataforma.

### HeadlessIdentity

| Campo | Tipo | Regla |
| --- | --- | --- |
| `formatVersion` | `1` | Rechazar versiones desconocidas. |
| `identityId` | string opaco | Generado por runner, estable y no derivado de teléfono. |
| `tenantId` | UUID | Copiado del registro control resuelto. |
| `tenantSlug` | string | Canonicalizado; redundancia para diagnóstico/validación. |
| `localProjectId` | string | `project_id` de `supabase/config.toml`; impide reuse accidental con otro stack local. |
| `customerId` | UUID | Referencia interna a cliente sintético en Supabase local; nunca aceptada como input. |
| `syntheticCustomerKey` | string | Secreto operativo local necesario para los repositorios actuales; nunca sale en resultados/logs. |
| `origin` | `headless` | Marca inmutable que habilita reuse. |
| `createdAt` | timestamp ISO | Reloj inyectable. |

**Restricciones**:

- `identityId` pertenece a exactamente un tenant.
- Solo registros creados por el runner con `origin=headless` son seleccionables.
- No existe conversión de teléfono/customer ID a `identityId` desde consola.
- Borrar el cliente por fuera del runner vuelve la identidad inválida; `start` con esa identidad falla cerrado.
- La identidad es dato sintético de la base local; no puede reutilizarse con otro `project_id` aunque coincidan tenant/slug.

### HeadlessSession

| Campo | Tipo | Regla |
| --- | --- | --- |
| `formatVersion` | `1` | Control de compatibilidad. |
| `sessionId` | string opaco | Generado por runner. |
| `identityId` | string opaco | Referencia a identidad del mismo tenant. |
| `localProjectId`, `tenantId`, `tenantSlug` | string/UUID/string | Copia inmutable de la instancia local y selección validadas. |
| `status` | `active \| closed` | Estado durable. |
| `createdAt`, `updatedAt` | timestamp ISO | Auditoría local. |
| `closedAt` | timestamp ISO/null | Solo al cerrar. |
| `lastTurnId` | string/null | Diagnóstico; no reemplaza el listado de claims. |

**Transiciones**:

```text
start -> active -> close -> closed
                 └─ close repetido -> closed (idempotente)
closed + turn -> rechazo sin efectos
```

Una misma identidad puede abrir varias sesiones, pero cada sesión mantiene su propia secuencia y locks. La continuidad conversacional real depende del servicio vigente de conversación para ese cliente; abrir una sesión nueva no promete crear una conversación nueva si la actual sigue activa.

### HeadlessTurnRecord

| Campo | Tipo | Regla |
| --- | --- | --- |
| `formatVersion` | `1` | Control de compatibilidad. |
| `sessionId`, `turnId` | string | Clave lógica única dentro del tenant/sesión. |
| `inputDigest` | hash | Permite detectar reuse del mismo ID con texto diferente sin guardar texto. |
| `state` | ver abajo | Estado monotónico. |
| `claimedAt`, `updatedAt` | timestamp ISO | Diagnóstico seguro. |
| `result` | `HeadlessResult`/null | Envelope seguro durable para retries. |
| `reconciliation` | objeto/null | Observación del operador, evidencia backend sanitizada, decisión y fecha; nunca sustituye la validación autoritativa. |

**Estados y transiciones**:

```text
ausente -> claimed -> processing -> applied
                                ├-> rejected
                                ├-> failed
                                └-> indeterminate -> applied (efectos validados)
                                                 ├-> failed (ausencia de efectos validada)
                                                 └-> indeterminate (evidencia insuficiente)
```

- `applied`: terminó y el resultado/snapshot fue guardado.
- `rejected`: no se ejecutaron acciones por input/estado/IA no autorizada.
- `failed`: dependencia o procesamiento falló y el runner puede afirmar que no hubo efectos de negocio incompletos. `result.error.retriable` determina un nuevo `turnId`, no replay del mismo.
- `indeterminate`: pudieron ocurrir efectos antes de perder confirmación local. Nunca se reintenta
  automáticamente con el mismo ni con otro ID. `reconcile` recibe `effects_applied` o `no_effects` como
  observación, la contrasta con el manifiesto durable y conversación/draft/orden/mensajes bajo lock, y
  solo transiciona a `applied` o `failed` cuando el backend puede demostrar respectivamente todos o
  ninguno de los efectos; un resultado parcial siempre conserva `indeterminate`.
- `repeated` es un estado del envelope devuelto al caller; el record original conserva su estado terminal y resultado.

Reuse de un `turnId` con digest diferente se rechaza como conflicto de idempotencia.

## 3. Locks y escritura atómica

- Lock exclusivo por `sessionId` antes de leer/crear el turno.
- Creación del claim con operación exclusiva (`create-if-absent`).
- Escritura de actualizaciones en archivo temporal dentro del mismo directorio, `fsync` cuando corresponda y rename atómico.
- Metadata del lock con PID y tiempo para diagnóstico; un lock huérfano no se elimina automáticamente sin comprobar que el proceso no vive y que superó el umbral documentado.
- Locks de sesiones diferentes pueden progresar en paralelo.
- El lock permanece durante todo el turno para preservar orden conversacional.

## 4. Proyección de estado

El snapshot no es una copia de filas. Consulta por `tenantId`, `customerId` y conversación resueltos internamente y produce únicamente:

- conversación: ID opaco, estado, modo de automatización y expiración;
- borrador activo: ID, estado, cantidad de líneas, subtotales/totales, fulfillment y estado de campos requeridos;
- pedido relevante: ID, estado y totales;
- efectos: tipo, estado e ID opaco;
- routing/IA: códigos de decisión, proveedor lógico, outcome y operaciones validadas por tipo;
- respuestas capturadas proyectadas para el agente, con `redacted` y `redactionCodes` estables.

La persistencia tenant-local conserva el mensaje saliente completo. La proyección pública aplica una
allowlist de campos y redacta valores autoritativos sensibles —incluidos dirección y billing— y patrones
de secretos/PII; no incluye teléfonos, nombres, direcciones libres, notas, raw de IA, prompts, headers,
secretos, URLs ni payloads completos. `redacted=false` y `redactionCodes=[]` solo cuando el contenido
proyectado no requirió sustituciones.

## 5. Aislamiento tenant

1. La CLI carga `.env.headless.local` y valida debug, `APP_ENV=local`, endpoints loopback y coincidencia con `supabase/config.toml` antes del journal.
2. El comando exige `tenant` en cada invocación.
3. Se resuelve slug en `control.tenants` local; cualquier tenant registrado es elegible.
4. Se comprueba que el `schema_name` resuelto esté en `[api].schemas`; el helper de setup mantiene esa
   lista sincronizada con todos los tenants locales y requiere restart si cambia.
5. Para sesión/identidad existente se comparan `localProjectId`, `tenantId` y slug canonicalizado antes de consultar negocio.
6. El schema se obtiene del registro control; nunca se concatena el input del usuario.
7. Toda consulta posterior recibe el `TenantContext` validado.
8. Un mismatch devuelve rechazo genérico sin confirmar si el recurso existe en otro tenant.

## 6. Retención y limpieza

- `close` conserva journal y negocio para inspección reproducible.
- No hay TTL ni purga automática en v1.
- `.local/headless-chat/` está ignorado por Git y excluido de build/deploy.
- Como la base es local y reiniciable, la limpieza recomendada de una corrida elimina IDs exactos del journal; para limpiar todo el entorno de prueba se permite `supabase db reset` únicamente después de validar que el stack corresponde al `project_id` local. La raíz local exacta se retira mediante un procedimiento separado.
- La implementación debe documentar qué es recuperable antes de cualquier helper destructivo; un helper futuro requerirá confirmación y validación de path local.

## 7. Impacto Supabase

**Migraciones**: una migración compartida marca como `processed` los inbound históricos `logged`,
define los estados `logged`, `processing`, `processed`, `superseded` e `indeterminate` y crea las RPC
tenant-aware necesarias para superseder/reclamar, guardar el checkpoint del manifiesto, finalizar y
reconciliar el último inbound al reactivar manual; no crea entidades headless. Las funciones toman
locks con `SELECT ... FOR UPDATE`, sin `SKIP LOCKED`, y bloquean objetivos en orden estable.  
**RLS/grants**: sin cambios de RLS. Las funciones son `SECURITY INVOKER`, califican completamente cada
relación, revocan ejecución de `PUBLIC`, `anon` y `authenticated`, y la conceden únicamente a
`service_role`; el caller nunca suministra schema, manifiesto ni estado terminal autoritativo.  
**Provisionamiento tenant**: sin cambios.  
**Rollback de datos**: el runner no revierte datos de negocio; revertir la RPC/semántica compartida
requiere una migración forward que preserve mensajes ya clasificados.  
**Validación requerida**: ejecutar integración contra dos tenants de la base local, confirmar
unicidad/claim/checkpoint/reconciliación de mensajes, probar fallos antes y después de cada frontera de
efecto, revisar advisors del stack local y demostrar rechazo de cualquier endpoint Supabase remoto.
