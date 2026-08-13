# Contratos internos del runtime compartido

Estos contratos describen responsabilidades y observables. Los nombres de archivos del plan son objetivos; los tipos finales se consolidarán durante implementación sin alterar esta semántica.

## `NormalizedChatTurn`

Entrada agnóstica de transporte al caso de uso común:

- tenant resuelto y validado;
- actor key interna, nunca elegida directamente por headless;
- `source`: `whatsapp_cloud | headless`;
- inbound ID idempotente;
- tipo de mensaje soportado;
- texto normalizado y, cuando corresponda, ubicación/media ya normalizados;
- tiempo recibido inyectable;
- contexto seguro de correlación.

No contiene webhook raw, firma, access token, URL de Meta ni comando CLI completo.

## `OutboundDeliveryPort`

Responsabilidad: entregar una respuesta ya autorizada y devolver un resultado que pueda persistirse fielmente.

Entrada mínima:

- tenant/contexto de conversación;
- destinatario interno resuelto;
- contenido de texto o imagen permitido;
- correlación de turno.

Salida mínima:

- modo `external | captured`;
- estado `sent | captured | failed`;
- provider lógico;
- provider message ID opcional solo para adaptador externo;
- código de fallo seguro opcional.

Invariantes:

- `WhatsAppDelivery` es el único adaptador que importa el cliente Meta.
- `HeadlessCapture` vive en el límite compartido de outbound, nunca invoca red de Meta ni fabrica
  confirmación `sent`. Puede persistir una captura sin proceso CLI activo, pero no importa journal,
  fixtures, configuración debug ni módulos bajo `apps/api/headless`.
- El registro de mensajes usa el resultado del puerto, no un proveedor fijo.
- Toda emisión causada directamente por un inbound con `source=headless` usa `HeadlessCapture`, incluso
  si el dashboard reclama ese inbound al reactivar la automatización. La captura posterior se persiste
  con correlación al inbound y queda disponible para `inspect`, pero no reescribe el resultado durable
  del turno original. Dashboard, cron y campañas no relacionados quedan fuera de la captura.
- `HeadlessCapture` persiste en `<tenant>.messages` el contenido completo y exacto autorizado. Solo
  entrega al observer una `SafeCapturedResponseProjection` con texto/caption redactado, `redacted` y
  `redactionCodes`; el journal y la CLI nunca reciben la captura completa.

## `SemanticGenerationPort`

Responsabilidad: devolver una respuesta cruda candidata para que el pipeline común la parseé y valide. Todo texto del usuario utiliza este puerto; no quedan bypass textuales antes de él.

Adaptadores:

- `TenantAiGeneration`: política Gemini/OpenRouter vigente.
- `InlineTestDoubleGeneration`: doble inmutable definido dentro del test; no existe como registro,
  archivo ni selección operativa.

Invariantes:

- El puerto no ejecuta operaciones ni muta estado.
- Ambos adaptadores alimentan el mismo parser/schema/validación/confianza.
- Las herramientas forman un catálogo provider-neutral incluido en el input estructurado: nombre,
  schema de argumentos y estados permitidos. El modelo devuelve operaciones JSON; no recibe callbacks
  ni usa un contrato de tool-calling nativo por proveedor.
- El catálogo cubre saludo/menú, consulta de estado, solicitud humana, pago, billing y configuración
  antes determinísticos, además de las operaciones actuales de draft/checkout.
- En `manual` o con automatización efectiva deshabilitada el puerto no se invoca y el catálogo es
  ausente; al reactivar manual, el inbound pendiente reclamado entra por este mismo puerto.
- Un doble inline no puede definir callbacks, rutas, secretos ni omitir pasos.
- Error/doble inválido se clasifica en el flujo común; no hay fallback oculto a real.

## `ClockPort` e `IdPort`

Se inyectan solo donde el determinismo sea necesario para expiraciones, journal y comparación. El comportamiento por defecto usa reloj/aleatoriedad seguros del runtime. No se exponen por el comando CLI.

## `ValidatedExecutionManifest`

Checkpoint backend creado después del parser y las validaciones, y antes del primer efecto. Contiene
versión, digest canónico del plan validado, tipos de operación, objetivos internos, claves idempotentes,
versiones previas y fingerprints hash de postcondiciones, derivados únicamente de operaciones, IDs,
precondiciones y claves idempotentes. Excluye texto libre, respuestas, dirección,
billing, prompts, raw de IA y secretos.

El puerto de persistencia debe permitir, bajo contexto tenant validado:

- reclamar el inbound y guardar el manifiesto una sola vez bajo lock;
- rechazar digest, versión previa o manifiesto conflictivo;
- finalizar `processed` únicamente tras confirmar todas las postcondiciones;
- leer y bloquear la evidencia requerida para reconciliar sin recibir schema ni estado final del caller.

## `reconcileNormalizedChatTurn`

Caso de uso backend común para CLI local y operación autenticada de dashboard. Recibe tenant resuelto,
message ID interno resuelto por el adaptador y una observación consultiva. Bloquea en orden estable,
evalúa el manifiesto y el estado autoritativo y devuelve `applied`, `failed` o `indeterminate`.

Invariantes:

- no invoca IA, geocodificación, entrega ni ejecutores;
- no reconstruye un plan desde texto, logs o journal;
- solo resuelve `applied` con todos los efectos y `failed` con ausencia demostrable de todos;
- efecto parcial, contradicción o manifiesto inválido conserva `indeterminate`;
- CLI y dashboard delegan aquí; ninguno implementa reglas propias de reconciliación.

## `SafeCapturedResponseProjection` y `SafeTurnObserver`

La proyección segura conserva orden, tipo y contenido útil no sensible, sustituye valores sensibles por
marcadores estables y declara `redacted`/`redactionCodes`. El observer recibe únicamente esa proyección
y eventos ya redactados (`stage`, duración, códigos, IDs opacos) para construir diagnósticos/snapshot.
No recibe la captura completa, prompt, raw de IA, texto libre del cliente, teléfono, dirección, billing
ni credenciales.

## Límite de dependencia

```text
adapters/whatsapp ─┐
                   ├─> processNormalizedChatTurn -> router/services -> ports
adapters/headless ─┘                                      ^
                                                         |
                                   whatsapp/headless implementations

cli reconcile ─────┐
                   ├─> reconcileNormalizedChatTurn -> manifest/state repositories
dashboard reconcile┘
```

- El caso de uso no importa CLI, filesystem ni cliente Meta.
- La CLI no importa handler/webhook.
- El Worker puede importar captura y reconciliación compartidas, pero no `apps/api/headless`, CLI,
  módulos de fixture/journal, archivo de ambiente ni gates debug.
- Los servicios de negocio no inspeccionan `APP_ENV` para decidir reglas funcionales; los gates pertenecen al adaptador headless.
