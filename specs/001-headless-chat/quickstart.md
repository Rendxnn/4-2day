# Quickstart de validación: chat headless local

> Guía de validación de la implementación local. La CLI requiere que Supabase local esté iniciado y
> que el archivo de ambiente dedicado exista; no hace fallback a staging ni a un proyecto remoto.

## 1. Prerrequisitos

- Node.js 22 y la versión de pnpm fijada por el repositorio.
- Supabase CLI y runtime de contenedores disponibles para iniciar el stack definido en `supabase/config.toml` (`project_id=42day`, API `127.0.0.1:54321`).
- Migraciones/seed aplicados y al menos un tenant local registrado; las suites de aislamiento requieren dos tenants locales.
- Catálogo/configuración mínima para el tenant elegido.
- Credenciales de IA reales solo si se ejecutará el smoke no determinista.

Los ejemplos usan `headless-demo`, que es el tenant provisionado por la evidencia local actual. Si el
stack tiene otro tenant registrado, sustituir ese slug en todos los envelopes; `demo` en los contratos
es solo un ejemplo abstracto y no se crea automáticamente.

Preparar el stack desde la raíz:

```bash
supabase start
supabase db reset --local
scripts/bash/sync-local-supabase-schemas.sh
```

El helper compara `control.tenants.schema_name` con `[api].schemas`. Si modifica
`supabase/config.toml`, reiniciar el stack con `supabase stop` y `supabase start` antes de continuar.
También actualiza la allowlist `authenticator.pgrst.db_schemas`; la CLI headless rechaza un tenant cuyo
schema todavía no esté expuesto en ambas fuentes y nunca cambia a acceso Postgres directo ni a un
proyecto remoto.

Crear `apps/api/.env.headless.local` a partir de la plantilla dedicada, sin commitear secretos. Obtener
las credenciales del stack mediante `supabase status -o env` y trasladar únicamente los valores locales:

```dotenv
APP_ENV=local
PARAHOY_HEADLESS_DEBUG=true
PARAHOY_HEADLESS_LOCAL_PROJECT_ID=42day
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=replace-with-local-value
SUPABASE_SERVICE_ROLE_KEY=replace-with-local-value
DATABASE_URL=postgresql://replace-with-local-value@127.0.0.1:54322/postgres
```

El comando carga siempre este archivo; no acepta otro path desde JSON ni cae a `.dev.vars`. Si
`APP_ENV`, `project_id`, host o puertos no coinciden con `supabase/config.toml`, la CLI debe detenerse
antes de consultar tenant o crear journal. Las credenciales tienen acceso total solo a la base local,
permanecen fuera de Git y nunca se pasan dentro del JSON.

## 2. Iniciar una sesión con identidad nueva

Desde la raíz:

```bash
printf '%s\n' '{"version":1,"command":"start","tenant":"headless-demo"}' \
  | pnpm --silent --filter @42day/api headless
```

Verificar:

- exit `0`;
- una sola línea JSON en stdout;
- `status=started`;
- `session.state=active`;
- aparecen `session.id` e `identityId`, pero no teléfono/customer ID;
- se crea journal bajo `apps/api/.headless-journal/` y cliente sintético en el tenant local seleccionado.

Guardar manualmente los IDs devueltos para los ejemplos siguientes; el protocolo no infiere “última sesión”.

## 3. Enviar varios turnos

```bash
printf '%s\n' '{"version":1,"command":"turn","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR","turnId":"turn-001","text":"Hola, quiero ver el menú"}' \
  | pnpm --silent --filter @42day/api headless

printf '%s\n' '{"version":1,"command":"turn","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR","turnId":"turn-002","text":"Quiero una hamburguesa"}' \
  | pnpm --silent --filter @42day/api headless
```

Verificar en cada resultado:

- `responses` conserva orden y contenido útil, e incluye `redacted` y `redactionCodes`;
- si la respuesta completa contiene dirección, billing u otro valor sensible, la fila tenant-local lo
  conserva como evidencia de negocio y stdout muestra únicamente la proyección redactada;
- `before`/`after` muestran la transición permitida;
- `routing` contiene códigos seguros, no prompt/raw;
- `routing.ai` identifica proveedor/modelo y operaciones seleccionadas sin conservar la respuesta cruda;
- `effects` contiene tipos y IDs opacos de mensajes o mutaciones de negocio persistidas; nunca IDs de Meta;
- mensajes y borrador aparecen en el mismo tenant local seleccionado;
- ningún request alcanza `graph.facebook.com`.

## 4. Reutilizar identidad en otra corrida

Cerrar o terminar el proceso no elimina la identidad. Crear otra sesión:

```bash
printf '%s\n' '{"version":1,"command":"start","tenant":"headless-demo","identityId":"hid_REEMPLAZAR"}' \
  | pnpm --silent --filter @42day/api headless
```

Debe reutilizar el cliente sintético y el estado conversacional que corresponda a las reglas actuales. Usar el mismo ID con otro tenant debe fallar sin revelar a qué tenant pertenece.

## 5. Ejecutar con IA real

```bash
printf '%s\n' '{"version":1,"command":"turn","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR","turnId":"turn-real-001","text":"Agrégala al pedido"}' \
  | pnpm --silent --filter @42day/api headless
```

La CLI no acepta fixtures. El archivo \`.env.headless.local\` debe contener una clave de Gemini
o del proveedor configurado para el tenant. El comando envía el texto y el contexto operacional
resumido al proveedor, valida el plan JSON y aplica las mismas acciones del flujo compartido.
Las respuestas controladas para pruebas deterministas se inyectan únicamente dentro del harness;
nunca mediante stdin ni desde una ruta arbitraria.

El cuerpo lógico enviado a Gemini contiene únicamente este contexto permitido:

```json
{
  "message": "texto actual del cliente",
  "conversationState": "estado actual",
  "lastAssistantPrompt": "última pregunta enviada o null",
  "allowedOperations": ["operaciones permitidas para ese estado"],
  "pendingAdjustment": "ajuste de agotados resumido o null",
  "pendingConfiguration": "configuración pendiente resumida o null",
  "menu": "productos, aliases, precios y IDs de opciones visibles",
  "draft": "borrador resumido: líneas, cantidades, notas, entrega, pago y facturación"
}
```

No se envían credenciales, coordenadas ni el historial completo. El mensaje actual se envía tal cual
porque puede contener la dirección, el nombre u otro dato que Gemini necesita interpretar; el borrador
solo expone un resumen permitido (líneas, cantidades, notas, modalidad, pago, indicador de dirección y
tipo de facturación), no los valores completos guardados de dirección o facturación. El modelo devuelve
solo el plan JSON tipado;
el backend vuelve a validar IDs, disponibilidad, permisos y precondiciones antes de ejecutar cualquier
operación.

## 6. Probar idempotencia

Ejecutar dos veces, incluso concurrentemente, el mismo comando `turn`:

- exactamente uno puede ejecutar el flujo;
- el otro espera el lock y devuelve `status=repeated`;
- solo existe un mensaje inbound para el ID compuesto;
- confirmar pedido produce como máximo un pedido;
- cambiar texto manteniendo `turnId` devuelve `IDEMPOTENCY_CONFLICT`.

Si la conversación está en modo manual, el turno devuelve `status=pending`, no llama a Gemini y deja el
inbound en `logged`. Al reactivar desde dashboard, el claim compartido marca los anteriores como
`superseded`, procesa solo el último y deja la respuesta capturada como `manual_resume` para `inspect`.

Si el resultado es `indeterminate`, no repetir automáticamente. Ejecutar `inspect`, revisar el estado y
declarar solo el resultado realmente observado:

```bash
printf '%s\n' '{"version":1,"command":"reconcile","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR","turnId":"turn-001","observedOutcome":"effects_applied"}' \
  | pnpm --silent --filter @42day/api headless
```

También se permite `observedOutcome=no_effects`. La declaración no fuerza el estado: si el backend no
puede validarla contra el manifiesto previo a efectos, conversación, draft, orden y mensajes bajo
lock, devuelve `indeterminate` y mantiene la sesión bloqueada. Un efecto parcial nunca se declara
`failed` ni `applied`. La operación no invoca IA, geocodificación, entrega ni ejecutores.

En un entorno desplegado, el operador autorizado puede usar la operación backend de dashboard definida
en `contracts/dashboard-reconciliation.md`; delega al mismo caso de uso. Esta capacidad compartida no
habilita headless fuera de local y este feature no añade una pantalla nueva.

## 7. Inspeccionar y cerrar

```bash
printf '%s\n' '{"version":1,"command":"inspect","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR"}' \
  | pnpm --silent --filter @42day/api headless

printf '%s\n' '{"version":1,"command":"close","tenant":"headless-demo","sessionId":"hss_REEMPLAZAR"}' \
  | pnpm --silent --filter @42day/api headless
```

`close` repetido debe seguir devolviendo éxito. Un turno posterior debe rechazarse sin IA ni mutación. `inspect` debe continuar disponible.

## 8. Gates negativos

Ejecutar por separado con:

1. archivo `apps/api/.env.headless.local` ausente;
2. `PARAHOY_HEADLESS_DEBUG=false`;
3. `APP_ENV` distinto de `local`;
4. URL Supabase remota o puerto distinto de `supabase/config.toml`;
5. tenant inexistente o cuyo schema no esté en `[api].schemas`;
6. identidad o sesión de otro tenant.

Cada caso debe fallar antes del efecto indicado por el gate, emitir una única respuesta segura y no crear cliente, sesión parcial ni llamada externa de negocio.

## 9. Suite prevista

Para la verificación contra el stack local sin dobles fijos, activar explícitamente:

```bash
HEADLESS_SUPABASE_INTEGRATION=1 node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-manifest-integration.test.mjs apps/api/test/headless-chat-fault-injection.test.mjs
HEADLESS_REAL_E2E=1 node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-real-e2e.test.mjs
```

Para imprimir la transcripción sanitizada de cada turno cuando el E2E termina correctamente:

```bash
HEADLESS_REAL_E2E=1 HEADLESS_REAL_E2E_TRANSCRIPT=1 node --test --experimental-strip-types --experimental-specifier-resolution=node apps/api/test/headless-chat-real-e2e.test.mjs
```

La prueba E2E crea un pedido de validación en el tenant local configurado y no se ejecuta dentro de la
suite por defecto para evitar llamadas accidentales al proveedor.

```bash
pnpm --filter @42day/api test:headless
pnpm --filter @42day/api test:headless:integration
pnpm --filter @42day/api test
pnpm typecheck
pnpm lint
pnpm test
pnpm build
scripts/bash/verify-no-headless-deploy.sh
```

La suite de integración requiere dos tenants de la base local. Puede limpiar únicamente los IDs
sintéticos creados o reiniciar el stack con `supabase db reset`; antes de un reset debe validar
`project_id=42day` y endpoints loopback. La suite con IA real es adicional; no reemplaza los dobles
inline ni debe ser obligatoria para CI.

La suite de fallos debe inyectar interrupciones antes del checkpoint, después del checkpoint y después
de cada frontera de efecto esperada. Debe demostrar las tres resoluciones: todos los efectos,
ningún efecto y estado parcial que permanece `indeterminate`.

El harness valida antes de cualquier limpieza que `project_id=42day`, el proyecto local declarado y el
endpoint `http://127.0.0.1:54321` coincidan. Solo después de esa validación se considera permitido
`supabase db reset --local`; el helper no ejecuta resets ni acepta URLs remotas. Los tenants sintéticos
permitidos para la integración son `headless-demo` y `headless-isolation-b`.

## 10. Verificar ausencia del desplegado

El script de verificación debe:

1. crear un directorio temporal seguro;
2. ejecutar el binario Wrangler ya instalado: `apps/api/node_modules/.bin/wrangler deploy --env staging --dry-run --outdir <tmp>/out`;
3. inspeccionar JS, sourcemap y metadata generada;
4. fallar si aparecen la entrada CLI, journal, comandos/fixtures headless o el flag debug;
5. confirmar que `apps/api/src/index.ts` no monta rutas headless;
6. eliminar únicamente el temporal creado.

No se debe ejecutar `wrangler deploy` sin `--dry-run` como parte de esta prueba.

## 11. Limpieza local deliberada

`close` no borra datos. Para limpiar completamente:

- comprobar que se cargó `.env.headless.local`, `APP_ENV=local`, `project_id=42day` y endpoints loopback;
- detener agentes que usen sesiones;
- eliminar los datos sintéticos listados por el journal o ejecutar un `supabase db reset` explícito;
- retirar únicamente la ruta exacta `<repo>/.local/headless-chat/` con una operación recuperable o un helper que valide la raíz.

Nunca ejecutar limpieza contra una URL remota. El reset amplio solo está permitido sobre el stack local
validado; producción, staging y cualquier otro proyecto permanecen prohibidos.

## 12. Evidencia a adjuntar en revisión

- salida resumida de suites focalizadas y gates globales;
- resultado de paridad interna completa para los 15 escenarios y validación separada de las
  proyecciones públicas redactadas, sin imprimir contenido sensible en diffs;
- evidencia del espía de Meta en cero llamadas;
- manifiesto/listado del bundle dry-run inspeccionado;
- resultado de integración con Supabase local o declaración explícita del prerrequisito bloqueado;
- actualización de `docs/current-status.md` solo después de que el comportamiento exista.
