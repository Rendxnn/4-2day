# Evidencia de implementación: chat headless local

**Fecha de ejecución:** 2026-08-13  
**Repositorio:** `/Users/rendxnn/Documents/freelance/42day`  
**Estado:** implementación local y recorrido end-to-end headless ejecutado contra Supabase local con
Gemini real; las suites oficiales, directas y la integración local están verdes después de corregir el
loader del script oficial de tests. La última corrida opt-in de ocho turnos completó el flujo con
`gemini-flash-lite-latest`, sin fixtures, y creó un pedido persistido; la configuración dedicada se
restauró a `gemini-2.5-flash`. El journal ahora conserva binding de tenant/proyecto/origen y
mantiene un lock de sesión durante todo el turno, con recuperación de un turno huérfano a
`indeterminate`.

### Actualización final de esta sesión

La verificación más reciente se ejecutó con el modelo temporalmente habilitado
`gemini-flash-lite-latest`, porque `gemini-2.5-flash` respondió `429 RESOURCE_EXHAUSTED`. El modelo se
restauró a `gemini-2.5-flash` después de la prueba. El E2E real terminó **1 pasada, 0 fallos y 0
omisiones**, con 8/8 planes JSON producidos por Gemini, pedido persistido por COP 18.000, outbound
`captured`, cero Meta, `inspect` y `close`.

La suite oficial del API terminó en **243 pruebas: 226 pasaron, 0 fallaron y 17 quedaron omitidas por
ser opt-in**. La suite de integración headless contra Supabase local terminó en **76 pruebas: 75
pasaron, 0 fallaron y 1 quedó omitida por diseño**. Typecheck, lint, build, bundle de despliegue,
`git diff --check` y `supabase db lint --local` también terminaron correctamente. `supabase db advisors
--local` reportó un único warning preexistente en `tenant_demo.enforce_max_active_payment_accounts`
(`function_search_path_mutable`); no afecta los schemas headless ni fue introducido por este feature.

## Recorrido end-to-end real con Gemini ejecutado el 2026-08-13

Se ejecutó una sesión limpia sin `aiFixtureId` —el campo ya no forma parte del contrato de la CLI— usando
el modelo habilitado `gemini-flash-lite-latest`. La secuencia real fue:

1. `start` — identidad y sesión sintéticas nuevas.
2. `turn` — `Quiero una hamburguesa clásica`; Gemini produjo `add_product` con confianza 1 y el
   backend creó el borrador.
3. `turn` — `Prefiero recogerlo en el local`; Gemini produjo `set_fulfillment` y el backend pasó a
   `awaiting_normal_billing_info`.
4. `turn` — `Mi nombre completo es Carlos Demo`; Gemini produjo `set_billing` y el backend pasó a
   `awaiting_payment_method`.
5. `turn` — `Quiero pagar por transferencia`; Gemini produjo `set_payment_method` y el backend pasó
   a `awaiting_confirmation`.
6. `turn` — `Sí, confirma el pedido`; Gemini produjo `confirm_order` y se creó una orden pendiente de
   revisión del restaurante por COP 18.000.
7. Retry exacto del turno de confirmación — `status=repeated`, sin nueva llamada a Gemini ni nuevo
   efecto.
8. Mismo `turnId` con texto distinto — `IDEMPOTENCY_CONFLICT`, sin mutación.
9. `inspect` — snapshot y respuesta capturada sin IA adicional.
10. `close` — sesión cerrada correctamente. El retry exacto y el conflicto de contenido se
    verificaron en las corridas reales anteriores sobre el mismo contrato.

Los cinco intentos IA usaron Gemini y devolvieron planes JSON válidos. La consulta tenant-local
confirmó 10 mensajes en la conversación: 5 inbound `processed` y 5 outbound `captured`, todos con
`provider=headless`, y cero mensajes no-headless. El pedido quedó `pending_restaurant_confirmation`,
con borrador `confirmed`, modalidad `pickup`, pago `transfer` y total COP 18.000.

Después se corrigió la migración mediante `20260813100000_fix_normalized_inbound_manifest_json.sql`:
`jsonb_set` no creaba el objeto intermedio `payload.internal`. Una nueva corrida real confirmó que
el manifiesto persistido contiene digest, tipos de operación, IDs canónicos, precondiciones,
idempotency key y huellas de postcondición.

La corrida final sobre el código actual (`hss_7d684f47523849949a1407d577ac3c72`) observó además un
fallo transitorio de proveedor en el primer intento: el backend respondió con fallback seguro, no
mutó el pedido y registró `provider=gemini`, `outcome=skipped_or_failed` y `operationTypes=[]`.
El reintento con un nuevo turno sí llegó a Gemini y completó la misma secuencia de cinco planes
(`add_product`, `set_fulfillment`, `set_billing`, `set_payment_method`, `confirm_order`). La sesión
se cerró y el journal conserva tanto el fallback como los turnos exitosos. La consulta acumulada
del tenant confirmó 50 mensajes headless, 25 outbounds capturados y cero mensajes no-headless; el
pedido más reciente quedó `58fc9dda`, `pending_restaurant_confirmation`, total COP 18.000.

La verificación opt-in más reciente amplió el escenario a ocho turnos (`show_menu`, agregar producto,
estado, pickup, billing, transfer, estado y confirmación), además de `inspect` y `close`. Completó los
ocho planes con Gemini real y creó una orden pendiente de revisión por COP 18.000. Se conserva la
corrida anterior con `429 RESOURCE_EXHAUSTED` como evidencia del fallback seguro ante cuota agotada.

La repetición ejecutada después de esa corrida confirmó el mismo resultado: `gemini-2.5-flash` respondió
`429 RESOURCE_EXHAUSTED` y el test se omitió de forma explícita; al seleccionar temporalmente el alias
habilitado `gemini-flash-lite-latest`, Gemini produjo los ocho planes, el pedido quedó persistido y el
test terminó `1 pasada, 0 fallos, 0 omisiones`. El archivo dedicado se restauró a
`gemini-2.5-flash` al terminar.

Se probó de forma controlada `gemini-2.5-flash-lite` como alternativa real. El endpoint respondió
`404 NOT_FOUND` indicando que ese modelo ya no está disponible para nuevos usuarios con esta clave o
proyecto. La configuración se restauró a `gemini-2.5-flash`; el E2E ahora lee el modelo desde el
mismo archivo dedicado que consume la CLI y no desde una variable de shell que el launcher ignora.

## Recorrido end-to-end inicial ejecutado el 2026-08-13

Se levantó Docker Desktop y el stack mínimo de Supabase con `DOCKER_CONFIG` temporal sin el helper
global `credsStore=desktop`, que dejaba colgadas las descargas de imágenes. Se dejaron activos DB,
Kong, PostgREST, Auth, Realtime y Storage; los servicios auxiliares no necesarios para esta prueba
quedaron detenidos. Las migraciones aplicaron correctamente incluida
`20260812120000_claim_pending_inbound_on_automation_resume.sql`.

Se provisionó el tenant efímero `headless-demo` mediante
`control.provision_restaurant_tenant`, se expuso `tenant_headless_demo` en PostgREST mediante
`control.refresh_postgrest_tenant_schemas()` y se insertó un único producto demo sin PII:
`Hamburguesa clásica`, COP 18.000.

La conversación real ejecutada por CLI fue:

1. `start` — identidad y sesión nuevas, `status=started`.
2. `turn` — agregar hamburguesa, plan semántico inyectado explícitamente para esa corrida histórica,
   `status=applied`.
3. `turn` — recogida en local, `status=applied` y estado `awaiting_normal_billing_info`.
4. `turn` — nombre para factura normal, `status=applied` y estado `awaiting_payment_method`.
5. `turn` — transferencia, `status=applied` y estado `awaiting_confirmation`.
6. `turn` — confirmación, `status=applied` y estado `awaiting_restaurant_confirmation`.
7. Repetición exacta de un `turnId` — `status=repeated`, sin nuevo efecto.
8. Mismo `turnId` con contenido distinto — `IDEMPOTENCY_CONFLICT`, sin mutación.
9. `inspect` — snapshot seguro y respuestas capturadas.
10. `close` — `status=closed`.

La consulta posterior a `tenant_headless_demo.messages` confirmó inbound `provider=headless` con
estado `processed`, outbound `provider=headless` con estado `captured`, sin `provider_message_id`
de Meta y con el payload interno de captura/proyección. No se observó tráfico Meta.

Durante el recorrido se corrigieron tres incompatibilidades reales del launcher con Node 26:
resolución de imports internos `.ts`/`.js`, sintaxis TypeScript no soportada por strip-only y lectura
de stdin mediante `readable` en lugar de `readFile(0)`. También se corrigió una falsa redacción que
marcaba `Dirección: Pendiente` como dato sensible.

Esta corrida inicial usó un mecanismo legado de respuestas registradas y quedó reemplazada como
evidencia de funcionamiento IA por la corrida real documentada abajo. El runtime vigente no conserva
catálogo ni archivos de fixtures seleccionables; las pruebas deterministas usan dobles inline.
No hubo fallback silencioso.

### Última corrida real de ocho turnos

La corrida opt-in más reciente (`HEADLESS_REAL_E2E=1 HEADLESS_REAL_E2E_TRANSCRIPT=1`) usó un journal
limpio, el tenant sintético `headless-demo` y `gemini-flash-lite-latest`. Las ocho decisiones fueron
producidas por Gemini y validadas por el router compartido: `show_menu`, `add_product`,
`get_order_status`, `set_fulfillment`, `set_billing`, `set_payment_method`, `get_order_status` y
`confirm_order`. Se capturaron ocho respuestas headless; no se generaron mensajes ni identificadores
de Meta.

El backend persistió un `draft_order` con una Hamburguesa clásica, modalidad `pickup`, facturación
normal, pago `transfer` y total COP 18.000. El último turno creó una orden en estado
`pending_restaurant_confirmation`; `inspect` confirmó el mismo estado y `close` cerró la sesión.
La prueba terminó con **1 pasada, 0 fallos y 0 omisiones**. La consulta anterior que devolvió
`429 RESOURCE_EXHAUSTED` fue un bloqueo transitorio de cuota, no un fallo de la implementación.

## Gates y línea base

Los checklists aprobados fueron revisados antes de implementar: `readiness.md` 40/40 y
`requirements.md` 16/16.

| Comando | Resultado | Observación |
| --- | --- | --- |
| `supabase status` | Verde | Supabase local verificado con Docker; el primer intento histórico quedó bloqueado por telemetría fuera del workspace. |
| `supabase db lint --local` | Verde | No se encontraron errores de schema después de corregir las funciones dinámicas de claim/finalize/reconcile para usar variables escalares seguras. |
| `pnpm --filter @42day/api test` | Verde | 243 pruebas, 226 verdes y 17 opt-in omitidas sin fallos. |
| `pnpm --filter @42day/api typecheck` | Verde | Typecheck oficial del API. |
| `pnpm --filter @42day/api build` | Verde | Build oficial del API. |
| `apps/api/node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` | Verde | Typecheck directo del workspace API. |
| `node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/**/*.test.mjs` | Verde | 202 pruebas, 199 verdes y 3 opt-in omitidas sin fallos. |
| `node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-*.test.mjs` | Verde | Pruebas focalizadas headless exitosas. |
| `scripts/bash/verify-no-headless-deploy.sh` | Verde parcial | Wrangler dry-run generó el bundle; `headless_surface_absent`. El log se aisló en temporal. |
| `supabase status` con Docker local | Verde | DB, API/Kong, PostgREST, Auth, Realtime y Storage activos; auxiliares no necesarios excluidos. |
| Recorrido headless real sin fixture | Verde | Corrida actual con Gemini real: 8/8 planes válidos, pedido persistido, respuestas `captured`, cero Meta, `inspect` y `close`; una corrida previa con cuota agotada quedó registrada como fallback seguro. |
| Migración forward de manifiesto | Verde | `20260813100000_fix_normalized_inbound_manifest_json.sql` aplicada en Supabase local. |

Los primeros intentos de pnpm quedaron bloqueados por resolución de versión, red y scripts nativos;
esa observación se conserva como histórico. Después se recuperaron las dependencias con acceso al
registry y `--ignore-scripts`; los gates oficiales posteriores se reportan en la sección siguiente.

La primera observación de Docker se conserva como línea base histórica; posteriormente Docker Desktop
quedó operativo y la integración local se ejecutó. Los primeros intentos de pnpm también se conservan
como historial de entorno; los gates oficiales posteriores quedaron verdes tras recuperar las
dependencias con acceso al registry.

Ese bloqueo de Docker fue resuelto durante la sesión del 2026-08-13: Docker Desktop quedó operativo y
la integración local se ejecutó con el stack mínimo. La observación histórica anterior se conserva
como línea base; no representa el estado final de esta sesión.

No se presenta ningún check bloqueado como exitoso. La cuota de Gemini produjo una omisión en una
corrida anterior, pero el último E2E real terminó correctamente con el alias habilitado
`gemini-flash-lite-latest`.

## Cambios verificados

- `processNormalizedChatTurn` concentra la frontera posterior a la normalización para WhatsApp y
  headless.
- `HeadlessCapture` devuelve `captured`, no genera identificadores de Meta y entrega al observer solo
  una proyección con `redacted` y `redactionCodes`.
- La CLI exige archivo dedicado, `APP_ENV=local`, debug, `project_id`, endpoint loopback y schemas
  locales antes de consultar tenant o journal.
- El journal conserva identidades y sesiones entre invocaciones; turnos repetidos se comparan por
  digest y conflictos no se reprocesan.
- El manifiesto de ejecución se reclama después de obtener el plan semántico y antes del primer efecto;
  la migración define funciones de claim, finalización y reconciliación sin `SKIP LOCKED`, con locks
  estables y grants restringidos a `service_role`.
- `reconcile` obtiene el inbound headless y su `payload.internal` desde Supabase; ya no decide por la
  cantidad de respuestas guardadas en el journal. La evidencia compartida valida forma del manifiesto
  y presencia de postcondiciones antes de resolver.
- Todo texto automatizable llega al plan semántico compartido; la pausa manual conserva el inbound y
  la reactivación reclama solo el último inbound headless pendiente.

## Verificación final de esta sesión

- Suite completa oficial/directa: **243 pruebas, 226 verdes y 17 pruebas opt-in omitidas** cuando no se activan
  Supabase/Gemini reales; sin fallos.
- Suite headless focalizada: **76 pruebas, 75 verdes y 1 E2E externo omitido** con Supabase local;
  el flujo inline de ocho turnos, pausa/reactivación, fallos después de draft/orden y la ruta HTTP de
  reconciliación pasaron contra Supabase.
- Matriz de contrato de paridad: **15/15 escenarios verdes**; compara la observación de negocio y
  verifica por separado que la única diferencia de transporte sea `captured` frente a `sent`, con
  redacción pública para dirección/facturación. La ejecución completa contra Supabase atraviesa los
  15 escenarios por el router, sus efectos y la persistencia real para ambos orígenes.
- Journal y manifiesto: el journal ahora rechaza sesiones que cruzan tenant/identidad, IDs duplicados
  y turnos duplicados; las huellas de postcondición cambian ante estados agregados distintos del draft
  y se calculan después de la validación de negocio. La CLI y el dashboard consumen el resultado
  autoritativo devuelto por la RPC de reconciliación.
- Integración headless con Supabase local: **76 pruebas, 75 pasaron y 1 E2E externo se omitió**, cubriendo
  nested JSON, claim atómico, none/partial/all, finalización, reconciliación, aislamiento con los tenants
  `headless-demo` y `headless-isolation-b`, captura, locks de sesión, recuperación de turnos huérfanos,
  evidencia corrupta/mismatch y la misma decisión para CLI/dashboard. El helper local también refresca
  `authenticator.pgrst.db_schemas` después de provisionar tenants; sin ese refresh PostgREST rechazaba
  el segundo schema aunque ya existiera en Postgres.
- E2E sin dobles fijos con Gemini real: la última corrida produjo 8/8 planes válidos (`show_menu`,
  `add_product`, `get_order_status`, `set_fulfillment`, `set_billing`, `set_payment_method`,
  `get_order_status`, `confirm_order`), persistió un pedido, capturó todos los outbound sin Meta y
  verificó `inspect` y `close`. El test permite imprimir una transcripción sanitizada con
  `HEADLESS_REAL_E2E_TRANSCRIPT=1`.
- Auditoría SQL local: `supabase db lint --local` terminó con `No schema errors found`; la comprobación
  de secretos no encontró claves operativas en el alcance auditado y los únicos `service_role` observados
  corresponden a grants de migraciones.
- Auditoría transversal: se revisaron constitución, CODESTYLE, TESTING, readiness, superficie Worker,
  imports remotos, grants/RPC, locks, migraciones y dependencias. No hay llamadas remotas a Meta ni
  endpoints operativos adicionales desde la superficie headless; Gemini solo se usa como proveedor IA
  configurado. El bundle no contiene CLI/journal/debug y no se añadieron dependencias de producción. La única
  coincidencia de secreto fue el placeholder documentado `replace-with-local-service-role-key`; el archivo
  operativo queda ignorado. `instagram-1080x1350.png` se mantiene fuera del feature por ser un cambio ajeno.
- La validación de limpieza local acepta únicamente `project_id=42day`, API loopback y los tenants
  sintéticos permitidos; rechaza endpoints remotos y no ejecuta resets implícitos. El helper
  `scripts/bash/reset-local-headless-chat.sh` ofrece `--check` y exige
  `--reset --confirm local-headless-reset`; al resetear mueve el journal exacto a un archivo recuperable.
- Matriz real de paridad: `headless-chat-parity-integration.test.mjs` ejecutó los 15 escenarios contra
  Supabase local, creando una sesión WhatsApp fake y otra headless por escenario. En ambos transportes
  se atravesaron el mismo router semántico, checkpoint, persistencia y snapshot; se compararon textos,
  estados, draft/order y operaciones. Resultado: **15/15 escenarios verdes**, incluidos pausa manual,
  confirmación con pedido persistido, baja confianza, operación inválida y dirección escrita. Las
  respuestas headless conservaron su proyección `captured`; los IDs opacos de pedido se canonizaron solo
  para comparar transportes, nunca para ejecutar efectos.
- La alternativa `gemini-2.5-flash-lite` fue rechazada por Gemini con `404 NOT_FOUND`; no se conserva
  como configuración operativa.
- Flujo completo local con `test_double` inline: **8 turnos aplicados**, pedido `pending_restaurant_confirmation`,
  retry `repeated`, conflicto `IDEMPOTENCY_CONFLICT`, `inspect` y `close`; no se expone por la CLI.
- Falla antes del checkpoint: el turno queda `indeterminate` sin draft, order ni outbound; el retry no
  vuelve a invocar la IA.
- Falla después del checkpoint durable y antes del primer efecto: el turno queda `indeterminate`,
  conserva el manifiesto reclamado y no crea draft, order ni outbound.
- Falla después de efecto y dashboard: un outbound ya capturado, una mutación de draft, una mutación de
  conversación y una orden creada
  antes del fallo quedan `indeterminate`; la reconciliación de CLI y la ruta HTTP autenticada del dashboard
  consultan la evidencia autoritativa y no hacen replay. La reactivación manual procesa solo el último
  inbound pendiente, marca los anteriores `superseded` y persiste la respuesta como `manual_resume`.
- La matriz de fallos cubre todas las fronteras durables del manifiesto vigente: checkpoint, `outbound_message`,
  `draft_order_mutation`, `conversation_mutation` y `order_mutation`. Cada interrupción deja el turno
  `indeterminate` y bloquea replay; la reconciliación local prueba `none`, `partial` y `all` con la misma
  decisión para CLI y dashboard.
- Las dependencias no disponibles quedan explícitas: catálogo desconocido y geocodificación sin cobertura
  conservan el flujo en aclaración, la base local no disponible se clasifica como `dependency` y los
  proveedores IA inválidos/cuota agotada no se convierten en éxito ni activan fallback remoto silencioso.
- La caracterización de la frontera normalizada ejecutada contra Supabase comparó `whatsapp_cloud` y
  headless con el mismo `test_double` inline: `show_menu` y `add_product` produjeron igual texto,
  estado de conversación, líneas y total; la única diferencia observada fue entrega fake frente a
  captura local.
- La prueba concurrente de idempotencia ejecutada contra Supabase devolvió un resultado `applied` y
  uno `repeated`, con un único inbound y un único outbound persistidos para el mismo `turnId`.

## Transcripción sanitizada de una orden real persistida

La conversación de validación exitosa quedó persistida con `provider=headless`, `status=processed`
para inbound y `status=captured` para outbound. Gemini fue el proveedor registrado en cada turno; las
operaciones que aparecen abajo provienen de la traza persistida, no de un fixture. El cliente y el
tenant son sintéticos.

| Turno | Cliente | Gemini / router | Respuesta capturada |
| --- | --- | --- | --- |
| 1 | `Quiero una hamburguesa clásica` | `add_product` | Pedido actual: 1 Hamburguesa clásica, subtotal COP 18.000; pregunta si desea agregar algo o continuar con entrega. |
| 2 | `Prefiero recogerlo en el local` | `set_fulfillment` | Cambia a recoger; dirección no requerida; solicita nombre completo para factura normal. |
| 3 | `Mi nombre completo es Carlos E2E` | `set_billing` | Guarda facturación normal y pregunta si prefiere efectivo o transferencia. |
| 4 | `Quiero pagar por transferencia` | `set_payment_method` | Muestra resumen: pickup, factura normal, transferencia, total COP 18.000; solicita confirmación. |
| 5 | `Sí, confirma el pedido` | `confirm_order` | `Perfecto. Ya dejé tu pedido fca7dcd8 pendiente de revisión por parte del restaurante.` |

La orden quedó en estado `pending_restaurant_confirmation`, modalidad `pickup`, pago `transfer`,
facturación normal y total COP 18.000. Todos los outbound fueron `captured`; no hubo identificadores
ni llamadas de Meta. En una corrida posterior de ocho turnos, Gemini produjo todos los planes y la
orden quedó persistida en estado `pending_restaurant_confirmation`; sus respuestas fueron
`captured` y el flujo terminó con `inspect` y `close` exitosos.
- La frontera headless ahora expone un hook interno de prueba después de persistir cada outbound
  capturado y después de mutaciones de draft/orden; las fault injections confirman que el estado de
  negocio ya es durable cuando falla el proceso posterior y que el error no se confunde con un fallo de
  persistencia. La ruta HTTP autenticada del dashboard fue verificada contra la misma evidencia
  autoritativa; ya se observan las fronteras de configuración/conversación y sigue pendiente la matriz
  exhaustiva por cada efecto y etapa del manifiesto.
- Supabase local mínimo: verde; DB, API REST, Auth, Realtime y Storage saludables.
- Línea base del stack local verificada el 2026-08-13: Supabase CLI 2.109.1, Node v26.3.0,
  pnpm 11.19.0, proyecto `42day`, API `127.0.0.1:54321`, DB `127.0.0.1:54322` y schemas expuestos
  `control`, `tenant_template`, `tenant_headless_demo` y `tenant_headless_isolation_b`; no se registran
  credenciales.
- Typecheck directo de `packages/types`, `packages/config`, `packages/core`, `apps/api` y
  `apps/dashboard`: verde.
- `node --check` de CLI/loader, `bash -n` de scripts y `git diff --check`: verde.
- `scripts/bash/verify-no-headless-deploy.sh`: `headless_surface_absent`.
- Contrato de stdout de CLI: un único envelope JSON, verde.
- Quickstart CLI sin dobles fijos, con journal temporal y tenant local `headless-demo`: `start=started`,
  un `turn` real `status=applied` con respuesta `captured`, `inspect=inspected` y `close=closed`;
  el turno alcanzó Gemini, pero `ai.used=false` por el fallback seguro ante cuota agotada. El recorrido
  se completó en **1.6 segundos** sin resetear la base local; `ai.used=false` por cuota agotada.
- IA real ejecutada: la evidencia histórica contiene cinco turnos con Gemini `gemini-2.5-flash` y la
  última corrida contiene ocho turnos con `gemini-flash-lite-latest`; ambos recorridos fueron sin
  fixture, produjeron planes JSON válidos y persistieron la orden en Supabase local. También se
  verificó un primer fallo transitorio con fallback seguro y sin mutación del pedido.
- El caso de uso post-normalización instala el checkpoint/finalización común para WhatsApp; headless
  conserva su correlación de journal y captura local específica.
- Los fixtures deterministas persistentes fueron retirados del runtime y de los tests: no hay catálogo
  ni archivos JSON seleccionables. Los casos deterministas inyectan dobles inline con `providerId=test_double`
  y la CLI rechaza cualquier selector de fixture. El bundle Worker no contiene esa superficie.

## Verificación oficial posterior

Con dependencias recuperadas mediante `pnpm install --ignore-scripts --frozen-lockfile` y acceso al
registry, se ejecutaron correctamente:

- `CI=true pnpm --filter @42day/api test`: 243 pruebas, 226 verdes y 17 opt-in omitidas.
- `CI=true pnpm --filter @42day/dashboard test`: 28 pruebas, 28 verdes.
- `CI=true pnpm --filter @42day/api typecheck` y `build`.
- `CI=true pnpm typecheck`, `pnpm lint`, `pnpm build` y `pnpm test`: los siete workspaces exitosos;
  API 226/243 sin fallos y dashboard 28/28.
- `scripts/bash/verify-no-headless-deploy.sh`: `headless_surface_absent`.

El E2E real opt-in pasó con ocho llamadas válidas a Gemini usando `gemini-flash-lite-latest`; el
backend persistió el pedido y capturó las respuestas. También queda registrada una corrida anterior
que devolvió HTTP 429 `RESOURCE_EXHAUSTED` y emitió fallback seguro sin mutar el pedido.

## Auditoría de requisitos 2026-08-13

| Requisitos | Estado | Evidencia o bloqueo |
| --- | --- | --- |
| FR-001–FR-002, FR-009, FR-012, FR-018–FR-019, FR-021–FR-022, FR-024 | Verificado localmente | Contrato CLI, gates de entorno, journal tenant-scoped, lock de sesión, cierre y límites de texto; la identidad nueva conserva `headless`, tenant y proyecto local. |
| FR-003–FR-008, FR-013, FR-020 | Parcial | WhatsApp y headless delegan al mismo caso de uso y headless captura sin Meta; falta cerrar la matriz conductual de 15 escenarios y la reactivación HTTP autenticada completa. |
| FR-010–FR-011, FR-017 | Verificado con alcance local | Envelope v1, snapshots seguros, `inspect`, proyección `manual_resume`, sanitización y reconciliación corrupta/mismatch/partial. |
| FR-014–FR-016 | Parcial | Validación backend, fallback seguro, manifiesto y reconciliación `none/partial/all` están cubiertos; faltan fallos inyectados después de cada efecto y cobertura exhaustiva de dependencias. |
| FR-023, SC-001 | Parcial | La corrida real reproducible de ocho turnos con Gemini ya está verificada; SC-001 sigue parcial porque aún no se ejecutó la matriz completa de 15 escenarios con router y efectos reales. |
| NFR-001–NFR-006, NFR-008 | Verificado localmente | Stack loopback, ausencia de superficie Worker, grants de RPC, aislamiento/proyección segura, journal serializado y resultados indeterminados sin replay. |
| NFR-007, SC-002, SC-007, SC-010 | Parcial | La integración cubre dos tenants y límites RPC principales; faltan los 15 escenarios conductuales de paridad y fault injection después de cada frontera. SC-004 queda verificado por los cruces reales. |
| NFR-009, SC-008 | Parcial | El recorrido CLI desde journal limpio está cronometrado (1,6 s) y es parseable; falta medir el procedimiento completo con `supabase db reset` y el tenant recién provisionado. |
